"""Owner-only visits: the stops of the trip, and when the traveller is at each."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..auth import current_subject
from ..database import get_session
from ..models import Location, Trip, Visit
from ..schemas import VisitCreate, VisitResponse, VisitUpdate, require_visit_times
from .placement import resolve_place, selected_area
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["visits"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def _visit_query():
    return select(Visit).options(selectinload(Visit.area), selectinload(Visit.location).selectinload(Location.area))


def owned_visit(trip: Trip, visit_id: str) -> Visit:
    visit = next((item for item in trip.visits if item.id == visit_id), None)
    if visit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Visit not found")
    return visit


def commit_or_conflict(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Conflicting visit position") from error


def _renumber(session: Session, ordered: list[Visit]) -> None:
    """Write positions 0..n in the given order. The unique trip/position constraint makes an ordinary
    swap fail, so every row first moves out of the range it is about to occupy."""
    offset = max((item.position for item in ordered), default=0) + len(ordered) + 1
    for item in ordered:
        item.position += offset
    session.flush()
    for index, item in enumerate(ordered):
        item.position = index


def _move(session: Session, trip: Trip, visit: Visit, position: int) -> None:
    """Put a visit at ``position`` and compact the rest."""
    ordered = sorted((item for item in trip.visits if item is not visit), key=lambda item: item.position)
    ordered.insert(min(position, len(ordered)), visit)
    _renumber(session, ordered)


@router.get("/visits", response_model=list[VisitResponse])
def list_visits(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[Visit]:
    return list(owned_trip(session, trip_id, subject).visits)


@router.post("/visits", response_model=VisitResponse, status_code=status.HTTP_201_CREATED)
def create_visit(trip_id: str, payload: VisitCreate, session: SessionDep, subject: SubjectDep) -> Visit:
    trip = owned_trip(session, trip_id, subject)
    area, location = resolve_place(session, trip.id, payload.area_id, payload.location)
    end = len(trip.visits)
    visit = Visit(
        trip=trip, area=area, location=location, position=end,
        **payload.model_dump(exclude={"area_id", "location", "position"}),
    )
    session.add(visit)
    session.flush()
    if payload.position is not None and payload.position < end:
        _move(session, trip, visit, payload.position)
    commit_or_conflict(session)
    return session.scalar(_visit_query().where(Visit.id == visit.id))  # type: ignore[return-value]


@router.get("/visits/{visit_id}", response_model=VisitResponse)
def get_visit(trip_id: str, visit_id: str, session: SessionDep, subject: SubjectDep) -> Visit:
    return owned_visit(owned_trip(session, trip_id, subject), visit_id)


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
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A visit needs an area")
    visit.area = area
    visit.location = location


@router.patch("/visits/{visit_id}", response_model=VisitResponse)
def update_visit(trip_id: str, visit_id: str, payload: VisitUpdate, session: SessionDep, subject: SubjectDep) -> Visit:
    trip = owned_trip(session, trip_id, subject)
    visit = owned_visit(trip, visit_id)
    _update_place(session, trip, visit, payload)
    values = payload.model_dump(exclude_unset=True, exclude={"area_id", "location", "position"})
    for required in ("status", "share_time", "share_date_precision"):
        if required in values and values[required] is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{required} is required")
    try:
        require_visit_times(
            values.get("starts_on", visit.starts_on), values.get("ends_on", visit.ends_on),
            values.get("start_time", visit.start_time), values.get("end_time", visit.end_time),
        )
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
    for field, value in values.items():
        setattr(visit, field, value)
    if payload.position is not None and payload.position != visit.position:
        _move(session, trip, visit, payload.position)
    commit_or_conflict(session)
    return session.scalar(_visit_query().where(Visit.id == visit.id))  # type: ignore[return-value]


@router.delete("/visits/{visit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_visit(trip_id: str, visit_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    trip = owned_trip(session, trip_id, subject)
    visit = owned_visit(trip, visit_id)
    session.delete(visit)
    session.flush()
    # Compact positions after a removal so the next add can use the end of the list.
    _renumber(session, sorted((item for item in trip.visits if item is not visit), key=lambda item: item.position))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
