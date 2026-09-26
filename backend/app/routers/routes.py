"""Owner-only routes: how the traveller gets from one area to another.

A route always runs between two areas. The exact locations, the schedule, the
booking details and a hand-drawn line are all optional. The application takes no
raw location data: there is no track upload, location session or append-points
endpoint.
"""

from datetime import UTC, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..auth import current_subject
from ..database import get_session
from ..models import DocumentAsset, Location, Route, RouteDocumentAsset, Trip
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Route not found")
    return route


def validate_route_times(departs_at: datetime, arrives_at: datetime) -> None:
    # SQLite drops timezone information despite DateTime(timezone=True),
    # while PostgreSQL preserves it. Normalize only for the comparison so a
    # partial owner edit is valid on both supported database backends.
    comparable_departure = departs_at if departs_at.tzinfo is not None else departs_at.replace(tzinfo=UTC)
    comparable_arrival = arrives_at if arrives_at.tzinfo is not None else arrives_at.replace(tzinfo=UTC)
    if comparable_arrival <= comparable_departure:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Arrival must be after departure",
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
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A time without an offset needs the end's time zone",
            )
        value = value.replace(tzinfo=ZoneInfo(zone))
    return value.astimezone(UTC)


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
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="One or more documents are unavailable for this trip",
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
                "departure_area_id", "arrival_area_id", "departure_location", "arrival_location",
                "document_asset_ids", "departs_at", "arrives_at", "geometry",
            }
        ),
    )
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
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A route needs both its areas")
    setattr(route, f"{end}_area", area)
    setattr(route, f"{end}_location", location)


@router.patch("/routes/{route_id}", response_model=RouteResponse)
def update_route(
    trip_id: str, route_id: str, payload: RouteUpdate, session: SessionDep, subject: SubjectDep
) -> Route:
    trip = owned_trip(session, trip_id, subject)
    route = owned_route(trip, route_id)
    _update_end(session, trip, route, payload, "departure")
    _update_end(session, trip, route, payload, "arrival")
    if "document_asset_ids" in payload.model_fields_set:
        route.document_links = document_links_from_ids(session, trip.id, payload.document_asset_ids or [])
    values = payload.model_dump(
        exclude_unset=True,
        exclude={
            "departure_area_id", "arrival_area_id", "departure_location", "arrival_location",
            "document_asset_ids", "geometry",
        },
    )
    if "geometry" in payload.model_fields_set:
        route.geometry = payload.geometry.model_dump() if payload.geometry is not None else None
    for required in ("mode", "status"):
        if required in values and values[required] is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{required} is required")
    if {"departs_at", "arrives_at"} & values.keys():
        departs_at, arrives_at = values.get("departs_at", route.departs_at), values.get("arrives_at", route.arrives_at)
        if (departs_at is None) != (arrives_at is None):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Give both the departure and the arrival time, or neither",
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
    session.commit()
    return session.scalar(_route_query().where(Route.id == route.id))  # type: ignore[return-value]


@router.delete("/routes/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_route(trip_id: str, route_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    session.delete(owned_route(owned_trip(session, trip_id, subject), route_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
