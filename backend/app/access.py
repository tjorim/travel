"""Who receives a record: the one rule every shareable kind follows.

Each shareable record carries a ``visibility``. ``private`` reaches nobody,
``everyone`` reaches the public view and every hidden link, and ``custom``
reaches only the views whose scope lists it. This module knows which kinds are
shareable, when one *cannot* be shared yet, and keeps live scopes consistent
when a record is deleted or stops being ``custom``.
"""

from collections.abc import Callable
from typing import Any

from sqlalchemy import event, inspect, select
from sqlalchemy.orm import Session, object_session

from .errors import ServiceError
from .live_scopes import remove_from_live_scopes
from .models import (
    Area,
    DerivativeProcessingState,
    DerivativePurpose,
    DerivativeReviewState,
    LinkState,
    Location,
    MediaDerivative,
    MediaKind,
    PublicSurface,
    Route,
    RouteStatus,
    ShareLink,
    Stay,
    StayStatus,
    TravelUpdate,
    Trip,
    Visibility,
    Visit,
    VisitStatus,
)

# Scope kind -> where a trip keeps that kind of record.
COLLECTIONS: dict[str, Callable[[Trip], list[Any]]] = {
    "area": lambda trip: trip.areas,
    "location": lambda trip: trip.locations,
    "visit": lambda trip: trip.visits,
    "route": lambda trip: trip.routes,
    "stay": lambda trip: trip.stays,
    "travel_update": lambda trip: trip.travel_updates,
    "media_derivative": lambda trip: trip.media_derivatives,
}

_KIND_OF_MODEL: dict[type, str] = {
    Area: "area",
    Location: "location",
    Visit: "visit",
    Route: "route",
    Stay: "stay",
    TravelUpdate: "travel_update",
    MediaDerivative: "media_derivative",
}


def find_record(trip: Trip, kind: str, record_id: str) -> Any | None:
    """A record of this kind on this trip, or nothing."""
    return next((item for item in COLLECTIONS[kind](trip) if item.id == record_id), None)


class SharingBlocker(str):
    """Keep the diagnostic string API while carrying a language-neutral cause."""

    code: str

    def __new__(cls, message: str, code: str):
        value = super().__new__(cls, message)
        value.code = code
        return value


def sharing_blocker(kind: str, record: Any) -> SharingBlocker | None:
    """Why this record cannot be shared yet, or ``None`` when it can.

    This gate applies both when the owner chooses a visibility and again at
    delivery, so a record that stops qualifying is never served.
    """
    if kind == "location" and not record.label:
        return SharingBlocker(
            "Give this location a public name before sharing it", "give_this_location_a_public_name_before_sharing_it"
        )
    if kind == "stay" and record.status == StayStatus.IDEA:
        return SharingBlocker(
            "A stay idea is only a candidate: make it planned before sharing it",
            "a_stay_idea_is_only_a_candidate_make_it_planned_before_sharing_it",
        )
    if kind == "route" and record.status == RouteStatus.IDEA:
        return SharingBlocker(
            "A route idea is only a candidate: make it planned before sharing it",
            "a_route_idea_is_only_a_candidate_make_it_planned_before_sharing_it",
        )
    if kind == "visit" and record.status == VisitStatus.CANCELLED:
        # The visit status itself is never shared, so a dropped visit would otherwise read as a plan.
        return SharingBlocker(
            "A cancelled visit is no longer planned: it cannot be shared",
            "a_cancelled_visit_is_no_longer_planned_it_cannot_be_shared",
        )
    if kind == "travel_update" and not record.body.strip():
        return SharingBlocker(
            "Write the text for visitors before sharing this update",
            "write_the_text_for_visitors_before_sharing_this_update",
        )
    if kind == "media_derivative":
        if record.processing_state.value != "ready" or record.object_id is None:
            return SharingBlocker("Wait for this copy to finish processing", "wait_for_this_copy_to_finish_processing")
        if record.review_state != DerivativeReviewState.APPROVED:
            return SharingBlocker("Approve this copy before sharing it", "approve_this_copy_before_sharing_it")
        asset = record.media_asset
        if asset.deleted_at is not None:
            return SharingBlocker("The original has been deleted", "the_original_has_been_deleted")
    if kind == "media_derivative" and record.purpose != DerivativePurpose.SHARE:
        return SharingBlocker("Only a share copy can be shared", "only_a_share_copy_can_be_shared")
    return None


def set_cover(trip: Trip, derivative_id: str | None) -> None:
    """Nominate one of the trip's photo copies as its cover, or clear the choice.

    Choosing a cover publishes nothing: an audience shows it only when it
    already receives that copy (see ``projection``). So the copy need not be
    approved or shared yet, but it must be something that could be: a ready
    share copy of a photo whose original still exists.
    """
    if derivative_id is None:
        for item in trip.media_derivatives:
            item.is_cover = False
        return
    chosen = next((item for item in trip.media_derivatives if item.id == derivative_id), None)
    if (
        chosen is None
        or chosen.purpose != DerivativePurpose.SHARE
        or chosen.media_asset.media_kind != MediaKind.PHOTO
        or chosen.processing_state != DerivativeProcessingState.READY
        or chosen.object_id is None
        or chosen.media_asset.deleted_at is not None
    ):
        raise ServiceError(
            "Choose a finished share copy of a photo as the cover", code="choose_a_finished_share_copy_of_a_photo"
        )
    # Retire the old cover first: the one-cover-per-trip index is checked per statement.
    for item in trip.media_derivatives:
        if item is not chosen:
            item.is_cover = False
    if (session := object_session(trip)) is not None:
        session.flush()
    chosen.is_cover = True


def is_delivered(kind: str, record: Any, chosen: set[str]) -> bool:
    """Whether an audience whose scope lists ``chosen`` receives this record."""
    if sharing_blocker(kind, record) is not None:
        return False
    return record.visibility == Visibility.EVERYONE or (record.visibility == Visibility.CUSTOM and record.id in chosen)


def trip_audiences(session: Session, trip_id: str) -> list[tuple[str, dict]]:
    """Each audience that can still receive this trip's records: its name and live scope."""
    audiences = []
    if (surface := session.get(PublicSurface, trip_id)) is not None:
        audiences.append(("public page", surface.scope))
    for link in session.scalars(
        select(ShareLink)
        .where(ShareLink.trip_id == trip_id, ShareLink.state.in_((LinkState.DRAFT, LinkState.ACTIVE)))
        .order_by(ShareLink.created_at)
    ):
        audiences.append((f"link {link.label!r}", link.scope))
    return audiences


def receivers(kind: str, record: Any, audiences: list[tuple[str, dict]]) -> set[str]:
    """The names of the audiences this record reaches, by the rule delivery applies."""
    return {
        name
        for name, scope in audiences
        if is_delivered(
            kind,
            record,
            {item.get("id") for item in scope.get("items", []) if item.get("kind") == kind},
        )
    }


def set_visibility(trip: Trip, kind: str, record_id: str, visibility: Visibility) -> Any | None:
    """Apply the choice, or return ``None`` when the record is not on the trip.

    Raises ``ValueError`` with the owner-readable reason when the record cannot
    be shared yet.
    """
    record = find_record(trip, kind, record_id)
    if record is None:
        return None
    if visibility != Visibility.PRIVATE and (blocker := sharing_blocker(kind, record)):
        raise ServiceError(str(blocker), code=blocker.code)
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
