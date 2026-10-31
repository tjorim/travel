"""What an owner edit to a shared place changes for the audiences that receive it.

The owner decided (#32) that a visitor-facing change to a location with live
receivers is allowed, but only once the owner has seen what changes and for
whom. These helpers compute that review from the same projection rules the
visitor views use, so the location editor, the MCP tool and the merge preview
(#27) agree on what is visitor-facing and who reaches it.
"""

from collections import Counter
from dataclasses import dataclass
from datetime import date
from typing import Any

from fastapi import status

from .access import receivers
from .audit import PUBLIC_AUDIENCE, LiveAudience
from .errors import ApiException
from .models import Area, Location
from .schemas import MergeAudience, MergeRecordRef, MergeWidenedRecord

# Location fields a visitor can read, in display order. The address parts are
# published only while the owner shares the address; ``locality`` is the region
# either way.
ALWAYS_VISIBLE = ("label", "locality", "country_code")
ADDRESS_FIELDS = ("address_line1", "address_line2", "postal_code", "admin_area")


@dataclass(frozen=True)
class FieldChange:
    """One visitor-facing change: the field, its value before and after, and who sees it."""

    field: str
    before: Any
    after: Any
    audiences: list[LiveAudience]
    # An area move also names the area labels and how many records ride along.
    before_label: str | None = None
    after_label: str | None = None
    visits: int = 0
    routes: int = 0

    def as_detail(self) -> dict[str, Any]:
        """The owner-facing description of the change; the audiences carry no scope."""
        detail: dict[str, Any] = {
            "field": self.field,
            "before": self.before,
            "after": self.after,
            "audiences": [{"id": audience.id, "label": audience.label} for audience in self.audiences],
        }
        if self.field == "area_id":
            detail |= {
                "before_label": self.before_label,
                "after_label": self.after_label,
                "visits": self.visits,
                "routes": self.routes,
            }
        return detail

    def as_audit(self) -> dict[str, Any]:
        """What the audit trail keeps: the field and audience ids, never the text itself."""
        entry: dict[str, Any] = {"field": self.field, "audiences": sorted(audience.id for audience in self.audiences)}
        if self.field == "area_id":
            entry |= {"visits": self.visits, "routes": self.routes}
        return entry


def location_visitor_view(location: Location) -> dict[str, str | None]:
    """The text fields of a location as visitors would read them now; an unshared address is absent."""
    fields = ALWAYS_VISIBLE + (ADDRESS_FIELDS if location.share_address else ())
    return {name: getattr(location, name) for name in fields}


def text_changes(
    before: dict[str, str | None], after: dict[str, str | None], audiences: list[LiveAudience]
) -> list[FieldChange]:
    """Fields whose visitor-readable value differs: sharing the address counts as adding its parts."""
    if not audiences:
        return []
    return [
        FieldChange(name, before.get(name), after.get(name), audiences)
        for name in ALWAYS_VISIBLE + ADDRESS_FIELDS
        if before.get(name) != after.get(name)
    ]


def reached_by(kind: str, record: Any, live: list[LiveAudience]) -> list[LiveAudience]:
    """The live audiences that receive this record by the rule delivery applies."""
    reached = receivers(kind, record, [(audience.id, audience.scope) for audience in live])
    return [audience for audience in live if audience.id in reached]


MERGE_WIDENING_CODE = "merge_widening_needs_acknowledgement"
MERGE_CHOICE_STALE_CODE = "merge_private_choice_is_stale"
# What a merge re-points, by the plural the merge previews use, and the share kind each is delivered as.
MOVED_KINDS = {"stays": "stay", "visits": "visit", "routes": "route", "travel_updates": "travel_update"}
PLURAL_KINDS = {kind: plural for plural, kind in MOVED_KINDS.items()}


@dataclass(frozen=True)
class Placement:
    """Where a moved record reads its place from, before and after a merge.

    A location shows its public name and exact point to an audience that
    receives it; an area shows its rounded point to one that receives it.
    ``None`` means the merge leaves that side of the place unchanged."""

    location_before: Location | None = None
    location_after: Location | None = None
    area_before: Area | None = None
    area_after: Area | None = None


@dataclass(frozen=True)
class MovedRecord:
    """A record a merge re-points: its kind (a ``MOVED_KINDS`` key), the record and the places it changes."""

    kind: str
    record: Any
    placements: list[Placement]


@dataclass(frozen=True)
class Widened:
    """An audience that starts to read more of the kept record, and how many moved records show it."""

    audience: LiveAudience
    counts: dict[str, int]

    @property
    def name(self) -> str:
        """The audience as the merge warnings name it, like ``narrowed_audiences``."""
        return "public page" if self.audience.id == PUBLIC_AUDIENCE else f"link {self.audience.label!r}"

    def as_detail(self) -> dict[str, Any]:
        return {"audience": self.audience.id, "label": self.audience.label, **self.counts}

    def as_audit(self) -> dict[str, Any]:
        """Ids and counts only: a link's label is the owner's own text."""
        return {"audience": self.audience.id, **self.counts}


@dataclass(frozen=True)
class WidenedRecord:
    """A moved record that starts to show some audiences a place: who gains it, and who reads it today."""

    kind: str  # the share kind: ``stay``, ``visit``, ``route`` or ``travel_update``
    record: Any
    gained: list[LiveAudience]
    readers: list[LiveAudience]

    @property
    def ref(self) -> tuple[str, str]:
        return self.kind, self.record.id


def widened_records(live: list[LiveAudience], moved: list[MovedRecord]) -> list[WidenedRecord]:
    """The moved records that newly show a place to a live audience that already receives them.

    A moved record already reaches an audience when it is delivered to it. The
    merge widens that audience's view when it receives the kept place and did
    not receive the duplicate's: the record then shows a location or an area
    point it did not before. Audiences that receive neither, or both, read
    nothing new."""
    if not live:
        return []
    cache: dict[tuple[str, str], set[str]] = {}

    def readers(kind: str, record: Any) -> set[str]:
        key = (kind, record.id)
        if key not in cache:
            cache[key] = {audience.id for audience in reached_by(kind, record, live)}
        return cache[key]

    def points(area: Area | None) -> set[str]:
        # An area is read as its rounded point only where it is delivered and has one.
        has_point = area is not None and area.latitude is not None and area.longitude is not None
        return readers("area", area) if area is not None and has_point else set()

    def locations(location: Location | None) -> set[str]:
        return readers("location", location) if location is not None else set()

    found: list[WidenedRecord] = []
    for entry in moved:
        gained: set[str] = set()
        for place in entry.placements:
            gained |= locations(place.location_after) - locations(place.location_before)
            gained |= points(place.area_after) - points(place.area_before)
        reading = readers(MOVED_KINDS[entry.kind], entry.record)
        gained &= reading
        if gained:
            found.append(
                WidenedRecord(
                    MOVED_KINDS[entry.kind],
                    entry.record,
                    [audience for audience in live if audience.id in gained],
                    [audience for audience in live if audience.id in reading],
                )
            )
    return found


def merge_widening(
    live: list[LiveAudience], found: list[WidenedRecord], private: set[tuple[str, str]]
) -> list[Widened]:
    """The live audiences that newly read a place, with the records that show it, per kind.

    Records the owner chose to make private first read nothing, so they are left out."""
    counts: dict[str, dict[str, int]] = {audience.id: dict.fromkeys(MOVED_KINDS, 0) for audience in live}
    for entry in found:
        if entry.ref not in private:
            for audience in entry.gained:
                counts[audience.id][PLURAL_KINDS[entry.kind]] += 1
    return [Widened(audience, counts[audience.id]) for audience in live if any(counts[audience.id].values())]


def _summary(kind: str, record: Any) -> tuple[str | None, date | None]:
    """A moved record's own name and start date, so the owner can tell records of one kind apart."""
    match kind:
        case "stay":
            return record.property_name, record.check_in_date
        case "visit":
            return record.title, record.starts_on
        case "route":
            return record.label, record.departs_on
        case _:
            return record.title, record.occurred_at.date()


def chosen_private(refs: list[MergeRecordRef], found: list[WidenedRecord]) -> set[tuple[str, str]]:
    """The records the owner chose to make private, each of which the merge must newly show to someone.

    A choice the current preview does not list is stale (the record, its sharing or the audiences changed
    since the owner looked), so the merge is refused rather than hiding something unreviewed."""
    chosen: set[tuple[str, str]] = {(ref.kind, ref.id) for ref in refs}
    offered = {entry.ref for entry in found}
    if stale := [ref for ref in sorted(chosen) if ref not in offered]:
        raise merge_choice_refusal(stale)
    return chosen


def audience_detail(audience: LiveAudience) -> MergeAudience:
    return MergeAudience(audience=audience.id, label=audience.label)


def widened_record_details(
    found: list[WidenedRecord], private: set[tuple[str, str]], picks: Counter[tuple[str, str]]
) -> list[MergeWidenedRecord]:
    """What the preview shows per record: who gains the place, who would lose the record if it were hidden."""
    details = []
    for entry in found:
        label, starts_on = _summary(entry.kind, entry.record)
        details.append(
            MergeWidenedRecord(
                kind=entry.kind,  # ty: ignore[invalid-argument-type]
                id=entry.record.id,
                label=label,
                starts_on=starts_on,
                visibility=entry.record.visibility.value,
                widened_for=[audience_detail(audience) for audience in entry.gained],
                hides_from=[audience_detail(audience) for audience in entry.readers if audience not in entry.gained],
                custom_picks=picks[entry.ref],
                make_private=entry.ref in private,
            )
        )
    return details


def merge_choice_refusal(stale: list[tuple[str, str]]) -> ApiException:
    """The 409 for a record to make private that the merge would not newly show to anyone."""
    return ApiException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": MERGE_CHOICE_STALE_CODE,
            "records": [{"kind": kind, "id": record_id} for kind, record_id in stale],
        },
        code=MERGE_CHOICE_STALE_CODE,
    )


def merge_widening_refusal(summaries: list[Any]) -> ApiException:
    """The 409 for a confirmed merge whose remaining widening the owner has not acknowledged.

    ``summaries`` are the merge's duplicates; only those that still widen someone are listed."""
    duplicates = [
        {"id": summary.id, "label": summary.label, "widened": [w.model_dump() for w in summary.widened]}
        for summary in summaries
        if summary.widened
    ]
    return ApiException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": MERGE_WIDENING_CODE, "duplicates": duplicates},
        code=MERGE_WIDENING_CODE,
    )
