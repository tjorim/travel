"""Trip task and task alert ORM models."""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base
from app.models.base import _enum_column, opaque_id
from app.models.enums import TaskAlertKind

if TYPE_CHECKING:
    from app.models.trips import Trip


class TripTask(Base):
    """An owner-only lightweight booking/preparation task.

    Deliberately has no ordering or relation to other records, only
    owner-chosen ``links`` (a ticket or booking site) -- it's a checklist,
    not the agenda. ``completed_at`` is set by the router, never
    accepted directly from a client payload, so an owner can't backdate a
    completion.
    """

    __tablename__ = "trip_tasks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    remind_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reminded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Owner-chosen HTTPS references such as a ticket or booking site:
    # ``[{"label": ..., "url": ...}]``.
    links: Mapped[list[dict]] = mapped_column(JSON, default=list, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped[Trip] = relationship(back_populates="trip_tasks")


TASK_ORDER = (TripTask.created_at, TripTask.id)


class TripTaskAlert(Base):
    """Owner inbox item produced once by the scheduled task processor."""

    __tablename__ = "trip_task_alerts"
    __table_args__ = (UniqueConstraint("task_id", "kind", "scheduled_for", name="uq_trip_task_alert_schedule"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    task_id: Mapped[str] = mapped_column(ForeignKey("trip_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    kind: Mapped[TaskAlertKind] = mapped_column(_enum_column(TaskAlertKind, "travel_task_alert_kind"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    email_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    email_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    email_last_error: Mapped[str | None] = mapped_column(String(120), nullable=True)
