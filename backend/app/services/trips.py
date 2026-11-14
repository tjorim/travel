"""Ownership of a trip: every owner operation starts here."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..access import set_cover
from ..audit import scrub_trip_audit_text
from ..errors import RecordNotFound, Refusal, ServiceError, service_error
from ..models import (
    Location,
    MediaDerivative,
    ObjectState,
    Route,
    Stay,
    StoredObject,
    TravelUpdate,
    Trip,
    cover_file_route,
)
from ..overview import trip_overview
from ..schemas import Identifier, TripCreate, TripResponse, TripSummaryResponse, TripUpdate

DEFAULT_TRIP_PAGE = 100


def trip_query():
    return select(Trip).options(
        selectinload(Trip.areas),
        selectinload(Trip.locations),
        selectinload(Trip.travel_updates).selectinload(TravelUpdate.chosen_area),
        selectinload(Trip.travel_updates).selectinload(TravelUpdate.location).selectinload(Location.area),
        selectinload(Trip.travel_updates).selectinload(TravelUpdate.media_links),
        selectinload(Trip.stays).selectinload(Stay.area),
        selectinload(Trip.stays).selectinload(Stay.location).selectinload(Location.area),
        selectinload(Trip.stays).selectinload(Stay.document_links),
        selectinload(Trip.routes).selectinload(Route.departure_area),
        selectinload(Trip.routes).selectinload(Route.arrival_area),
        selectinload(Trip.routes).selectinload(Route.departure_location).selectinload(Location.area),
        selectinload(Trip.routes).selectinload(Route.arrival_location).selectinload(Location.area),
        selectinload(Trip.routes).selectinload(Route.document_links),
        selectinload(Trip.trip_tasks),
        selectinload(Trip.media_derivatives).selectinload(MediaDerivative.media_asset),
    )


def owned_trip(session: Session, trip_id: Identifier, subject: str, *, load_relations: bool = False) -> Trip:
    """The owner's trip, or 404.

    By default this reads only the trip row: the check that the subject owns it. A handler that walks the trip's
    records (a projection, the overview, a response that embeds them) passes ``load_relations=True``; everything
    else reads the records it needs with a query of its own, so a write costs the same in a trip of any size.
    """
    statement = trip_query() if load_relations else select(Trip)
    trip = session.scalar(statement.where(Trip.id == trip_id, Trip.owner_subject == subject))
    if trip is None:
        raise RecordNotFound("Trip not found")
    return trip


def _covers(session: Session, trip_ids: list[str]) -> dict[str, MediaDerivative]:
    """The chosen cover copy of each trip, in one query that reads no other copy of the trip."""
    return {
        cover.trip_id: cover
        for cover in session.scalars(
            select(MediaDerivative).where(MediaDerivative.trip_id.in_(trip_ids), MediaDerivative.is_cover.is_(True))
        )
    }


def _trip_fields(trip: Trip, cover: MediaDerivative | None) -> dict:
    return {
        "id": trip.id,
        "owner_subject": trip.owner_subject,
        "title": trip.title,
        "summary": trip.summary,
        "starts_on": trip.starts_on,
        "ends_on": trip.ends_on,
        "cover_derivative_id": cover.id if cover else None,
        "cover_url": cover_file_route(trip.id, cover) if cover else None,
    }


def trip_response(session: Session, trip: Trip) -> TripResponse:
    """The trip's own fields and cover: two small queries, whatever the trip holds."""
    return TripResponse(**_trip_fields(trip, _covers(session, [trip.id]).get(trip.id)))


def list_trips(
    session: Session, subject: str, *, q: str | None = None, limit: int = DEFAULT_TRIP_PAGE, offset: int = 0
) -> list[TripSummaryResponse]:
    """The owner's trips, newest first, without any embedded record."""
    statement = select(Trip).where(Trip.owner_subject == subject).order_by(Trip.created_at.desc(), Trip.id)
    if q:
        statement = statement.where(Trip.title.ilike(f"%{q}%"))
    found = list(session.scalars(statement.limit(limit).offset(offset)))
    ids = [trip.id for trip in found]
    covers = _covers(session, ids)
    updates = {
        trip_id: (count, last)
        for trip_id, count, last in session.execute(
            select(TravelUpdate.trip_id, func.count(), func.max(TravelUpdate.occurred_at))
            .where(TravelUpdate.trip_id.in_(ids))
            .group_by(TravelUpdate.trip_id)
        )
    }
    summaries = []
    for trip in found:
        update_count, last_update_at = updates.get(trip.id, (0, None))
        summaries.append(
            TripSummaryResponse(
                **_trip_fields(trip, covers.get(trip.id)),
                travel_update_count=update_count,
                last_update_at=last_update_at,
            )
        )
    return summaries


def create_trip(session: Session, subject: str, payload: TripCreate) -> TripResponse:
    trip = Trip(owner_subject=subject, **payload.model_dump())
    session.add(trip)
    session.flush()
    return trip_response(session, trip)


def get_trip(session: Session, subject: str, trip_id: Identifier) -> TripResponse:
    return trip_response(session, owned_trip(session, trip_id, subject))


def get_trip_overview(session: Session, subject: str, trip_id: Identifier) -> dict:
    """Counts per kind, what each audience receives, and what to review before sharing."""
    return trip_overview(session, owned_trip(session, trip_id, subject, load_relations=True))


def update_trip(session: Session, subject: str, trip_id: Identifier, payload: TripUpdate) -> TripResponse:
    trip = owned_trip(session, trip_id, subject)
    changes = payload.model_dump(exclude_unset=True)
    if "cover_derivative_id" in changes:
        try:
            set_cover(trip, changes.pop("cover_derivative_id"))
        except ServiceError as error:
            raise service_error(error) from error
    for field, value in changes.items():
        setattr(trip, field, value)
    if trip.starts_on is not None and trip.ends_on is not None and trip.ends_on < trip.starts_on:
        raise Refusal("The trip cannot end before it starts", code="the_trip_cannot_end_before_it_starts")
    session.flush()
    return trip_response(session, trip)


def delete_trip(session: Session, subject: str, trip_id: Identifier) -> None:
    """Delete the trip and everything it holds; its stored objects wait for the purge (``docs/object-storage.md``)."""
    # The delete cascades through the records and their links, so read them together instead of one by one.
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    # Serialize with result attachment before taking the final object inventory.
    # Worker jobs survive derivative deletion with a null link; dispatch retries
    # cancellation/ACK without making any provider call inside this transaction.
    list(session.scalars(select(MediaDerivative).where(MediaDerivative.trip_id == trip_id).with_for_update()))
    for stored in session.scalars(select(StoredObject).where(StoredObject.trip_id == trip_id).with_for_update()):
        stored.state = ObjectState.PURGE_PENDING
        stored.trip_id = None
    session.flush()
    scrub_trip_audit_text(session, trip_id)
    session.delete(trip)
    session.flush()
