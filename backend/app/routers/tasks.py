"""Owner-only lightweight booking and preparation tasks."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..models import TripTask, TripTaskAlert
from ..schemas import Identifier, TripTaskAlertResponse, TripTaskCreate, TripTaskResponse, TripTaskUpdate
from ..services import tasks as service

router = APIRouter(prefix="/trips/{trip_id}", tags=["trip-tasks"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


@router.get("/trip-tasks", response_model=list[TripTaskResponse])
def list_trip_tasks(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> list[TripTask]:
    return service.list_trip_tasks(session, subject, trip_id)


@router.post("/trip-tasks", response_model=TripTaskResponse, status_code=status.HTTP_201_CREATED)
def create_trip_task(
    trip_id: Identifier, payload: TripTaskCreate, session: SessionDep, subject: SubjectDep
) -> TripTask:
    task = service.create_trip_task(session, subject, trip_id, payload)
    session.commit()
    session.refresh(task)
    return task


@router.get("/trip-tasks/{task_id}", response_model=TripTaskResponse)
def get_trip_task(trip_id: Identifier, task_id: Identifier, session: SessionDep, subject: SubjectDep) -> TripTask:
    return service.get_trip_task(session, subject, trip_id, task_id)


@router.patch("/trip-tasks/{task_id}", response_model=TripTaskResponse)
def update_trip_task(
    trip_id: Identifier, task_id: Identifier, payload: TripTaskUpdate, session: SessionDep, subject: SubjectDep
) -> TripTask:
    task = service.update_trip_task(session, subject, trip_id, task_id, payload)
    session.commit()
    session.refresh(task)
    return task


@router.delete("/trip-tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trip_task(trip_id: Identifier, task_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    service.delete_trip_task(session, subject, trip_id, task_id)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/task-alerts", response_model=list[TripTaskAlertResponse])
def list_task_alerts(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> list[TripTaskAlert]:
    return service.list_task_alerts(session, subject, trip_id)


@router.patch("/task-alerts/{alert_id}/read", response_model=TripTaskAlertResponse)
def mark_task_alert_read(
    trip_id: Identifier, alert_id: Identifier, session: SessionDep, subject: SubjectDep
) -> TripTaskAlert:
    alert = service.mark_task_alert_read(session, subject, trip_id, alert_id)
    session.commit()
    return alert
