"""Owner-only visits: the stops of the trip, and when the traveller is at each."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..auth import current_subject
from ..database import get_session
from ..errors import ApiException, service_exception
from ..models import VISIT_ORDER, Location, PlanningStatus, Trip, Visibility, Visit
from ..route_overlap import overlapping_routes, route_title
from ..schemas import (
    Identifier,
    RouteReference,
    VisitCreate,
    VisitResponse,
    VisitRouteCheck,
    VisitUpdate,
    require_visit_times,
)
from .placement import resolve_place, selected_area
from .routes import trip_routes
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["visits"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def _visit_query():
    return select(Visit).options(selectinload(Visit.area), selectinload(Visit.location).selectinload(Location.area))


def trip_visits(session: Session, trip: Trip, *, with_places: bool = False) -> list[Visit]:
    statement = _visit_query() if with_places else select(Visit)
    return list(session.scalars(statement.where(Visit.trip_id == trip.id).order_by(*VISIT_ORDER)))


def owned_visit(session: Session, trip: Trip, visit_id: Identifier) -> Visit:
    visit = session.scalar(select(Visit).where(Visit.id == visit_id, Visit.trip_id == trip.id))
    if visit is None:
        raise ApiException(status_code=status.HTTP_404_NOT_FOUND, detail="Visit not found", code="not_found")
    return visit


def flag_route_overlaps(session: Session, trip: Trip, *visits: Visit) -> None:
    """Note, for the response only, which routes each visit probably restates."""
    # An undated visit restates no route, so the routes are read only when some visit has a date.
    routes = trip_routes(session, trip) if any(visit.starts_on for visit in visits) else []
    for visit in visits:
        visit.possible_route_duplicates = [  # ty: ignore[unresolved-attribute]
            {"id": route.id, "title": route_title(route)} for route in overlapping_routes(visit, routes)
        ]


@router.get("/visits", response_model=list[VisitResponse])
def list_visits(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> list[Visit]:
    trip = owned_trip(session, trip_id, subject)
    visits = trip_visits(session, trip, with_places=True)
    flag_route_overlaps(session, trip, *visits)
    return visits


@router.post("/visits", response_model=VisitResponse, status_code=status.HTTP_201_CREATED)
def create_visit(trip_id: Identifier, payload: VisitCreate, session: SessionDep, subject: SubjectDep) -> Visit:
    trip = owned_trip(session, trip_id, subject)
    area, location = resolve_place(session, trip.id, payload.area_id, payload.location)
    visit = Visit(
        trip_id=trip.id,
        area=area,
        location=location,
        **payload.model_dump(exclude={"area_id", "location"}),
    )
    session.add(visit)
    session.commit()
    saved = session.scalar(_visit_query().where(Visit.id == visit.id))
    flag_route_overlaps(session, trip, saved)  # type: ignore[arg-type]
    return saved  # type: ignore[return-value]


@router.post("/visits/route-check", response_model=list[RouteReference])
def check_visit_against_routes(
    trip_id: Identifier, payload: VisitRouteCheck, session: SessionDep, subject: SubjectDep
) -> list[dict[str, str]]:
    """Which routes a visit that is not saved yet would restate. Saves nothing and never blocks the save."""
    trip = owned_trip(session, trip_id, subject)
    if payload.location_id is not None:
        location = session.get(Location, payload.location_id)
        if location is None or location.trip_id != trip.id:
            raise ApiException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found", code="not_found")
        area_id = location.area_id
    elif payload.area_id is not None:
        area_id = selected_area(session, trip.id, payload.area_id).id
    else:
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Say where: an area or a location",
            code="say_where_an_area_or_a_location",
        )
    draft = Visit(
        area_id=area_id,
        title=payload.title,
        summary=payload.summary,
        starts_on=payload.starts_on,
        ends_on=payload.ends_on,
    )
    return [
        {"id": route.id, "title": route_title(route)} for route in overlapping_routes(draft, trip_routes(session, trip))
    ]


@router.get("/visits/{visit_id}", response_model=VisitResponse)
def get_visit(trip_id: Identifier, visit_id: Identifier, session: SessionDep, subject: SubjectDep) -> Visit:
    trip = owned_trip(session, trip_id, subject)
    visit = owned_visit(session, trip, visit_id)
    flag_route_overlaps(session, trip, visit)
    return visit


def _update_place(session: Session, trip: Trip, visit: Visit, payload: VisitUpdate) -> None:
    """Change where a visit is: its location, its area, or both."""
    fields = payload.model_fields_set
    if "location" not in fields and "area_id" not in fields:
        return
    if "location" in fields and payload.location is not None:
        area, location = resolve_place(session, trip.id, payload.area_id, payload.location)
    elif "area_id" in fields and payload.area_id is not None:
        area, location = selected_area(session, trip.id, payload.area_id), None
        if visit.location is not None and visit.location.area_id == area.id and "location" not in fields:
            location = visit.location  # the same area: keep the exact location
    elif "location" in fields:  # cleared: keep the area
        area, location = visit.area, None
    else:
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A visit needs an area",
            code="a_visit_needs_an_area",
        )
    visit.area = area
    visit.location = location


@router.patch("/visits/{visit_id}", response_model=VisitResponse)
def update_visit(
    trip_id: Identifier, visit_id: Identifier, payload: VisitUpdate, session: SessionDep, subject: SubjectDep
) -> Visit:
    trip = owned_trip(session, trip_id, subject)
    visit = owned_visit(session, trip, visit_id)
    _update_place(session, trip, visit, payload)
    values = payload.model_dump(exclude_unset=True, exclude={"area_id", "location"})
    for required in ("status", "share_time"):
        if required in values and values[required] is None:
            raise ApiException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{required} is required",
                code="missing",
                field=required,
            )
    try:
        require_visit_times(
            values.get("starts_on", visit.starts_on),
            values.get("ends_on", visit.ends_on),
            values.get("start_time", visit.start_time),
            values.get("end_time", visit.end_time),
        )
    except ValueError as error:
        raise service_exception(status.HTTP_422_UNPROCESSABLE_CONTENT, error) from error
    for field, value in values.items():
        setattr(visit, field, value)
    if visit.status == PlanningStatus.CANCELLED:
        # A dropped visit is never offered to an audience, so cancelling also takes it off any.
        visit.visibility = Visibility.PRIVATE
    session.commit()
    saved = session.scalar(_visit_query().where(Visit.id == visit.id))
    flag_route_overlaps(session, trip, saved)  # type: ignore[arg-type]
    return saved  # type: ignore[return-value]


@router.delete("/visits/{visit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_visit(trip_id: Identifier, visit_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    trip = owned_trip(session, trip_id, subject)
    visit = owned_visit(session, trip, visit_id)
    session.delete(visit)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
