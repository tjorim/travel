"""Owner-only areas: the cities and regions everything else is filed under."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..models import Area, Location, Route, TravelUpdate, Visit
from ..schemas import AreaInput, AreaResponse, AreaUpdate
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["areas"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def owned_area(session: Session, trip_id: str, area_id: str) -> Area:
    area = session.scalar(select(Area).where(Area.id == area_id, Area.trip_id == trip_id))
    if area is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Area not found")
    return area


@router.get("/areas", response_model=list[AreaResponse])
def list_areas(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[Area]:
    trip = owned_trip(session, trip_id, subject)
    return list(session.scalars(select(Area).where(Area.trip_id == trip.id).order_by(Area.created_at)))


@router.post("/areas", response_model=AreaResponse, status_code=status.HTTP_201_CREATED)
def save_area(trip_id: str, payload: AreaInput, session: SessionDep, subject: SubjectDep) -> Area:
    """Create an owner-selected area without treating it as a visit."""
    trip = owned_trip(session, trip_id, subject)
    area = Area(trip_id=trip.id, **payload.model_dump())
    session.add(area)
    session.commit()
    return area


@router.patch("/areas/{area_id}", response_model=AreaResponse)
def update_area(trip_id: str, area_id: str, payload: AreaUpdate, session: SessionDep, subject: SubjectDep) -> Area:
    """Edit an owner's area, for example to add its time zone."""
    trip = owned_trip(session, trip_id, subject)
    area = owned_area(session, trip.id, area_id)
    values = payload.model_dump(exclude_unset=True)
    if "label" in values and values["label"] is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="label is required")
    for field, value in values.items():
        setattr(area, field, value)
    if (area.latitude is None) != (area.longitude is None):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Supply both coordinates or neither")
    session.commit()
    return area


def _area_references(session: Session, trip_id: str, area_id: str) -> list[str]:
    """Return the owner-facing records that must be changed before deletion.

    An area is deliberately reusable. Deleting it must never silently remove a
    route stop, or detach a story, a location or a route from its context.
    """
    def count(model, *conditions) -> int:
        return session.scalar(select(func.count()).select_from(model).where(model.trip_id == trip_id, *conditions)) or 0

    references = (
        ("bezoek", "bezoeken", count(Visit, Visit.area_id == area_id)),
        ("reisupdate", "reisupdates", count(TravelUpdate, TravelUpdate.area_id == area_id)),
        ("locatie", "locaties", count(Location, Location.area_id == area_id)),
        ("route", "routes", count(Route, (Route.departure_area_id == area_id) | (Route.arrival_area_id == area_id))),
    )
    return [f"{number} {singular if number == 1 else plural}" for singular, plural, number in references if number]


@router.delete("/areas/{area_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_area(trip_id: str, area_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    """Delete an unused owner-authored area without harming its users."""
    trip = owned_trip(session, trip_id, subject)
    area = owned_area(session, trip.id, area_id)
    references = _area_references(session, trip.id, area.id)
    if references:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Dit gebied wordt nog gebruikt door: {', '.join(references)}. Pas of verwijder die eerst.",
        )
    session.delete(area)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
