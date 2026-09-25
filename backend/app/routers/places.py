from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..models import Place, PlaceKind, RouteStage, Stay, TravelUpdate, Visibility
from ..navigation import exact_navigation_url
from ..places.search import CachedPlaceSearchService, PlaceSearchError, get_place_search_service
from ..schemas import (
    BroadPlaceInput,
    BroadPlaceResponse,
    BroadPlaceUpdate,
    ExactPlaceInput,
    ExactPlaceResponse,
    ExactPlaceUpdate,
    NavigationResponse,
    PlaceReverseGeocodeRequest,
    PlaceSearchRequest,
    PlaceSearchResponse,
)
from .trips import exact_place_from_input, owned_trip, selected_broad_place

router = APIRouter(prefix="/trips/{trip_id}/places", tags=["places"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
SearchServiceDep = Annotated[CachedPlaceSearchService, Depends(get_place_search_service)]


@router.post("/search", response_model=PlaceSearchResponse)
def search_places(
    trip_id: str, payload: PlaceSearchRequest, session: SessionDep, subject: SubjectDep, service: SearchServiceDep
) -> PlaceSearchResponse:
    # Resolve ownership before the remote call. A rejected caller must never
    # turn this endpoint into an arbitrary-query proxy.
    owned_trip(session, trip_id, subject)
    try:
        return service.search(payload.query)
    except PlaceSearchError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error


@router.post("/reverse", response_model=PlaceSearchResponse)
def reverse_geocode_place(
    trip_id: str, payload: PlaceReverseGeocodeRequest, session: SessionDep, subject: SubjectDep, service: SearchServiceDep
) -> PlaceSearchResponse:
    # The caller explicitly requests this lookup.  It only returns a candidate;
    # it never turns EXIF/device coordinates into a canonical place by itself.
    owned_trip(session, trip_id, subject)
    try:
        return service.reverse(payload.latitude, payload.longitude)
    except PlaceSearchError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error


@router.get("", response_model=list[ExactPlaceResponse])
def list_exact_places(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[Place]:
    trip = owned_trip(session, trip_id, subject)
    return list(
        session.scalars(
            select(Place).where(Place.trip_id == trip.id, Place.kind == PlaceKind.EXACT).order_by(Place.created_at)
        )
    )


@router.post("", response_model=ExactPlaceResponse, status_code=status.HTTP_201_CREATED)
def save_exact_place(trip_id: str, payload: ExactPlaceInput, session: SessionDep, subject: SubjectDep) -> Place:
    trip = owned_trip(session, trip_id, subject)
    place = exact_place_from_input(session, trip.id, payload)
    session.commit()
    return place


@router.get("/broad", response_model=list[BroadPlaceResponse])
def list_broad_places(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[Place]:
    """List only deliberately authored broad places for the owner.

    Exact places deliberately stay on the separate owner-only endpoint, so a
    caller choosing an excerpt location cannot accidentally receive one.
    """
    trip = owned_trip(session, trip_id, subject)
    return list(
        session.scalars(
            select(Place).where(Place.trip_id == trip.id, Place.kind == PlaceKind.BROAD).order_by(Place.created_at)
        )
    )


@router.post("/broad", response_model=BroadPlaceResponse, status_code=status.HTTP_201_CREATED)
def save_broad_place(trip_id: str, payload: BroadPlaceInput, session: SessionDep, subject: SubjectDep) -> Place:
    """Create an owner-selected broad place without treating it as a route stage."""
    trip = owned_trip(session, trip_id, subject)
    place = Place(trip_id=trip.id, kind=PlaceKind.BROAD, **payload.model_dump())
    session.add(place)
    session.commit()
    return place


@router.patch("/broad/{place_id}", response_model=BroadPlaceResponse)
def update_broad_place(
    trip_id: str, place_id: str, payload: BroadPlaceUpdate, session: SessionDep, subject: SubjectDep
) -> Place:
    """Edit an owner's broad place, for example to add its time zone."""
    trip = owned_trip(session, trip_id, subject)
    place = session.scalar(
        select(Place).where(Place.id == place_id, Place.trip_id == trip.id, Place.kind == PlaceKind.BROAD)
    )
    if place is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Broad place not found")
    values = payload.model_dump(exclude_unset=True)
    if "label" in values and values["label"] is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="label is required")
    for field, value in values.items():
        setattr(place, field, value)
    if (place.latitude is None) != (place.longitude is None):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Supply both coordinates or neither")
    session.commit()
    return place


def _broad_place_references(session: Session, trip_id: str, place_id: str) -> list[str]:
    """Return the owner-facing records that must be changed before deletion.

    A broad place is deliberately reusable. Deleting it must never silently
    remove a route stop or detach a shared story/stay summary from its context.
    """
    references = (
        ("halte", select(func.count()).select_from(RouteStage).where(RouteStage.trip_id == trip_id, RouteStage.broad_place_id == place_id)),
        ("reisupdate", select(func.count()).select_from(TravelUpdate).where(TravelUpdate.trip_id == trip_id, TravelUpdate.broad_place_id == place_id)),
        ("verblijf", select(func.count()).select_from(Stay).where(Stay.trip_id == trip_id, Stay.broad_place_id == place_id)),
        ("plek", select(func.count()).select_from(Place).where(Place.trip_id == trip_id, Place.area_id == place_id)),
    )
    return [f"{count} {label}" for label, statement in references if (count := session.scalar(statement) or 0)]


@router.delete("/broad/{place_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_broad_place(trip_id: str, place_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    """Delete an unused owner-authored broad place without harming its users."""
    trip = owned_trip(session, trip_id, subject)
    place = session.scalar(
        select(Place).where(Place.id == place_id, Place.trip_id == trip.id, Place.kind == PlaceKind.BROAD)
    )
    if place is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Broad place not found")
    references = _broad_place_references(session, trip.id, place.id)
    if references:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Deze plaats wordt nog gebruikt door: {', '.join(references)}. Pas of verwijder die eerst.",
        )
    session.delete(place)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def owned_exact_place(session: Session, trip_id: str, subject: str, place_id: str) -> Place:
    owned_trip(session, trip_id, subject)
    place = session.scalar(
        select(Place).where(Place.id == place_id, Place.trip_id == trip_id, Place.kind == PlaceKind.EXACT)
    )
    if place is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exact place not found")
    return place


@router.patch("/{place_id}", response_model=ExactPlaceResponse)
def update_exact_place(
    trip_id: str, place_id: str, payload: ExactPlaceUpdate, session: SessionDep, subject: SubjectDep
) -> Place:
    """Name a spot, move it to another area, or choose whether its address is shown when shared."""
    place = owned_exact_place(session, trip_id, subject, place_id)
    changes = payload.model_fields_set
    if "label" in changes:
        place.label = payload.label
    if "area_id" in changes:
        if payload.area_id is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Every spot needs an area")
        place.area = selected_broad_place(session, trip_id, payload.area_id)
    if "share_address" in changes and payload.share_address is not None:
        place.share_address = payload.share_address
    if place.label is None and place.visibility != Visibility.PRIVATE:
        # A shared spot cannot lose its public name.
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Give this spot a public name before sharing it")
    session.commit()
    return place


@router.get("/{place_id}/navigation", response_model=NavigationResponse)
def owner_navigation(place_id: str, trip_id: str, session: SessionDep, subject: SubjectDep) -> NavigationResponse:
    place = owned_exact_place(session, trip_id, subject, place_id)
    url = exact_navigation_url(place)
    if url is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Exact place has no navigation target")
    return NavigationResponse(url=url, exact=True)
