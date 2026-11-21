"""Stay ORM models."""

from __future__ import annotations

from datetime import date, datetime, time
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, String, Text, Time, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.base import _enum_column, _visibility_column, opaque_id
from app.models.enums import DatePrecision, PlanningStatus, Visibility

if TYPE_CHECKING:
    from app.models.alternatives import AlternativeGroupMember
    from app.models.areas import Area
    from app.models.documents import DocumentAsset
    from app.models.locations import Location
    from app.models.trips import Trip


class Stay(Base):
    """An accommodation, modelled as the nights slept there.

    Private by default; its ``visibility`` decides whether an audience sees it.

    ``check_in_date`` is the first night and ``check_out_date`` the morning
    of departure, so the stay covers every night ``d`` with
    ``check_in_date <= d < check_out_date``. Both are local calendar dates
    at the accommodation, as are the optional check-in/check-out times.

    Every stay has an ``area`` and, once an accommodation is chosen, a
    ``location`` in that area. While it is undecided the stay is filed under its
    area only: no placeholder location is created for it. A stay's area is its
    own ``area_id``, which always equals the area of its location when it has
    one (the same pattern as a visit or a route end). The location, property and
    booking/contact details are never shareable; sharing a stay shows only its
    area and its nights."""

    __tablename__ = "stays"
    __table_args__ = (CheckConstraint("check_out_date > check_in_date", name="ck_stay_check_out_after_check_in"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    area_id: Mapped[str] = mapped_column(ForeignKey("areas.id"), nullable=False, index=True)
    location_id: Mapped[str | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    check_in_date: Mapped[date] = mapped_column(Date, nullable=False)
    check_out_date: Mapped[date] = mapped_column(Date, nullable=False)
    check_in_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    check_out_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    status: Mapped[PlanningStatus] = mapped_column(
        _enum_column(PlanningStatus, "travel_planning_status"), default=PlanningStatus.PLANNED
    )
    property_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    website_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    booking_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_details: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # A shared stay is only its city or area and its nights, at this precision;
    # never the property, location or booking details. ``None`` follows the
    # audience; an audience never gets a finer precision than this or its own
    # setting allows (see ``app.precision``).
    visibility: Mapped[Visibility] = _visibility_column()
    share_date_precision: Mapped[DatePrecision | None] = mapped_column(
        _enum_column(DatePrecision, "travel_date_precision"), default=None, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped[Trip] = relationship(back_populates="stays")
    area: Mapped[Area] = relationship(foreign_keys=[area_id])
    location: Mapped[Location | None] = relationship(foreign_keys=[location_id])
    # Owner-only: the alternative group this stay is compared in, if any. Never delivered to a visitor.
    alternative_membership: Mapped[AlternativeGroupMember | None] = relationship(
        back_populates="stay", cascade="all, delete-orphan", uselist=False
    )
    # Owner-only: the booking confirmations attached to this stay. Never delivered to a visitor.
    document_links: Mapped[list[StayDocumentAsset]] = relationship(
        back_populates="stay", cascade="all, delete-orphan", order_by="StayDocumentAsset.created_at"
    )

    @property
    def document_asset_ids(self) -> list[str]:
        return [link.document_asset_id for link in self.document_links]


class StayDocumentAsset(Base):
    """An owner-only, explicit attachment of a document to a stay.

    The twin of :class:`RouteDocumentAsset`: attaching a booking confirmation gives
    the owner a private reference and never makes the document eligible for
    projection, whatever the stay's visibility.
    """

    __tablename__ = "stay_document_assets"

    stay_id: Mapped[str] = mapped_column(ForeignKey("stays.id", ondelete="CASCADE"), primary_key=True)
    document_asset_id: Mapped[str] = mapped_column(
        ForeignKey("document_assets.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    stay: Mapped[Stay] = relationship(back_populates="document_links")
    document_asset: Mapped[DocumentAsset] = relationship()


STAY_ORDER = (Stay.check_in_date, Stay.id)
