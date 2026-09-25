"""Who receives a record: the one rule every shareable kind follows.

Each shareable record carries a ``visibility``. ``private`` reaches nobody,
``everyone`` reaches the public view and every hidden link, and ``custom``
reaches only the views whose scope lists it. This module knows which kinds are
shareable, when one *cannot* be shared yet, and keeps live scopes consistent
when a record is deleted or stops being ``custom``.
"""

from collections.abc import Callable
from typing import Any

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from .live_scopes import remove_from_live_scopes
from .models import (
    BroadRoute,
    DerivativePurpose,
    DerivativeReviewState,
    DocumentDerivative,
    MediaDerivative,
    Place,
    PlaceKind,
    RouteStage,
    Stay,
    TransportLeg,
    TravelUpdate,
    Trip,
    Visibility,
)

# Scope kind -> where a trip keeps that kind of record.
COLLECTIONS: dict[str, Callable[[Trip], list[Any]]] = {
    "place": lambda trip: trip.places,
    "route_stage": lambda trip: trip.route_stages,
    "broad_route": lambda trip: trip.broad_routes,
    "stay": lambda trip: trip.stays,
    "transport_leg": lambda trip: trip.transport_legs,
    "travel_update": lambda trip: trip.travel_updates,
    "media_derivative": lambda trip: trip.media_derivatives,
    "document_derivative": lambda trip: trip.document_derivatives,
}

_KIND_OF_MODEL: dict[type, str] = {
    Place: "place",
    RouteStage: "route_stage",
    BroadRoute: "broad_route",
    Stay: "stay",
    TransportLeg: "transport_leg",
    TravelUpdate: "travel_update",
    MediaDerivative: "media_derivative",
    DocumentDerivative: "document_derivative",
}


def find_record(trip: Trip, kind: str, record_id: str) -> Any | None:
    """A record of this kind on this trip, or nothing."""
    return next((item for item in COLLECTIONS[kind](trip) if item.id == record_id), None)


def sharing_blocker(kind: str, record: Any) -> str | None:
    """Why this record cannot be shared yet, or ``None`` when it can.

    This gate applies both when the owner chooses a visibility and again at
    delivery, so a record that stops qualifying is never served.
    """
    if kind == "place" and record.kind == PlaceKind.EXACT and not record.label:
        return "Give this spot a public name before sharing it"
    if kind == "travel_update" and not record.body.strip():
        return "Write the text for visitors before sharing this update"
    if kind == "stay" and record.area is None:
        return "Choose the city or area of this stay before sharing it"
    if kind in {"media_derivative", "document_derivative"}:
        if record.review_state != DerivativeReviewState.APPROVED:
            return "Approve this copy before sharing it"
        asset = record.media_asset if kind == "media_derivative" else record.document_asset
        if asset.deleted_at is not None:
            return "The original has been deleted"
    if kind == "media_derivative" and record.purpose != DerivativePurpose.SHARE:
        return "Only a share copy can be shared"
    return None


def is_delivered(kind: str, record: Any, chosen: set[str]) -> bool:
    """Whether an audience whose scope lists ``chosen`` receives this record."""
    if sharing_blocker(kind, record) is not None:
        return False
    return record.visibility == Visibility.EVERYONE or (
        record.visibility == Visibility.CUSTOM and record.id in chosen
    )


def set_visibility(trip: Trip, kind: str, record_id: str, visibility: Visibility) -> Any | None:
    """Apply the choice, or return ``None`` when the record is not on the trip.

    Raises ``ValueError`` with the owner-readable reason when the record cannot
    be shared yet.
    """
    record = find_record(trip, kind, record_id)
    if record is None:
        return None
    if visibility != Visibility.PRIVATE and (blocker := sharing_blocker(kind, record)):
        raise ValueError(blocker)
    record.visibility = visibility
    return record


@event.listens_for(Session, "before_flush")
def _withdraw_from_scopes(session: Session, _context: object, _instances: object) -> None:
    """Take a record out of every live scope once it is gone or no longer custom.

    Doing this on flush covers every way a record can change: the app, the MCP
    tools and cascades from a deleted parent.
    """
    withdrawn: list[tuple[str, str, str]] = []
    for record in session.deleted:
        if kind := _KIND_OF_MODEL.get(type(record)):
            withdrawn.append((record.trip_id, kind, record.id))
    for record in session.dirty:
        kind = _KIND_OF_MODEL.get(type(record))
        if kind and record.visibility != Visibility.CUSTOM and inspect(record).attrs.visibility.history.has_changes():
            withdrawn.append((record.trip_id, kind, record.id))
    with session.no_autoflush:
        for trip_id, kind, record_id in withdrawn:
            remove_from_live_scopes(session, trip_id=trip_id, kind=kind, item_id=record_id)
