"""Owner-only locations: hotels, stations and monuments, each filed under one area."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..models import Location
from ..schemas import (
    Identifier,
    LocationInput,
    LocationMergeResult,
    LocationResponse,
    LocationUpdate,
    MergeRequest,
    NavigationResponse,
)
from ..services import locations as service

router = APIRouter(prefix="/trips/{trip_id}", tags=["locations"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


@router.get("/locations", response_model=list[LocationResponse])
def list_locations(
    trip_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    q: str | None = None,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Location]:
    return service.list_locations(session, subject, trip_id, q=q, limit=limit, offset=offset)


@router.post("/locations", response_model=LocationResponse, status_code=status.HTTP_201_CREATED)
def save_location(trip_id: Identifier, payload: LocationInput, session: SessionDep, subject: SubjectDep) -> Location:
    location = service.save_location(session, subject, trip_id, payload)
    session.commit()
    return location


@router.patch(
    "/locations/{location_id}",
    response_model=LocationResponse,
    responses={409: {"description": "A visitor-facing change needs acknowledge_visitor_changes"}},
)
def update_location(
    trip_id: Identifier, location_id: Identifier, payload: LocationUpdate, session: SessionDep, subject: SubjectDep
) -> Location:
    """Correct a saved location, or apply a verified place-search result to it, in place.

    The location is reusable: every linked stay, visit, route end and update
    reads the corrected address and map target from this same record. Its id,
    area, visibility and sharing choices are never changed by a map-target update.

    Editing what visitors read (public name, city, country, a shared address,
    or the area its visits and route ends are filed under) on a location with
    live receivers is refused with 409 until the request sets
    ``acknowledge_visitor_changes``; the refusal lists each field's before and
    after and the audiences. An acknowledged change is recorded in the audit trail.
    """
    location = service.update_location(session, subject, trip_id, location_id, payload)
    session.commit()
    return location


@router.get("/locations/{location_id}/navigation", response_model=NavigationResponse)
def owner_navigation(
    location_id: Identifier, trip_id: Identifier, session: SessionDep, subject: SubjectDep
) -> NavigationResponse:
    return service.owner_navigation(session, subject, trip_id, location_id)


@router.delete("/locations/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(trip_id: Identifier, location_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    """Delete an unused location; refuse while any visit, stay, route or reisupdate still points at it."""
    service.delete_location(session, subject, trip_id, location_id)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/locations/merge", response_model=LocationMergeResult)
def merge_locations_endpoint(
    trip_id: Identifier, payload: MergeRequest, session: SessionDep, subject: SubjectDep
) -> LocationMergeResult:
    result = service.merge_locations(session, subject, trip_id, payload)
    session.commit()
    return result
