"""Owner-only place search: a lookup that only ever suggests, never saves."""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..errors import service_exception
from ..places.search import CachedPlaceSearchService, PlaceSearchError, get_place_search_service
from ..schemas import Identifier, PlaceReverseGeocodeRequest, PlaceSearchRequest, PlaceSearchResponse
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["places"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
SearchServiceDep = Annotated[CachedPlaceSearchService, Depends(get_place_search_service)]


@router.post("/places/search", response_model=PlaceSearchResponse)
def search_places(
    trip_id: Identifier,
    payload: PlaceSearchRequest,
    session: SessionDep,
    subject: SubjectDep,
    service: SearchServiceDep,
) -> PlaceSearchResponse:
    # Resolve ownership before the remote call. A rejected caller must never
    # turn this endpoint into an arbitrary-query proxy.
    owned_trip(session, trip_id, subject)
    try:
        return service.search(payload.query)
    except PlaceSearchError as error:
        raise service_exception(status.HTTP_503_SERVICE_UNAVAILABLE, error) from error


@router.post("/places/reverse", response_model=PlaceSearchResponse)
def reverse_geocode_place(
    trip_id: Identifier,
    payload: PlaceReverseGeocodeRequest,
    session: SessionDep,
    subject: SubjectDep,
    service: SearchServiceDep,
) -> PlaceSearchResponse:
    # The caller explicitly requests this lookup.  It only returns a candidate;
    # it never turns EXIF/device coordinates into a canonical place by itself.
    owned_trip(session, trip_id, subject)
    try:
        return service.reverse(payload.latitude, payload.longitude)
    except PlaceSearchError as error:
        raise service_exception(status.HTTP_503_SERVICE_UNAVAILABLE, error) from error
