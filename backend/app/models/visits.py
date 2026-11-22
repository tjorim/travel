"""Visit ORM model."""

from __future__ import annotations

from datetime import UTC, date, datetime, time
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, String, Text, Time, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.content_language import Localized
from app.db.base import Base
from app.models.base import _enum_column, _trip_language, _visibility_column, opaque_id
from app.models.enums import DatePrecision, PlanningStatus, Visibility, VisitKind

from .localized import LocalizedRecord

if TYPE_CHECKING:
    from app.models.alternatives import AlternativeGroupMember
    from app.models.areas import Area
    from app.models.locations import Location
    from app.models.trips import Trip


class Visit(LocalizedRecord, Base):
    """A stop on the trip: somewhere the traveller is, or goes, and when.

    A visit is at an *area*, or at a *location* in one, and can carry the days it
    spans, a start and end time and a kind (free or working days).

    It has a private part (``notes``, the ``status``, the exact ``location``, and
    the times unless ``share_time`` is set) and a shared part (``title``, ``summary``, the area, the
    days at ``share_date_precision``), held in separate fields so private text
    can never reach a visitor by changing a switch.
    """

    localized_fields = ("title", "summary")

    __tablename__ = "visits"
    __table_args__ = (
        CheckConstraint(
            "ends_on IS NULL OR (starts_on IS NOT NULL AND ends_on >= starts_on)", name="ck_visit_last_day"
        ),
        CheckConstraint("start_time IS NULL OR starts_on IS NOT NULL", name="ck_visit_time_needs_a_day"),
        CheckConstraint("end_time IS NULL OR start_time IS NOT NULL", name="ck_visit_end_time_needs_a_start"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    area_id: Mapped[str] = mapped_column(ForeignKey("areas.id"), nullable=False, index=True)
    location_id: Mapped[str | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    # Without a title a visit goes by the name of its location, else of its area.
    title_nl: Mapped[str | None] = mapped_column(String(160), nullable=True)
    title_en: Mapped[str | None] = mapped_column(String(160), nullable=True)
    title_nl_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    title_en_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    title = Localized()
    kind: Mapped[VisitKind | None] = mapped_column(_enum_column(VisitKind, "travel_visit_kind"), nullable=True)
    # Owner-only planning state; never part of a shared visit.
    status: Mapped[PlanningStatus] = mapped_column(
        _enum_column(PlanningStatus, "travel_planning_status"), default=PlanningStatus.PLANNED, nullable=False
    )
    starts_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Inclusive last day of a multi-day visit such as "18-20 nov".
    ends_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Local wall-clock times at the visit; the time zone is the area's.
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    end_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_nl: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_nl_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    summary_en_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    summary = Localized()
    visibility: Mapped[Visibility] = _visibility_column()
    # Whether a shared visit also shows its times. A separate choice from sharing the visit at all.
    # ``share_date_precision`` is this visit's own cap on its days; ``None`` follows the audience.
    share_time: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    share_date_precision: Mapped[DatePrecision | None] = mapped_column(
        _enum_column(DatePrecision, "travel_date_precision"), default=None, nullable=True
    )
    # Visits tie on day and time often, and a batch inserts several in one transaction (where ``now()`` is
    # constant), so the creation order is stamped by the application with sub-second precision.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped[Trip] = relationship(back_populates="visits")
    area: Mapped[Area] = relationship(foreign_keys=[area_id])
    location: Mapped[Location | None] = relationship(foreign_keys=[location_id])
    # Owner-only: the alternative group this visit is compared in, if any. Never delivered to a visitor.
    alternative_membership: Mapped[AlternativeGroupMember | None] = relationship(
        back_populates="visit", cascade="all, delete-orphan", uselist=False
    )

    @property
    def content_language(self) -> str:
        return _trip_language(self)


# One order per record kind, shared by the ``Trip`` collections and the endpoints that list a kind on its own.
# The id only keeps rows that tie in a stable order.
# By day, then time (a visit without a time follows the timed ones of its day, as in the Agenda), then creation;
# undated visits come last, in creation order.
VISIT_ORDER = (
    Visit.starts_on.is_(None),
    Visit.starts_on,
    Visit.start_time.is_(None),
    Visit.start_time,
    Visit.created_at,
    Visit.id,
)


def visit_order_key(visit: Visit) -> tuple:
    """``VISIT_ORDER`` for visits already in memory (a collection loaded before an edit keeps its old order)."""
    return (
        visit.starts_on is None,
        visit.starts_on or date.min,
        visit.start_time is None,
        visit.start_time or time.min,
        visit.created_at.replace(tzinfo=None),
        visit.id,
    )
