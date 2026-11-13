"""Owner-only accommodation records; sharing one shows only its area and nights."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..models import Stay
from ..schemas import Identifier, StayCreate, StayResponse, StayUpdate
from ..services import stays as service

router = APIRouter(prefix="/trips/{trip_id}", tags=["stays"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


@router.get("/stays", response_model=list[StayResponse])
def list_stays(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> list[Stay]:
    return service.list_stays(session, subject, trip_id)


@router.post("/stays", response_model=StayResponse, status_code=status.HTTP_201_CREATED)
def create_stay(trip_id: Identifier, payload: StayCreate, session: SessionDep, subject: SubjectDep) -> Stay:
    stay_id = service.create_stay(session, subject, trip_id, payload).id
    session.commit()
    return service.stay_by_id(session, stay_id)


@router.get("/stays/{stay_id}", response_model=StayResponse)
def get_stay(trip_id: Identifier, stay_id: Identifier, session: SessionDep, subject: SubjectDep) -> Stay:
    return service.get_stay(session, subject, trip_id, stay_id)


@router.patch("/stays/{stay_id}", response_model=StayResponse)
def update_stay(
    trip_id: Identifier, stay_id: Identifier, payload: StayUpdate, session: SessionDep, subject: SubjectDep
) -> Stay:
    service.update_stay(session, subject, trip_id, stay_id, payload)
    session.commit()
    return service.stay_by_id(session, stay_id)


@router.delete("/stays/{stay_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stay(trip_id: Identifier, stay_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    service.delete_stay(session, subject, trip_id, stay_id)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
