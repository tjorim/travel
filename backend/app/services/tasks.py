"""Lightweight booking and preparation tasks, and the alerts they raise."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import RecordNotFound, Refusal
from ..models import TASK_ORDER, Trip, TripTask, TripTaskAlert
from ..schemas import Identifier, TripTaskCreate, TripTaskUpdate
from .trips import owned_trip


def owned_task(session: Session, trip: Trip, task_id: Identifier) -> TripTask:
    task = session.scalar(select(TripTask).where(TripTask.id == task_id, TripTask.trip_id == trip.id))
    if task is None:
        raise RecordNotFound("Trip task not found")
    return task


def list_trip_tasks(session: Session, subject: str, trip_id: Identifier) -> list[TripTask]:
    trip = owned_trip(session, trip_id, subject)
    return list(session.scalars(select(TripTask).where(TripTask.trip_id == trip.id).order_by(*TASK_ORDER)))


def get_trip_task(session: Session, subject: str, trip_id: Identifier, task_id: Identifier) -> TripTask:
    return owned_task(session, owned_trip(session, trip_id, subject), task_id)


def create_trip_task(session: Session, subject: str, trip_id: Identifier, payload: TripTaskCreate) -> TripTask:
    trip = owned_trip(session, trip_id, subject)
    task = TripTask(
        trip_id=trip.id, **payload.model_dump(exclude={"links"}), links=payload.model_dump(mode="json")["links"]
    )
    session.add(task)
    session.flush()
    return task


def update_trip_task(
    session: Session, subject: str, trip_id: Identifier, task_id: Identifier, payload: TripTaskUpdate
) -> TripTask:
    trip = owned_trip(session, trip_id, subject)
    task = owned_task(session, trip, task_id)
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
        raise Refusal("title is required", code="missing", field="title")
    if "links" in values and values["links"] is None:
        values["links"] = []
    for field, value in values.items():
        setattr(task, field, value)
    session.flush()
    return task


def delete_trip_task(session: Session, subject: str, trip_id: Identifier, task_id: Identifier) -> None:
    trip = owned_trip(session, trip_id, subject)
    session.delete(owned_task(session, trip, task_id))
    session.flush()


def list_task_alerts(session: Session, subject: str, trip_id: Identifier) -> list[TripTaskAlert]:
    trip = owned_trip(session, trip_id, subject)
    return list(
        session.scalars(
            select(TripTaskAlert)
            .join(TripTask, TripTask.id == TripTaskAlert.task_id)
            .where(TripTask.trip_id == trip.id, TripTaskAlert.owner_subject == subject)
            .order_by(TripTaskAlert.created_at.desc())
        )
    )


def mark_task_alert_read(session: Session, subject: str, trip_id: Identifier, alert_id: Identifier) -> TripTaskAlert:
    trip = owned_trip(session, trip_id, subject)
    alert = session.scalar(
        select(TripTaskAlert)
        .join(TripTask, TripTask.id == TripTaskAlert.task_id)
        .where(TripTask.trip_id == trip.id, TripTaskAlert.owner_subject == subject, TripTaskAlert.id == alert_id)
    )
    if alert is None:
        raise RecordNotFound("Task alert not found")
    if alert.read_at is None:
        alert.read_at = datetime.now(UTC)
        session.flush()
    return alert
