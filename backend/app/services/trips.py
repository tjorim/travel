"""Ownership of a trip: every owner operation starts here."""

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..errors import RecordNotFound
from ..models import Location, MediaDerivative, Route, Stay, TravelUpdate, Trip
from ..schemas import Identifier


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
