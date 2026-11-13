"""Owner-only place search: a lookup that only ever suggests, never saves."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..places.search import CachedPlaceSearchService, get_place_search_service
from ..schemas import Identifier, PlaceReverseGeocodeRequest, PlaceSearchRequest, PlaceSearchResponse
from ..services import places as service

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
    search: SearchServiceDep,
) -> PlaceSearchResponse:
    return service.search_places(session, subject, trip_id, payload, search)


@router.post("/places/reverse", response_model=PlaceSearchResponse)
def reverse_geocode_place(
    trip_id: Identifier,
    payload: PlaceReverseGeocodeRequest,
    session: SessionDep,
    subject: SubjectDep,
    search: SearchServiceDep,
) -> PlaceSearchResponse:
    return service.reverse_geocode_place(session, subject, trip_id, payload, search)
