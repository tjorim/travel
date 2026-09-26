"""Owner-only locations: hotels, stations and monuments, each filed under one area."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..models import Location, Route, Visibility, Visit
from ..navigation import location_navigation_url
from ..schemas import LocationInput, LocationResponse, LocationUpdate, NavigationResponse
from .placement import location_from_input, selected_area
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["locations"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def owned_location(session: Session, trip_id: str, subject: str, location_id: str) -> Location:
    owned_trip(session, trip_id, subject)
    location = session.scalar(select(Location).where(Location.id == location_id, Location.trip_id == trip_id))
    if location is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")
    return location


@router.get("/locations", response_model=list[LocationResponse])
def list_locations(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[Location]:
    trip = owned_trip(session, trip_id, subject)
    return list(session.scalars(select(Location).where(Location.trip_id == trip.id).order_by(Location.created_at)))


@router.post("/locations", response_model=LocationResponse, status_code=status.HTTP_201_CREATED)
def save_location(trip_id: str, payload: LocationInput, session: SessionDep, subject: SubjectDep) -> Location:
    trip = owned_trip(session, trip_id, subject)
    location = location_from_input(session, trip.id, payload)
    session.commit()
    return location


def _carry_links(session: Session, location: Location) -> None:
    """Keep every route end and visit at this location in the location's new area.

    A record's area must hold its location, so moving the location moves them
    with it instead of leaving the owner to detach, move and reattach each one.
    Stays and reisupdates take their area from the location already."""
    for end in ("departure", "arrival"):
        for route in session.scalars(select(Route).where(getattr(Route, f"{end}_location_id") == location.id)):
            setattr(route, f"{end}_area", location.area)
    for visit in session.scalars(select(Visit).where(Visit.location_id == location.id)):
        visit.area = location.area


@router.patch("/locations/{location_id}", response_model=LocationResponse)
def update_location(
    trip_id: str, location_id: str, payload: LocationUpdate, session: SessionDep, subject: SubjectDep
) -> Location:
    """Name a location, move it to another area, or choose whether its address is shown when shared."""
    location = owned_location(session, trip_id, subject, location_id)
    changes = payload.model_fields_set
    if "label" in changes:
        location.label = payload.label
    if "area_id" in changes:
        if payload.area_id is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Every location needs an area")
        location.area = selected_area(session, trip_id, payload.area_id)
        _carry_links(session, location)
    if "share_address" in changes and payload.share_address is not None:
        location.share_address = payload.share_address
    if location.label is None and location.visibility != Visibility.PRIVATE:
        # A shared location cannot lose its public name.
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Give this location a public name before sharing it")
    session.commit()
    return location


@router.get("/locations/{location_id}/navigation", response_model=NavigationResponse)
def owner_navigation(location_id: str, trip_id: str, session: SessionDep, subject: SubjectDep) -> NavigationResponse:
    location = owned_location(session, trip_id, subject, location_id)
    url = location_navigation_url(location)
    if url is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Location has no navigation target")
    return NavigationResponse(url=url, exact=True)
