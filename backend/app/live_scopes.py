"""Keep the live public and unlisted scopes consistent with the owner's records."""

from collections import Counter

from sqlalchemy.orm import Session

from .audience import Reach, audiences_of_trip


def scope_picks(session: Session, trip_id: str) -> Counter[tuple[str, str]]:
    """How many scopes (the public page, every link and every collection member) list each ``(kind, id)`` item.

    These are the picks ``remove_from_live_scopes`` withdraws when a record
    stops being ``custom``, which cannot be restored by choosing it again."""
    picks: Counter[tuple[str, str]] = Counter()
    for audience in audiences_of_trip(session, trip_id, Reach.STORED):
        picks.update((item.get("kind"), item.get("id")) for item in audience.scope.get("items", []))
    return picks


def remove_from_live_scopes(session: Session, *, trip_id: str, kind: str, item_id: str) -> None:
    """Withdraw one item from the public scope and every named link's and collection member's scope.

    Called when the item is deleted or can no longer be chosen, so no live
    scope keeps pointing at something that is gone or has become private.
    """
    for audience in audiences_of_trip(session, trip_id, Reach.STORED):
        scope = dict(audience.scope)
        items = scope.get("items", [])
        filtered = [item for item in items if not (item.get("kind") == kind and item.get("id") == item_id)]
        if len(filtered) != len(items):
            audience.scope = {**scope, "items": filtered}
