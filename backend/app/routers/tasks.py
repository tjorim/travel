"""Owner-only lightweight booking and preparation tasks."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..models import Trip, TripTask
from ..schemas import TripTaskCreate, TripTaskResponse, TripTaskUpdate
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
    task = TripTask(trip=trip, **payload.model_dump())
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
    for field, value in payload.model_dump(exclude_unset=True, exclude={"completed"}).items():
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
