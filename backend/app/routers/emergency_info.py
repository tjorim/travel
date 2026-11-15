"""Owner-wide emergency information (under ``/library``, the path its clients already use).

Scoped directly to the authenticated owner subject rather than to a trip, so an owner never needs a dummy trip to
hold emergency contacts. Never projected onto a public/unlisted trip response.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..models import EmergencyInfoEntry
from ..schemas import (
    EmergencyInfoEntryCreate,
    EmergencyInfoEntryResponse,
    EmergencyInfoEntryUpdate,
    Identifier,
)
from ..services import emergency_info as service

router = APIRouter(prefix="/library", tags=["library"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


@router.get("/emergency-info", response_model=list[EmergencyInfoEntryResponse])
def list_emergency_info(session: SessionDep, subject: SubjectDep) -> list[EmergencyInfoEntry]:
    return service.list_emergency_info(session, subject)


@router.post("/emergency-info", response_model=EmergencyInfoEntryResponse, status_code=status.HTTP_201_CREATED)
def create_emergency_info(
    payload: EmergencyInfoEntryCreate, session: SessionDep, subject: SubjectDep
) -> EmergencyInfoEntry:
    entry = service.create_emergency_info(session, subject, payload)
    session.commit()
    return entry


@router.get("/emergency-info/{entry_id}", response_model=EmergencyInfoEntryResponse)
def get_emergency_info_entry(entry_id: Identifier, session: SessionDep, subject: SubjectDep) -> EmergencyInfoEntry:
    return service.get_emergency_info_entry(session, subject, entry_id)


@router.patch("/emergency-info/{entry_id}", response_model=EmergencyInfoEntryResponse)
def update_emergency_info(
    entry_id: Identifier, payload: EmergencyInfoEntryUpdate, session: SessionDep, subject: SubjectDep
) -> EmergencyInfoEntry:
    entry = service.update_emergency_info(session, subject, entry_id, payload)
    session.commit()
    return entry


@router.delete("/emergency-info/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_emergency_info(entry_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    service.delete_emergency_info(session, subject, entry_id)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
