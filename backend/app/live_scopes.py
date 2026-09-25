"""Keep the live public and unlisted scopes consistent with the owner's records."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import PublicSurface, ShareLink


def remove_from_live_scopes(session: Session, *, trip_id: str, kind: str, item_id: str) -> None:
    """Withdraw one item from the public scope and every named link's scope.

    Called when the item is deleted or can no longer be chosen, so no live
    scope keeps pointing at something that is gone or has become private.
    """
    holders = [session.get(PublicSurface, trip_id), *session.scalars(select(ShareLink).where(ShareLink.trip_id == trip_id))]
    for holder in holders:
        if holder is None:
            continue
        scope = dict(holder.scope)
        items = scope.get("items", [])
        filtered = [item for item in items if not (item.get("kind") == kind and item.get("id") == item_id)]
        if len(filtered) != len(items):
            holder.scope = {**scope, "items": filtered}
