"""Owner-only areas: the cities and regions everything else is filed under."""

from math import asin, cos, radians, sin, sqrt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from timezonefinder import TimezoneFinder

from ..auth import current_subject
from ..database import get_session
from ..models import Area, Location, Route, TravelUpdate, Visit
from ..places.search import CachedPlaceSearchService, PlaceSearchError, get_place_search_service
from ..schemas import AreaInput, AreaResponse, AreaSuggestion, AreaSuggestRequest, AreaUpdate
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["areas"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
SearchServiceDep = Annotated[CachedPlaceSearchService, Depends(get_place_search_service)]
AREA_SUGGESTION_RADIUS_KM = 25
_timezone_finder = TimezoneFinder(in_memory=True)


def distance_km(latitude: float, longitude: float, other_latitude: float, other_longitude: float) -> float:
    dlat = radians(other_latitude - latitude)
    dlon = radians(other_longitude - longitude)
    arc = sin(dlat / 2) ** 2 + cos(radians(latitude)) * cos(radians(other_latitude)) * sin(dlon / 2) ** 2
    return 12742 * asin(min(1, sqrt(arc)))


def suggest_area(
    trip_id: str, payload: AreaSuggestRequest, session: SessionDep, subject: SubjectDep, service: SearchServiceDep
) -> AreaSuggestion:
    """Suggest an area to the owner; never create or re-file anything."""
    trip = owned_trip(session, trip_id, subject)
    candidates = [
        (distance_km(payload.latitude, payload.longitude, area.latitude, area.longitude), area)
        for area in session.scalars(select(Area).where(Area.trip_id == trip.id))
        if area.latitude is not None and area.longitude is not None
    ]
    if candidates:
        distance, closest = min(candidates, key=lambda candidate: candidate[0])
        if distance <= AREA_SUGGESTION_RADIUS_KM:
            return AreaSuggestion(existing_area_id=closest.id, area=AreaInput.model_validate(closest, from_attributes=True))
    try:
        result = service.reverse(payload.latitude, payload.longitude).results
    except PlaceSearchError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
    place = result[0] if result else None
    label = (payload.city or (place.locality or place.admin_area if place else None) or "Nieuw gebied").strip() or "Nieuw gebied"
    return AreaSuggestion(area=AreaInput(
        label=label[:120], country_code=place.country_code if place else None,
        region=place.admin_area if place else None,
        latitude=payload.latitude, longitude=payload.longitude,
        timezone=_timezone_finder.timezone_at(lat=payload.latitude, lng=payload.longitude),
    ))


@router.post("/areas/suggest", response_model=AreaSuggestion)
def suggest_area_endpoint(
    trip_id: str, payload: AreaSuggestRequest, session: SessionDep, subject: SubjectDep, service: SearchServiceDep
) -> AreaSuggestion:
    return suggest_area(trip_id, payload, session, subject, service)


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
    if (payload.latitude is None) != (payload.longitude is None):
        raise HTTPException(status_code=422, detail="Supply both coordinates or neither")
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
    if area.latitude is not None and area.longitude is not None:
        area.latitude = round(area.latitude, 2)
        area.longitude = round(area.longitude, 2)
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
