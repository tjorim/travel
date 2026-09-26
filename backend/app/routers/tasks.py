"""Owner-only lightweight booking and preparation tasks."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..models import Trip, TripTask, TripTaskAlert
from ..schemas import TripTaskAlertResponse, TripTaskCreate, TripTaskResponse, TripTaskUpdate
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["trip-tasks"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def owned_task(trip: Trip, task_id: str) -> TripTask:
    task = next((item for item in trip.trip_tasks if item.id == task_id), None)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip task not found")
    return task


@router.get("/trip-tasks", response_model=list[TripTaskResponse])
def list_trip_tasks(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[TripTask]:
    return list(owned_trip(session, trip_id, subject).trip_tasks)


@router.post("/trip-tasks", response_model=TripTaskResponse, status_code=status.HTTP_201_CREATED)
def create_trip_task(trip_id: str, payload: TripTaskCreate, session: SessionDep, subject: SubjectDep) -> TripTask:
    trip = owned_trip(session, trip_id, subject)
    task = TripTask(trip=trip, **payload.model_dump(exclude={"links"}), links=payload.model_dump(mode="json")["links"])
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.get("/trip-tasks/{task_id}", response_model=TripTaskResponse)
def get_trip_task(trip_id: str, task_id: str, session: SessionDep, subject: SubjectDep) -> TripTask:
    return owned_task(owned_trip(session, trip_id, subject), task_id)


@router.patch("/trip-tasks/{task_id}", response_model=TripTaskResponse)
def update_trip_task(
    trip_id: str, task_id: str, payload: TripTaskUpdate, session: SessionDep, subject: SubjectDep
) -> TripTask:
    trip = owned_trip(session, trip_id, subject)
    task = owned_task(trip, task_id)
    if "completed" in payload.model_fields_set:
        # The owner can only toggle completion, never set an arbitrary
        # completion timestamp themselves.
        task.completed_at = datetime.now(UTC) if payload.completed else None
    if "remind_at" in payload.model_fields_set:
        previous = task.remind_at
        if previous is not None and previous.tzinfo is None:
            previous = previous.replace(tzinfo=UTC)
        if payload.remind_at != previous:
            task.reminded_at = None
    values = payload.model_dump(exclude_unset=True, exclude={"completed"})
    if "links" in values and values["links"] is not None:
        values["links"] = payload.model_dump(mode="json", include={"links"})["links"]
    if "title" in values and values["title"] is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="title is required")
    if "links" in values and values["links"] is None:
        values["links"] = []
    for field, value in values.items():
        setattr(task, field, value)
    session.commit()
    session.refresh(task)
    return task


@router.delete("/trip-tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trip_task(trip_id: str, task_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    trip = owned_trip(session, trip_id, subject)
    session.delete(owned_task(trip, task_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/task-alerts", response_model=list[TripTaskAlertResponse])
def list_task_alerts(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[TripTaskAlert]:
    trip = owned_trip(session, trip_id, subject)
    return list(
        session.scalars(
            select(TripTaskAlert)
            .join(TripTask, TripTask.id == TripTaskAlert.task_id)
            .where(TripTask.trip_id == trip.id, TripTaskAlert.owner_subject == subject)
            .order_by(TripTaskAlert.created_at.desc())
        )
    )


@router.patch("/task-alerts/{alert_id}/read", response_model=TripTaskAlertResponse)
def mark_task_alert_read(trip_id: str, alert_id: str, session: SessionDep, subject: SubjectDep) -> TripTaskAlert:
    trip = owned_trip(session, trip_id, subject)
    alert = session.scalar(
        select(TripTaskAlert)
        .join(TripTask, TripTask.id == TripTaskAlert.task_id)
        .where(TripTask.trip_id == trip.id, TripTaskAlert.owner_subject == subject, TripTaskAlert.id == alert_id)
    )
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task alert not found")
    if alert.read_at is None:
        alert.read_at = datetime.now(UTC)
        session.commit()
    return alert
