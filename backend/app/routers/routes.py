"""Owner-only routes: how the traveller gets from one area to another.

A route always runs between two areas. The departure day, the exact locations,
the schedule, the booking details and a hand-drawn line are all optional. A day
comes first and a time is an optional second step: a route can be "on 5
December" before a train is chosen, and keeps that day when it gets its times.
The application takes no raw location data: there is no track upload, location
session or append-points endpoint.
"""

from datetime import UTC, date, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..auth import current_subject
from ..database import get_session
from ..errors import ApiException
from ..models import Area, DocumentAsset, Location, Route, RouteDocumentAsset, RouteStatus, Trip, Visibility
from ..schemas import RouteCreate, RouteResponse, RouteUpdate
from .placement import resolve_place, selected_area
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["routes"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def _route_query():
    return select(Route).options(
        selectinload(Route.departure_area),
        selectinload(Route.arrival_area),
        selectinload(Route.departure_location).selectinload(Location.area),
        selectinload(Route.arrival_location).selectinload(Location.area),
        selectinload(Route.document_links),
    )


def owned_route(trip: Trip, route_id: str) -> Route:
    route = next((item for item in trip.routes if item.id == route_id), None)
    if route is None:
        raise ApiException(status_code=status.HTTP_404_NOT_FOUND, detail="Route not found", code="not_found")
    return route


def validate_route_times(departs_at: datetime, arrives_at: datetime) -> None:
    # SQLite drops timezone information despite DateTime(timezone=True),
    # while PostgreSQL preserves it. Normalize only for the comparison so a
    # partial owner edit is valid on both supported database backends.
    comparable_departure = departs_at if departs_at.tzinfo is not None else departs_at.replace(tzinfo=UTC)
    comparable_arrival = arrives_at if arrives_at.tzinfo is not None else arrives_at.replace(tzinfo=UTC)
    if comparable_arrival <= comparable_departure:
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Arrival must be after departure",
            code="arrival_must_be_after_departure",
        )


def validate_distinct_ends(
    departure_area: Area, departure_location: Location | None, arrival_area: Area, arrival_location: Location | None
) -> None:
    """Refuse a route that starts and ends at the same place.

    The same place is the same location on both ends, or the same area on both
    ends with no location on either. Two locations inside one area (hotel to
    station), or a whole area and a location inside it, are different places.
    """
    if departure_location is not None or arrival_location is not None:
        same = (
            departure_location is not None
            and arrival_location is not None
            and departure_location.id == arrival_location.id
        )
    else:
        same = departure_area.id == arrival_area.id
    if same:
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Choose two different places: departure and arrival are the same",
            code="route_ends_are_the_same_place",
        )


def endpoint_instant(value: datetime, zone: str | None) -> datetime:
    """Resolve a route time to a UTC instant.

    A time with an offset is already an instant. A time without one is the
    local wall-clock time at that end, so it needs that end's zone; this keeps
    "AMS 10:40 -> TPE 06:25 the next day" exact regardless of the owner's
    browser time zone.
    """
    if value.tzinfo is None:
        if zone is None:
            raise ApiException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A time without an offset needs the end's time zone",
                code="a_time_without_an_offset_needs_the_end_s_time_zone",
            )
        value = value.replace(tzinfo=ZoneInfo(zone))
    return value.astimezone(UTC)


def local_departure_day(route: Route) -> date | None:
    """The calendar day of the route's departure instant in its departure time zone.

    Without a zone of its own, the departure area's zone applies, else UTC.
    """
    if route.departs_at is None:
        return None
    departs_at = route.departs_at if route.departs_at.tzinfo is not None else route.departs_at.replace(tzinfo=UTC)
    zone = route.departure_timezone or route.departure_area.timezone or "UTC"
    return departs_at.astimezone(ZoneInfo(zone)).date()


def settle_departure_day(route: Route, requested: date | None, given: bool) -> None:
    """Keep ``departs_on`` the local date of ``departs_at``: derive it, or refuse a different day.

    Without a time, the day is whatever was given, and stays when the times are cleared.
    """
    local = local_departure_day(route)
    if local is None:
        if given:
            route.departs_on = requested
        return
    if given and requested != local:
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"The departure day must be the local date of the departure time ({local.isoformat()})",
            code="departure_day_mismatch",
        )
    route.departs_on = local


def document_links_from_ids(session: Session, trip_id: str, document_asset_ids: list[str]) -> list[RouteDocumentAsset]:
    """Resolve attachments inside the already-authorized trip boundary.

    A client can only attach non-deleted documents owned by this trip.
    """
    if not document_asset_ids:
        return []
    assets = list(
        session.scalars(
            select(DocumentAsset).where(
                DocumentAsset.trip_id == trip_id,
                DocumentAsset.id.in_(document_asset_ids),
                DocumentAsset.deleted_at.is_(None),
            )
        )
    )
    if len(assets) != len(document_asset_ids):
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="One or more documents are unavailable for this trip",
            code="one_or_more_documents_are_unavailable_for_this_trip",
        )
    by_id = {asset.id: asset for asset in assets}
    return [RouteDocumentAsset(document_asset=by_id[asset_id]) for asset_id in document_asset_ids]


@router.get("/routes", response_model=list[RouteResponse])
def list_routes(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[Route]:
    return list(owned_trip(session, trip_id, subject).routes)


@router.post("/routes", response_model=RouteResponse, status_code=status.HTTP_201_CREATED)
def create_route(trip_id: str, payload: RouteCreate, session: SessionDep, subject: SubjectDep) -> Route:
    trip = owned_trip(session, trip_id, subject)
    departs_at = arrives_at = None
    if payload.departs_at is not None and payload.arrives_at is not None:
        departs_at = endpoint_instant(payload.departs_at, payload.departure_timezone)
        arrives_at = endpoint_instant(payload.arrives_at, payload.arrival_timezone)
        validate_route_times(departs_at, arrives_at)
    departure_area, departure_location = resolve_place(
        session, trip.id, payload.departure_area_id, payload.departure_location
    )
    arrival_area, arrival_location = resolve_place(session, trip.id, payload.arrival_area_id, payload.arrival_location)
    validate_distinct_ends(departure_area, departure_location, arrival_area, arrival_location)
    route = Route(
        trip=trip,
        departure_area=departure_area,
        arrival_area=arrival_area,
        departure_location=departure_location,
        arrival_location=arrival_location,
        document_links=document_links_from_ids(session, trip.id, payload.document_asset_ids),
        departs_at=departs_at,
        arrives_at=arrives_at,
        geometry=payload.geometry.model_dump() if payload.geometry is not None else None,
        **payload.model_dump(
            exclude={
                "departure_area_id",
                "arrival_area_id",
                "departure_location",
                "arrival_location",
                "document_asset_ids",
                "departs_on",
                "departs_at",
                "arrives_at",
                "geometry",
            }
        ),
    )
    settle_departure_day(route, payload.departs_on, payload.departs_on is not None)
    session.add(route)
    session.commit()
    return session.scalar(_route_query().where(Route.id == route.id))  # type: ignore[return-value]


@router.get("/routes/{route_id}", response_model=RouteResponse)
def get_route(trip_id: str, route_id: str, session: SessionDep, subject: SubjectDep) -> Route:
    return owned_route(owned_trip(session, trip_id, subject), route_id)


def _update_end(session: Session, trip: Trip, route: Route, payload: RouteUpdate, end: str) -> None:
    """Apply a change to one end of a route: its location, its area, or both."""
    fields = payload.model_fields_set
    location_input = getattr(payload, f"{end}_location")
    area_id = getattr(payload, f"{end}_area_id")
    if f"{end}_location" not in fields and f"{end}_area_id" not in fields:
        return
    if f"{end}_location" in fields and location_input is not None:
        area, location = resolve_place(session, trip.id, area_id, location_input)
    elif f"{end}_area_id" in fields and area_id is not None:
        area, location = selected_area(session, trip.id, area_id), None
        current = getattr(route, f"{end}_location")
        if current is not None and current.area_id == area.id and f"{end}_location" not in fields:
            location = current  # the same area: keep the exact location
    elif f"{end}_location" in fields:  # cleared: keep the area
        area, location = getattr(route, f"{end}_area"), None
    else:
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A route needs both its areas",
            code="a_route_needs_both_its_areas",
        )
    setattr(route, f"{end}_area", area)
    setattr(route, f"{end}_location", location)


@router.patch("/routes/{route_id}", response_model=RouteResponse)
def update_route(trip_id: str, route_id: str, payload: RouteUpdate, session: SessionDep, subject: SubjectDep) -> Route:
    trip = owned_trip(session, trip_id, subject)
    route = owned_route(trip, route_id)
    _update_end(session, trip, route, payload, "departure")
    _update_end(session, trip, route, payload, "arrival")
    # Judge the merged result, but only when this edit touches an end: an unrelated
    # edit must not lock the owner out of a route stored before the rule existed.
    if any(
        f"{end}_{part}" in payload.model_fields_set
        for end in ("departure", "arrival")
        for part in ("area_id", "location")
    ):
        validate_distinct_ends(
            route.departure_area, route.departure_location, route.arrival_area, route.arrival_location
        )
    if "document_asset_ids" in payload.model_fields_set:
        route.document_links = document_links_from_ids(session, trip.id, payload.document_asset_ids or [])
    values = payload.model_dump(
        exclude_unset=True,
        exclude={
            "departure_area_id",
            "arrival_area_id",
            "departure_location",
            "arrival_location",
            "document_asset_ids",
            "departs_on",
            "geometry",
        },
    )
    if "geometry" in payload.model_fields_set:
        route.geometry = payload.geometry.model_dump() if payload.geometry is not None else None
    for required in ("mode", "status"):
        if required in values and values[required] is None:
            raise ApiException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{required} is required",
                code="missing",
                field=required,
            )
    if {"departs_at", "arrives_at"} & values.keys():
        departs_at, arrives_at = values.get("departs_at", route.departs_at), values.get("arrives_at", route.arrives_at)
        if (departs_at is None) != (arrives_at is None):
            raise ApiException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Give both the departure and the arrival time, or neither",
                code="give_both_the_departure_and_the_arrival_time_or_neither",
            )
        if departs_at is not None and arrives_at is not None:
            if "departs_at" in values:
                departs_at = values["departs_at"] = endpoint_instant(
                    departs_at, values.get("departure_timezone", route.departure_timezone)
                )
            if "arrives_at" in values:
                arrives_at = values["arrives_at"] = endpoint_instant(
                    arrives_at, values.get("arrival_timezone", route.arrival_timezone)
                )
            validate_route_times(departs_at, arrives_at)
    for field, value in values.items():
        setattr(route, field, value)
    if route.status == RouteStatus.IDEA:
        # A candidate is never offered to an audience, so going back to an idea also takes it off any.
        route.visibility = Visibility.PRIVATE
    settle_departure_day(route, payload.departs_on, "departs_on" in payload.model_fields_set)
    session.commit()
    return session.scalar(_route_query().where(Route.id == route.id))  # type: ignore[return-value]


@router.delete("/routes/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_route(trip_id: str, route_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    session.delete(owned_route(owned_trip(session, trip_id, subject), route_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
