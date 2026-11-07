"""Owner-only review of a scope's exclusions: what each hides, and what removing one would reveal.

Everything here reads the same ``delivered`` the visitor views use, so the review can never disagree
with what an audience receives. None of it reaches a visitor.
"""

from typing import Any

from .exclusions import KIND_ORDER, Hidden, closure, effective_exclusions, hidden_records, stored_exclusions
from .models import Trip
from .projection import delivered
from .schemas import ExcludedRecord, ExclusionRef, ExclusionReview, ExclusionWidening, ScopeExclusions


def _counts(refs: list[tuple[str, str]]) -> dict[str, int]:
    counts = {kind: sum(1 for item_kind, _ in refs if item_kind == kind) for kind in KIND_ORDER}
    return {kind: count for kind, count in counts.items() if count}


def _ordered(found: dict[str, set[str]]) -> list[tuple[str, str]]:
    return [(kind, record_id) for kind in KIND_ORDER for record_id in sorted(found.get(kind, ()))]


def scope_exclusions(trip: Trip, scope: dict) -> ScopeExclusions:
    """The effective exclusions of one scope, each with the records it also hides for this audience.

    "Also hides" counts only records the audience would otherwise receive, so it is what the visitors
    of this link actually lose. A scope without ``exclude`` gives an empty review."""
    stored = stored_exclusions(scope)
    if not stored:
        return ScopeExclusions()
    seeds = effective_exclusions(trip, scope)
    hidden: Hidden = hidden_records(trip, scope)
    received = {
        kind: {item.id for item in items} for kind, items in delivered(trip, scope, with_exclusions=False).items()
    }
    excluded = []
    for kind, record_id in _ordered(seeds):
        also = {other: ids & received.get(other, set()) for other, ids in closure(trip, {kind: {record_id}}).items()}
        also[kind] = also.get(kind, set()) - {record_id}
        refs = _ordered(also)
        excluded.append(
            ExcludedRecord(
                kind=kind,
                id=record_id,
                received=record_id in received.get(kind, set()),
                hides=_counts(refs),
                also_hides=[ExclusionRef(kind=k, id=i) for k, i in refs],
            )
        )
    together = _ordered({kind: ids & received.get(kind, set()) for kind, ids in hidden.cascaded.items()})
    return ScopeExclusions(
        excluded=excluded,
        also_hidden=_counts(together),
        stale=len(stored) - sum(len(ids) for ids in seeds.values()),
    )


def exclusion_review(trip: Trip, scope: dict) -> ExclusionReview:
    """``scope_exclusions`` plus the baseline: every record the public baseline reaches, which an audience may exclude."""
    review = scope_exclusions(trip, scope)
    baseline = delivered(trip, {})
    return ExclusionReview(
        **review.model_dump(),
        baseline=[ExclusionRef(kind=kind, id=item.id) for kind in KIND_ORDER for item in baseline[kind]],
    )


def widening(trip: Trip, before: dict, after: dict) -> ExclusionWidening:
    """The records ``after`` delivers that the exclusions of ``before`` kept from this audience.

    These are what removing an exclusion newly shows: a link that was narrower than the public view gets
    wider. Records the audience gains in other ways (a ``custom`` record it newly lists) are not counted."""
    was_hidden = hidden_records(trip, before)
    if not was_hidden:
        return ExclusionWidening()
    now = delivered(trip, after)
    refs = [(kind, item.id) for kind in KIND_ORDER for item in now[kind] if (kind, item.id) in was_hidden]
    return ExclusionWidening(
        revealed=[ExclusionRef(kind=kind, id=record_id) for kind, record_id in refs],
        counts=_counts(refs),
    )


def exclusion_changes(before: dict, after: dict) -> dict[str, Any] | None:
    """For an audit entry: the exclusion ids added and removed between two scopes, or ``None`` when unchanged.

    Ids only; no label or other owner text."""
    old, new = set(stored_exclusions(before)), set(stored_exclusions(after))
    if old == new:
        return None
    ref = lambda pair: {"kind": pair[0], "id": pair[1]}  # noqa: E731
    return {"added": [ref(pair) for pair in sorted(new - old)], "removed": [ref(pair) for pair in sorted(old - new)]}
