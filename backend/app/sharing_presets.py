"""Sharing presets: an audience-scoped template, planned and reviewed without writing anything (#241, step 1).

Choosing a preset for one audience (the public view, a hidden link or a collection member) works out, from the
trip's records as they are now, the *target*: the shareable records the preset selects. It then plans the
smallest change to that audience's scope and to record visibility that makes the audience receive exactly the
target, using only the writes the owner already has:

* a ``private`` target record becomes ``custom`` and is listed in this audience's ``items`` (a ``custom`` one that
  is not listed yet is listed); **a preset never writes ``everyone``**, so no other audience gains anything;
* a ``custom`` record this audience lists that the target does not contain is unlisted (it stays ``custom``);
* on a hidden link or collection member, an ``everyone`` record the target does not contain is added to
  ``exclude``, unless excluding it would also hide a target record (``exclusions.closure``). The public view is the
  baseline and cannot exclude: its ``everyone`` records are *left as is*, and the review says how to change that;
* the audience's ``defaults.date_precision`` becomes the coarser of its current value and ``month``.

Locations and loose gallery photos are never selected, listed, unlisted or excluded by a preset: their own
visibility decides (decision 241). Photos travel with the included updates, which ``projection.delivered`` already
does, so a preset writes nothing for them.

Nothing here reads a preset back at delivery time: ``projection.delivered`` stays the one function that decides
what an audience receives. ``review_preset`` applies the plan inside a nested transaction that is always rolled
back, renders the "after" through ``delivered`` and returns the difference. It persists nothing, claims no
revision and records no audit event.

``apply_preset`` (step 2) writes the same plan in the caller's transaction, using only the writes that exist: the
visibility of a promoted record, the audience's scope (validated by ``prepare_scope`` like a manual edit), its
revision, and the display label ``applied_preset`` / ``applied_preset_at``. That label is never read back by
delivery; only the owner's responses show it, with the exceptions computed by ``preset_exceptions``.
"""

import hashlib
import json
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime
from typing import Any, Literal

from fastapi import status
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from .access import COLLECTIONS, set_visibility, sharing_blocker
from .audit import record_audit_event, record_collection_event, scope_fingerprint
from .errors import ApiException, ServiceError, service_exception
from .exclusions import KIND_ORDER, closure, is_excludable, stored_exclusions
from .models import (
    AuditEventKind,
    AuditTargetType,
    Collection,
    CollectionMember,
    DerivativePurpose,
    LinkState,
    PublicSurface,
    ShareLink,
    SurfaceState,
    Trip,
    Visibility,
)
from .precision import audience_precision, coarser, effective_precision, is_finer, own_value
from .projection import ScopeError, delivered, prepare_scope
from .schemas import (
    MAX_SCOPE_EXCLUSIONS,
    MAX_SCOPE_ITEMS,
    PresetAudienceInfo,
    PresetChange,
    PresetComparison,
    PresetExceptions,
    PresetLeftAsIs,
    PresetNeedsDecision,
    PresetPrecisionReview,
    PresetRecordRef,
    PresetRefusal,
    PresetReplacesException,
    SharingPresetId,
    SharingPresetReview,
)

PRESET_SCHEMA_VERSION = "travel/sharing-preset@1"
# A preset never makes dates finer: the audience's cap becomes the coarser of its own value and this one.
PRESET_DATE_PRECISION = "month"
_PLANNED = frozenset({"planned", "confirmed"})
# The kinds whose records a preset decides about, in every preset (a kind a preset does not select has an empty
# target, so its records are unlisted or left out). Locations and loose photos are not among them.
MANAGED_KINDS = ("area", "visit", "stay", "route", "travel_update")


@dataclass(frozen=True)
class KindRule:
    """A kind a preset selects, and the statuses it accepts (``None``: any)."""

    kind: str
    statuses: frozenset[str] | None = None


@dataclass(frozen=True)
class SharingPreset:
    id: SharingPresetId
    extends: SharingPresetId | None
    selects: tuple[KindRule, ...]


_STORY = (KindRule("travel_update"),)
_ROUTE = (KindRule("area"), KindRule("route", _PLANNED))
_TRIP = (KindRule("visit", _PLANNED), KindRule("stay", _PLANNED))

PRESETS: dict[str, SharingPreset] = {
    preset.id: preset
    for preset in (
        SharingPreset("story_only", None, _STORY),
        SharingPreset("story_and_route", "story_only", _STORY + _ROUTE),
        SharingPreset("planned_trip", "story_and_route", _STORY + _ROUTE + _TRIP),
    )
}


@dataclass(frozen=True)
class PresetAudience:
    """The audience a preset is planned for: its id as the audit trail names it, its stored scope and its rules."""

    id: str  # ``public``, ``link:<id>`` or ``collection:<member id>``
    kind: Literal["public", "link", "collection_member"]
    label: str | None
    scope: dict
    live: bool
    can_exclude: bool


Ref = tuple[str, str]


Action = Literal["promote", "list", "unlist", "exclude", "remove_exclusion"]
Replaced = Literal["exclusion_removed", "left_out_by_you"]


@dataclass(frozen=True)
class Change:
    """One write of a plan: ``promote`` (private -> custom, listed), ``list``, ``unlist``, ``exclude`` or ``remove_exclusion``."""

    action: Action
    kind: str
    id: str


@dataclass
class Reason:
    """A record with the code of why it is in a list; ``reason`` is a blocker code for a record that needs a decision."""

    kind: str
    id: str
    reason: str


@dataclass
class Replacement:
    """A choice the owner made by hand that the preset resets."""

    kind: str
    id: str
    reason: Replaced


@dataclass
class PresetPlan:
    preset: SharingPreset
    audience: PresetAudience
    target: dict[str, set[str]]
    changes: list[Change]
    scope_after: dict
    precision_before: str | None
    precision_after: str
    needs_decision: list[Reason]
    replaces: list[Replacement]
    # Records outside the target that an exclusion would not be allowed to hide, because it would hide a target record.
    conflicts: set[Ref] = field(default_factory=set)
    refusal: PresetRefusal | None = None

    def promoted(self) -> list[Ref]:
        return [(change.kind, change.id) for change in self.changes if change.action == "promote"]


def preset_catalog() -> list[SharingPreset]:
    return list(PRESETS.values())


def _preset(preset_id: str) -> SharingPreset:
    preset = PRESETS.get(preset_id)
    if preset is None:
        raise ServiceError(f"Unknown sharing preset {preset_id}", code="unknown_sharing_preset")
    return preset


def record_date(kind: str, record: Any) -> date | None:
    """The day that tells two records of one name apart (a stay's check-in), for the interface to format."""
    return record.check_in_date if kind == "stay" else None


def record_label(kind: str, record: Any) -> str | None:
    """The owner's own name for a record, for an owner-only review. It is never written to the audit trail."""
    if kind in {"area", "location"}:
        return record.label
    if kind == "visit":
        return record.title or record.area.label
    if kind == "stay":
        return record.area.label
    if kind == "route":
        return record.label or record.mode.value
    if kind == "travel_update":
        return record.title
    if kind == "media_derivative":
        return record.caption
    return None


def _listed(scope: dict) -> list[Ref]:
    """The ``(kind, id)`` pairs the scope lists, in order, without duplicates; anything malformed is skipped."""
    found: dict[Ref, None] = {}
    entries = scope.get("items")
    for entry in entries if isinstance(entries, list) else ():
        if isinstance(entry, dict) and entry.get("kind") in COLLECTIONS and isinstance(entry.get("id"), str):
            found[(entry["kind"], entry["id"])] = None
    return list(found)


def _matches(rule: KindRule, record: Any) -> bool:
    return rule.statuses is None or record.status.value in rule.statuses


def _named_areas(trip: Trip, target: dict[str, set[str]]) -> set[str]:
    """The areas the target's updates, routes, visits and stays name."""
    named: set[str] = set()
    for update in trip.travel_updates:
        if update.id in target["travel_update"] and update.area is not None:
            named.add(update.area.id)
    for route in trip.routes:
        if route.id in target["route"]:
            named.update((route.departure_area_id, route.arrival_area_id))
    for visit in trip.visits:
        if visit.id in target["visit"]:
            named.add(visit.area_id)
    for stay in trip.stays:
        if stay.id in target["stay"]:
            named.add(stay.area_id)
    return named


def compute_target(trip: Trip, preset: SharingPreset) -> tuple[dict[str, set[str]], list[Reason]]:
    """The records the preset selects that can be shared right now, and those it selects but cannot sweep in.

    A record the preset's kind and status select but ``sharing_blocker`` refuses (an update without text, an unnamed
    area) is reported with the blocker's code, and so is a visit that already shows its times: a preset never adds a
    time. Photos are the approved copies attached to the included updates."""
    target: dict[str, set[str]] = {kind: set() for kind in KIND_ORDER}
    needs: list[Reason] = []
    for rule in preset.selects:
        for record in COLLECTIONS[rule.kind](trip):
            if not _matches(rule, record):
                continue
            if blocker := sharing_blocker(rule.kind, record):
                needs.append(Reason(rule.kind, record.id, blocker.code))
            elif rule.kind == "visit" and record.share_time:
                needs.append(Reason(rule.kind, record.id, "share_time_is_on"))
            else:
                target[rule.kind].add(record.id)
    if any(rule.kind == "area" for rule in preset.selects):
        # An area is shared for the records that name it, never on its own: an area no included record uses (a home
        # town, a stopover the owner keeps private) would reveal a place and add nothing to a visitor's map.
        target["area"] &= _named_areas(trip, target)
    for photo in trip.media_derivatives:
        if photo.travel_update_id not in target["travel_update"]:
            continue
        if blocker := sharing_blocker("media_derivative", photo):
            # Only a share copy is ever a candidate; other renditions of the original are not photos to decide about.
            if photo.purpose == DerivativePurpose.SHARE:
                needs.append(Reason("media_derivative", photo.id, blocker.code))
        else:
            target["media_derivative"].add(photo.id)
    return target, needs


def _scope_after(
    scope: dict, items: list[Ref], exclusions: list[Ref], precision: str | None, *, can_exclude: bool
) -> dict:
    document = {key: value for key, value in scope.items() if key not in {"items", "exclude"}}
    document["items"] = [{"kind": kind, "id": record_id} for kind, record_id in items]
    if can_exclude and exclusions:
        document["exclude"] = [{"kind": kind, "id": record_id} for kind, record_id in exclusions]
    if precision is not None:
        document["defaults"] = {**(scope.get("defaults") or {}), "date_precision": precision}
    return document


def _index(trip: Trip) -> dict[Ref, Any]:
    return {(kind, item.id): item for kind in KIND_ORDER for item in COLLECTIONS[kind](trip)}


def plan_preset(trip: Trip, audience: PresetAudience, preset_id: str) -> PresetPlan:
    """What choosing this preset for this audience would write, from the trip's records as they are now.

    Pure: it reads records and the audience's stored scope and changes nothing. Applying the plan is another step."""
    preset = _preset(preset_id)
    scope = audience.scope
    target, needs = compute_target(trip, preset)
    records = _index(trip)
    order = {ref: position for position, ref in enumerate(records)}
    changes: list[Change] = []
    replaces: list[Replacement] = []

    # Records the audience lists. A managed record the target does not contain is unlisted (it stays custom); the
    # rest of the list (locations, loose photos) is the owner's and kept as it is.
    listed = _listed(scope)
    kept = [ref for ref in listed if ref[0] not in MANAGED_KINDS or ref[1] in target[ref[0]]]
    for ref in listed:
        if ref not in kept and ref in records:
            changes.append(Change("unlist", *ref))
    already = set(kept)
    added: list[Ref] = []
    for kind in MANAGED_KINDS:
        for record in COLLECTIONS[kind](trip):
            if (
                record.id not in target[kind]
                or record.visibility == Visibility.EVERYONE
                or (kind, record.id) in already
            ):
                continue
            added.append((kind, record.id))
            if record.visibility == Visibility.PRIVATE:
                changes.append(Change("promote", kind, record.id))
            else:
                # A custom record this audience does not list: the owner left it out for this audience by hand.
                changes.append(Change("list", kind, record.id))
                replaces.append(Replacement(kind, record.id, "left_out_by_you"))
    items = kept + added

    exclusions: list[Ref] = []
    conflicts: set[Ref] = set()
    if audience.can_exclude:
        everything = {kind: set(ids) for kind, ids in target.items()}
        # An exclusion the owner made by hand stays only while it hides nothing the preset includes.
        for ref in stored_exclusions(scope):
            record = records.get(ref)
            if record is None or not is_excludable(trip, ref[0], record):
                continue  # stale: the record is gone or no longer set to everyone; a write drops it
            if ref[1] in everything[ref[0]] or _hides_target(trip, ref, everything):
                changes.append(Change("remove_exclusion", *ref))
                replaces.append(Replacement(ref[0], ref[1], "exclusion_removed"))
            else:
                exclusions.append(ref)
        hidden = _hidden_by(trip, exclusions)
        for kind in KIND_ORDER:
            if kind not in MANAGED_KINDS:
                continue
            for record in COLLECTIONS[kind](trip):
                ref = (kind, record.id)
                if (
                    record.id in target[kind]
                    or record.visibility != Visibility.EVERYONE
                    or sharing_blocker(kind, record) is not None
                    or ref in exclusions
                    or record.id in hidden.get(kind, ())
                ):
                    continue
                if _hides_target(trip, ref, everything):
                    conflicts.add(ref)
                    continue
                exclusions.append(ref)
                changes.append(Change("exclude", kind, record.id))
                hidden = _hidden_by(trip, exclusions)
        exclusions.sort(key=lambda ref: (ref[0], ref[1]))
    # The public view is the baseline and cannot exclude: its `everyone` records outside the target stay, and the
    # review lists them with the way out.

    before = audience_precision(scope)
    after = coarser(before, PRESET_DATE_PRECISION) or PRESET_DATE_PRECISION
    defaults = scope.get("defaults")
    stored = defaults.get("date_precision") if isinstance(defaults, dict) else None
    new_scope = _scope_after(
        scope, items, exclusions, after if stored != after else None, can_exclude=audience.can_exclude
    )

    plan = PresetPlan(
        preset=preset,
        audience=audience,
        target=target,
        changes=sorted(
            changes, key=lambda change: (_ACTION_ORDER[change.action], order.get((change.kind, change.id), 0))
        ),
        scope_after=new_scope,
        precision_before=before,
        precision_after=after,
        needs_decision=needs,
        replaces=replaces,
        conflicts=conflicts,
    )
    if len(items) > MAX_SCOPE_ITEMS or len(exclusions) > MAX_SCOPE_EXCLUSIONS:
        plan.refusal = PresetRefusal(
            code="preset_too_large",
            items=len(items),
            exclude=len(exclusions),
            max_items=MAX_SCOPE_ITEMS,
            max_exclude=MAX_SCOPE_EXCLUSIONS,
        )
    return plan


_ACTION_ORDER = {"promote": 0, "list": 1, "unlist": 2, "exclude": 3, "remove_exclusion": 4}


def _hidden_by(trip: Trip, exclusions: Iterable[Ref]) -> dict[str, set[str]]:
    seeds: dict[str, set[str]] = {}
    for kind, record_id in exclusions:
        seeds.setdefault(kind, set()).add(record_id)
    return closure(trip, seeds) if seeds else {}


def _hides_target(trip: Trip, ref: Ref, target: dict[str, set[str]]) -> bool:
    """Whether excluding this record would, through what depends on it, also hide a record the preset includes."""
    hidden = closure(trip, {ref[0]: {ref[1]}})
    return any(ids & target.get(kind, set()) for kind, ids in hidden.items())


def _other_audiences(session: Session, trip_id: str, audience: PresetAudience) -> list[tuple[str, dict]]:
    """Every other audience of the trip that can still deliver (drafts too, they deliver once activated), by id."""
    others: list[tuple[str, dict]] = []
    surface = session.get(PublicSurface, trip_id)
    if surface is not None:
        others.append(("public", surface.scope))
    for link in session.scalars(
        select(ShareLink).where(ShareLink.trip_id == trip_id, ShareLink.state.in_((LinkState.DRAFT, LinkState.ACTIVE)))
    ):
        others.append((f"link:{link.id}", link.scope))
    for member, _collection in session.execute(
        select(CollectionMember, Collection)
        .join(Collection, Collection.id == CollectionMember.collection_id)
        .where(CollectionMember.trip_id == trip_id, Collection.state.in_((LinkState.DRAFT, LinkState.ACTIVE)))
    ):
        others.append((f"collection:{member.id}", member.scope))
    return [(name, scope) for name, scope in others if name != audience.id]


def _received(trip: Trip, scope: dict) -> dict[str, set[str]]:
    return {kind: {item.id for item in items} for kind, items in delivered(trip, scope).items()}


def _counts(found: dict[str, set[str]] | Iterable[Ref]) -> dict[str, int]:
    if isinstance(found, dict):
        counts = {kind: len(found.get(kind, ())) for kind in KIND_ORDER}
    else:
        tally = Counter(kind for kind, _ in found)
        counts = {kind: tally[kind] for kind in KIND_ORDER}
    return {kind: count for kind, count in counts.items() if count}


def _coarser_dates(trip: Trip, before_scope: dict, after_scope: dict, kept: dict[str, set[str]]) -> dict[str, int]:
    """Records received both before and after whose date reads coarser afterwards, per kind."""
    cap_before, cap_after = audience_precision(before_scope), audience_precision(after_scope)
    counts = {"visit": 0, "stay": 0, "travel_update": 0}
    for kind in ("visit", "stay"):
        for record in COLLECTIONS[kind](trip):
            if record.id not in kept[kind] or (kind == "visit" and record.starts_on is None):
                continue
            was = effective_precision(own_value(record), cap_before)
            now = effective_precision(own_value(record), cap_after)
            counts[kind] += is_finer(was, now)
    for update in trip.travel_updates:
        if update.id in kept["travel_update"]:
            own = update.date_precision.value
            was = coarser(own, cap_before) or own
            now = coarser(own, cap_after) or own
            counts["travel_update"] += is_finer(was, now)
    return {kind: count for kind, count in counts.items() if count}


def _fingerprint(plan: PresetPlan, before: dict) -> str:
    canonical = json.dumps(
        {
            "preset": plan.preset.id,
            "audience": plan.audience.id,
            "scope": before,
            "changes": [[change.action, change.kind, change.id] for change in plan.changes],
            "precision": plan.precision_after,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


def review_preset(session: Session, trip: Trip, audience: PresetAudience, preset_id: str) -> SharingPresetReview:
    """Plan a preset for one audience and review it. Writes nothing; see ``build_review``."""
    return build_review(session, trip, audience, plan_preset(trip, audience, preset_id))


def build_review(session: Session, trip: Trip, audience: PresetAudience, plan: PresetPlan) -> SharingPresetReview:
    """Compare what the audience receives before and after a plan. Writes nothing.

    The planned visibility changes are made inside a nested transaction that is always rolled back, and the "after"
    is rendered by ``projection.delivered`` from the planned scope, which is never stored. Only that one function says
    what an audience receives, so the review cannot disagree with delivery. No revision is claimed, no audit event is
    recorded, and no other audience is touched: that is checked while the plan is applied, and a plan that would
    change what another audience receives fails instead of being reviewed."""
    index = _index(trip)

    def ref_of(ref: Ref) -> PresetRecordRef:
        return PresetRecordRef(
            kind=ref[0], id=ref[1], label=record_label(ref[0], index[ref]), day=record_date(ref[0], index[ref])
        )

    before = _received(trip, audience.scope)
    comparison: PresetComparison | None = None
    left: list[PresetLeftAsIs] = []
    coarser_dates: dict[str, int] = {}
    if plan.refusal is None:
        others = _other_audiences(session, trip.id, audience)
        others_before = {name: _received(trip, scope) for name, scope in others}
        touched = [index[ref] for ref in plan.promoted()]
        nested = session.begin_nested()
        try:
            for record in touched:
                record.visibility = Visibility.CUSTOM
            after = _received(trip, plan.scope_after)
            shown = delivered(trip, plan.scope_after)
            if {name: _received(trip, scope) for name, scope in others} != others_before:
                raise ServiceError(
                    "A sharing preset must not change what another audience receives",
                    code="preset_changed_another_audience",
                )
            left = _left_as_is(plan, shown, ref_of)
            coarser_dates = _coarser_dates(
                trip, audience.scope, plan.scope_after, {kind: before[kind] & after[kind] for kind in before}
            )
        finally:
            nested.rollback()
            for record in touched:
                session.expire(record)
        added = [(kind, record_id) for kind in KIND_ORDER for record_id in sorted(after[kind] - before[kind])]
        removed = [(kind, record_id) for kind in KIND_ORDER for record_id in sorted(before[kind] - after[kind])]
        comparison = PresetComparison(
            before=_counts(before),
            after=_counts(after),
            added=_counts(added),
            removed=_counts(removed),
            widened=[ref_of(ref) for ref in added],
            narrowed=[ref_of(ref) for ref in removed],
        )

    return SharingPresetReview(
        schema_version=PRESET_SCHEMA_VERSION,
        preset=plan.preset.id,
        audience=PresetAudienceInfo(id=audience.id, kind=audience.kind, label=audience.label, live=audience.live),
        applicable=plan.refusal is None,
        refusal=plan.refusal,
        changes=[PresetChange(action=c.action, **ref_of((c.kind, c.id)).model_dump()) for c in plan.changes],
        change_counts=dict(Counter(change.action for change in plan.changes)),
        precision=PresetPrecisionReview(
            before=plan.precision_before,
            after=plan.precision_after,
            changed=plan.precision_before != plan.precision_after,
            reads_coarser=coarser_dates,
        ),
        comparison=comparison,
        left_as_is=left,
        needs_decision=[
            PresetNeedsDecision(reason=r.reason, **ref_of((r.kind, r.id)).model_dump()) for r in plan.needs_decision
        ],
        replaces_exceptions=[
            PresetReplacesException(reason=r.reason, **ref_of((r.kind, r.id)).model_dump()) for r in plan.replaces
        ],
        requires_acknowledgement=audience.live and comparison is not None and bool(comparison.widened),
        fingerprint=_fingerprint(plan, audience.scope),
    )


def _left_as_is(plan: PresetPlan, shown: dict[str, list[Any]], ref_of) -> list[PresetLeftAsIs]:
    """What the audience keeps receiving although the preset does not include it, with the way out.

    A photo that travels with an update the audience receives is not listed on its own: the update is."""
    updates = {update.id for update in shown["travel_update"]}
    found: list[PresetLeftAsIs] = []
    for kind in KIND_ORDER:
        for record in shown[kind]:
            ref = (kind, record.id)
            if record.id in plan.target[kind] or (kind == "media_derivative" and record.travel_update_id in updates):
                continue
            if record.visibility == Visibility.CUSTOM:
                reason, way_out = "outside_preset", "unlist"
            elif ref in plan.conflicts:
                reason, way_out = "needed_by_included_records", "change_visibility"
            elif not plan.audience.can_exclude:
                reason, way_out = "everyone_on_public_view", "change_visibility"
            else:
                reason, way_out = "outside_preset", "exclude"
            found.append(PresetLeftAsIs(reason=reason, way_out=way_out, **ref_of(ref).model_dump()))
    return found


# --- the audiences a preset is applied to ----------------------------------------------------------------


PRESET_WIDENING_CODE = "preset_widening_needs_acknowledgement"
PRESET_STALE_CODE = "preset_preview_is_stale"
PRESET_TOO_LARGE_CODE = "preset_too_large"
# Records whose visibility a preset can change; it may only ever write ``custom`` (never ``everyone``).
Holder = PublicSurface | ShareLink | CollectionMember


def expired(expires_at: datetime | None) -> bool:
    if expires_at is None:
        return False
    return (expires_at if expires_at.tzinfo is not None else expires_at.replace(tzinfo=UTC)) <= datetime.now(UTC)


def audience_of(holder: Holder) -> PresetAudience:
    """The audience a stored public view, link or collection member is, with its current scope and rules."""
    if isinstance(holder, PublicSurface):
        return PresetAudience(
            id="public",
            kind="public",
            label=None,
            scope=holder.scope,
            live=holder.state == SurfaceState.PUBLISHED,
            can_exclude=False,
        )
    if isinstance(holder, ShareLink):
        return PresetAudience(
            id=f"link:{holder.id}",
            kind="link",
            label=holder.label,
            scope=holder.scope,
            live=holder.state == LinkState.ACTIVE and not expired(holder.expires_at),
            can_exclude=True,
        )
    collection = holder.collection
    return PresetAudience(
        id=f"collection:{holder.id}",
        kind="collection_member",
        label=collection.label,
        scope=holder.scope,
        live=collection.state == LinkState.ACTIVE and not expired(collection.expires_at),
        can_exclude=True,
    )


def preset_exceptions(trip: Trip, scope: dict, preset_id: str | None) -> PresetExceptions | None:
    """How the audience differs from what its last-applied preset would select today, or ``None`` without a label.

    Only the kinds a preset decides about are compared (areas, visits, stays, routes, updates); a location or a loose
    photo is the owner's own choice and never an exception. The result is computed, not stored, so a manual edit, a
    record created later and a deleted record are all reflected. A label from a newer application that this one does
    not know has no exceptions to compute."""
    preset = PRESETS.get(preset_id) if preset_id else None
    if preset is None:
        return None
    target, _ = compute_target(trip, preset)
    received = _received(trip, scope)
    index = _index(trip)

    def ref_of(ref: Ref) -> PresetRecordRef:
        return PresetRecordRef(
            kind=ref[0], id=ref[1], label=record_label(ref[0], index[ref]), day=record_date(ref[0], index[ref])
        )

    shown = [(kind, i) for kind in KIND_ORDER if kind in MANAGED_KINDS for i in sorted(received[kind] - target[kind])]
    hidden = [(kind, i) for kind in KIND_ORDER if kind in MANAGED_KINDS for i in sorted(target[kind] - received[kind])]
    return PresetExceptions(
        shown=[ref_of(ref) for ref in shown], hidden=[ref_of(ref) for ref in hidden], count=len(shown) + len(hidden)
    )


def exceptions_of(trip: Trip, holder: Holder) -> PresetExceptions | None:
    """The exceptions of a stored audience for the owner's responses: ``None`` when it carries no preset label."""
    if not holder.applied_preset:
        return None
    return preset_exceptions(trip, holder.scope, holder.applied_preset)


# --- applying a preset ------------------------------------------------------------------------------------


def _refuse(code: str, detail: dict[str, Any], session: Session) -> ApiException:
    """A 409 that stores nothing: the caller's transaction (and the revision it claimed) is rolled back."""
    session.rollback()
    return ApiException(status_code=status.HTTP_409_CONFLICT, detail={"code": code, **detail}, code=code)


def _never_everyone(plan: PresetPlan, index: dict[Ref, Any]) -> None:
    """A preset only turns private records into custom ones and lists custom ones: it never writes ``everyone``."""
    for change in plan.changes:
        record = index.get((change.kind, change.id))
        if record is None:
            raise ServiceError("A sharing preset names a record that is not on the trip", code="preset_unknown_record")
        if change.action == "promote" and record.visibility != Visibility.PRIVATE:
            raise ServiceError("A sharing preset promotes only private records", code="preset_must_not_write_everyone")
        if change.action in {"list", "unlist"} and record.visibility != Visibility.CUSTOM:
            raise ServiceError("A sharing preset lists only custom records", code="preset_must_not_write_everyone")
    for item in plan.scope_after.get("items", []):
        record = index.get((item["kind"], item["id"]))
        if record is not None and record.visibility == Visibility.EVERYONE:
            raise ServiceError("A sharing preset never lists an everyone record", code="preset_must_not_write_everyone")


def _written_everyone(session: Session) -> bool:
    """Whether the session is about to write ``everyone`` onto any record."""
    return any(
        getattr(record, "visibility", None) == Visibility.EVERYONE
        and "visibility" in inspect(record).attrs
        and inspect(record).attrs.visibility.history.has_changes()
        for record in session.dirty
    )


def _kind_counts(refs: Iterable[PresetRecordRef]) -> dict[str, int]:
    return _counts([(ref.kind, ref.id) for ref in refs])


def apply_preset(
    session: Session,
    trip: Trip,
    subject: str,
    holder: Holder,
    preset_id: str,
    *,
    fingerprint: str | None,
    confirm_widening: bool,
    claim: Callable[[], None] | None,
    new: bool = False,
) -> tuple[SharingPresetReview, bool]:
    """Write a reviewed preset for one audience in the caller's transaction; the caller commits.

    ``claim`` advances the audience's revision atomically (``If-Match``, 412 when stale) and runs first, so the row is
    locked while the plan is read and checked. Every refusal below rolls the transaction back, so a refused apply
    changes nothing, not even the revision. In order: the review's ``fingerprint`` must still match the plan
    (409 ``preset_preview_is_stale`` with a fresh review), a plan beyond the scope limits is refused
    (409 ``preset_too_large``), and a live audience that would newly receive records needs ``confirm_widening``
    (409 ``preset_widening_needs_acknowledgement``, the widening of decisions 27 and 36).

    A ``new`` audience (a link or collection member created with a preset) has received nothing yet: it carries no
    fingerprint, claims no revision and needs no acknowledgement.

    The writes are the ones the owner has by hand: private records in the target become ``custom`` and are listed,
    the scope is validated by ``prepare_scope`` like a manual edit, and the display label is set. The same plan on an
    unchanged audience that already carries this label writes nothing. Returns the applied review and whether
    anything was written."""
    if claim is not None:
        claim()
    audience = audience_of(holder)
    if new:
        audience = replace(audience, live=False)
    plan = plan_preset(trip, audience, preset_id)
    review = build_review(session, trip, audience, plan)
    if not new and review.fingerprint != fingerprint:
        raise _refuse(PRESET_STALE_CODE, {"review": review.model_dump(mode="json")}, session)
    if plan.refusal is not None:
        raise _refuse(PRESET_TOO_LARGE_CODE, plan.refusal.model_dump(exclude={"code"}), session)
    acknowledged = review.requires_acknowledgement and confirm_widening
    if review.requires_acknowledgement and not confirm_widening:
        assert review.comparison is not None  # a plan that widens has a comparison
        raise _refuse(
            PRESET_WIDENING_CODE,
            {
                "audience": review.audience.id,
                "counts": review.comparison.added,
                "widened": [ref.model_dump(mode="json") for ref in review.comparison.widened],
            },
            session,
        )
    if not new and not plan.changes and not review.precision.changed and holder.applied_preset == preset_id:
        session.rollback()  # nothing to write: give the claimed revision back
        return review, False

    index = _index(trip)
    others = _other_audiences(session, trip.id, audience)
    others_before = {name: _received(trip, scope) for name, scope in others}
    try:
        _never_everyone(plan, index)
        for ref in plan.promoted():
            set_visibility(trip, ref[0], ref[1], Visibility.CUSTOM)
        if _written_everyone(session):  # before the flush resets what the session knows it changed
            session.rollback()
            raise ServiceError("A sharing preset never writes everyone", code="preset_must_not_write_everyone")
        session.flush()
        scope = prepare_scope(trip, plan.scope_after, audience.scope, allow_exclusions=audience.can_exclude)
    except (ScopeError, ServiceError) as error:
        session.rollback()
        raise service_exception(status.HTTP_422_UNPROCESSABLE_CONTENT, error) from error
    holder.scope = scope
    holder.applied_preset = preset_id
    holder.applied_preset_at = datetime.now(UTC)
    session.flush()
    if {name: _received(trip, scope) for name, scope in others} != others_before:
        session.rollback()
        raise ServiceError(
            "A sharing preset must not change what another audience receives", code="preset_changed_another_audience"
        )

    comparison = review.comparison
    assert comparison is not None
    details: dict[str, Any] = {
        "preset": preset_id,
        "audience": audience.id,
        "on_creation": new,
        "live": audience.live,
        "widening_acknowledged": acknowledged,
        "changes": review.change_counts,
        "widened": comparison.added,
        "narrowed": comparison.removed,
        "left_as_is": _kind_counts(review.left_as_is),
        "needs_decision": _kind_counts(review.needs_decision),
        "replaced_exceptions": _kind_counts(review.replaces_exceptions),
        "precision": {"before": review.precision.before, "after": review.precision.after},
        "scope_version_before": scope_fingerprint(audience.scope),
        "scope_version_after": scope_fingerprint(scope),
    }
    if isinstance(holder, CollectionMember):
        record_collection_event(
            session,
            owner_subject=subject,
            actor_subject=subject,
            collection_id=holder.collection_id,
            trip_id=holder.trip_id,
            kind="collection.member_preset_apply",
            details={"member_id": holder.id, **details},
        )
    else:
        record_audit_event(
            session,
            trip_id=trip.id,
            actor_subject=subject,
            kind=AuditEventKind.AUDIENCE_PRESET_APPLY,
            target_type=AuditTargetType.PUBLIC_SURFACE
            if isinstance(holder, PublicSurface)
            else AuditTargetType.SHARE_LINK,
            target_id=holder.trip_id if isinstance(holder, PublicSurface) else holder.id,
            details=details,
        )
    return review, True
