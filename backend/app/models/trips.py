"""Trip ORM model."""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.content_language import Localized
from app.db.base import Base
from app.models.base import _content_language_column, _languages, opaque_id
from app.models.routes import ROUTE_ORDER
from app.models.stays import STAY_ORDER
from app.models.tasks import TASK_ORDER
from app.models.travel_updates import TRAVEL_UPDATE_ORDER
from app.models.visits import VISIT_ORDER

from .localized import LocalizedRecord

if TYPE_CHECKING:
    from app.models.alternatives import AlternativeGroup
    from app.models.areas import Area
    from app.models.collections import CollectionMember
    from app.models.locations import Location
    from app.models.media import MediaDerivative
    from app.models.packing import PackingList
    from app.models.routes import Route
    from app.models.stays import Stay
    from app.models.tasks import TripTask
    from app.models.travel_updates import TravelUpdate
    from app.models.visits import Visit


class Trip(LocalizedRecord, Base):
    localized_fields = ("title", "summary")

    __tablename__ = "trips"
    __table_args__ = (
        *_languages("trips.title"),
        CheckConstraint("content_language IN ('nl', 'en')", name="ck_trips_content_language"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    owner_subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    # The language a write to ``title`` or ``summary`` lands in, and the one a read prefers. Neither language is
    # the original: each text field is two columns, and the plain name is the content language's with fallback.
    content_language: Mapped[str] = _content_language_column()
    title_nl: Mapped[str | None] = mapped_column(String(160), nullable=True)
    title_en: Mapped[str | None] = mapped_column(String(160), nullable=True)
    title_nl_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    title_en_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    title = Localized(default="")
    summary_nl: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_nl_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    summary_en_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    summary = Localized()
    # Local calendar dates of the first and last travel day. Owner-only
    # unless a share scope explicitly selects them at a chosen precision.
    starts_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    ends_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    visits: Mapped[list[Visit]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by=lambda: VISIT_ORDER
    )
    areas: Mapped[list[Area]] = relationship(
        foreign_keys="Area.trip_id", cascade="all, delete-orphan", order_by="Area.created_at"
    )
    locations: Mapped[list[Location]] = relationship(
        foreign_keys="Location.trip_id", cascade="all, delete-orphan", order_by="Location.created_at"
    )
    travel_updates: Mapped[list[TravelUpdate]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by=lambda: TRAVEL_UPDATE_ORDER
    )
    stays: Mapped[list[Stay]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by=lambda: STAY_ORDER
    )
    trip_tasks: Mapped[list[TripTask]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by=lambda: TASK_ORDER
    )
    packing_lists: Mapped[list[PackingList]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    routes: Mapped[list[Route]] = relationship(
        back_populates="trip",
        cascade="all, delete-orphan",
        order_by=lambda: ROUTE_ORDER,
    )
    media_derivatives: Mapped[list[MediaDerivative]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="MediaDerivative.created_at"
    )
    alternative_groups: Mapped[list[AlternativeGroup]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="AlternativeGroup.created_at"
    )

    # A deleted trip leaves every collection in the same transaction.
    collection_memberships: Mapped[list[CollectionMember]] = relationship(cascade="all, delete-orphan")

    @property
    def cover_derivative_id(self) -> str | None:
        """The photo copy the owner nominated as cover; ``None`` when there is none or it was deleted."""
        return next((item.id for item in self.media_derivatives if item.is_cover), None)

    @property
    def cover_url(self) -> str | None:
        """The owner-only file route of the cover copy; a visitor's cover comes from the audience's projection."""
        cover = next((item for item in self.media_derivatives if item.is_cover), None)
        if cover is None:
            return None
        return cover_file_route(self.id, cover)


def cover_file_route(trip_id: str, cover: MediaDerivative) -> str:
    """The owner-only file route of a trip's cover copy."""
    return f"/api/trips/{trip_id}/media/{cover.media_asset_id}/derivatives/{cover.id}/file"
