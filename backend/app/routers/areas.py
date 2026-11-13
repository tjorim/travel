"""Owner-only areas: the cities and regions everything else is filed under."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..models import Area
from ..places.search import CachedPlaceSearchService, get_place_search_service
from ..schemas import (
    AreaInput,
    AreaMergeResult,
    AreaResponse,
    AreaSuggestion,
    AreaSuggestRequest,
    AreaUpdate,
    Identifier,
    MergeRequest,
)
from ..services import areas as service

router = APIRouter(prefix="/trips/{trip_id}", tags=["areas"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
SearchServiceDep = Annotated[CachedPlaceSearchService, Depends(get_place_search_service)]


@router.post("/areas/suggest", response_model=AreaSuggestion)
def suggest_area_endpoint(
    trip_id: Identifier,
    payload: AreaSuggestRequest,
    session: SessionDep,
    subject: SubjectDep,
    search: SearchServiceDep,
) -> AreaSuggestion:
    return service.suggest_area(session, subject, trip_id, payload, search)


@router.get("/areas", response_model=list[AreaResponse])
def list_areas(
    trip_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    q: str | None = None,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Area]:
    return service.list_areas(session, subject, trip_id, q=q, limit=limit, offset=offset)


@router.post("/areas", response_model=AreaResponse, status_code=status.HTTP_201_CREATED)
def save_area(trip_id: Identifier, payload: AreaInput, session: SessionDep, subject: SubjectDep) -> Area:
    """Create an owner-selected area without treating it as a visit."""
    area = service.save_area(session, subject, trip_id, payload)
    session.commit()
    return area


@router.patch("/areas/{area_id}", response_model=AreaResponse)
def update_area(
    trip_id: Identifier, area_id: Identifier, payload: AreaUpdate, session: SessionDep, subject: SubjectDep
) -> Area:
    """Edit an owner's area, for example to add its time zone."""
    area = service.update_area(session, subject, trip_id, area_id, payload)
    session.commit()
    return area


@router.delete("/areas/{area_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_area(trip_id: Identifier, area_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    """Delete an unused owner-authored area without harming its users."""
    service.delete_area(session, subject, trip_id, area_id)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/areas/merge", response_model=AreaMergeResult)
def merge_areas_endpoint(
    trip_id: Identifier, payload: MergeRequest, session: SessionDep, subject: SubjectDep
) -> AreaMergeResult:
    result = service.merge_areas(session, subject, trip_id, payload)
    session.commit()
    return result
