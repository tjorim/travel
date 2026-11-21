"""Route ORM models."""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.content_language import Localized
from app.db.base import Base
from app.models.base import _enum_column, _trip_language, _visibility_column, opaque_id
from app.models.enums import PlanningStatus, RouteMode, Visibility

if TYPE_CHECKING:
    from app.models.alternatives import AlternativeGroupMember
    from app.models.areas import Area
    from app.models.documents import DocumentAsset
    from app.models.locations import Location
    from app.models.trips import Trip


class Route(Base):
    """How the traveller gets from one area to another, at any level of detail.

    A route always runs between two *areas*; that is all a visitor ever sees of
    its ends. Everything else is optional and owner-side: the exact departure and
    arrival ``locations`` (a station, an airport), the schedule with each end's
    time zone, carrier, service number, class, booking reference, notes and
    attached documents, and a hand-drawn ``geometry`` line. Without a line the
    maps draw a straight one between the two areas.

    A shared route discloses only its mode and status, its two areas, its
    schedule, carrier and service reference, and the line. Booking references,
    travel class, notes, documents and the exact locations stay owner-only; a
    location appears on a map only when that location is itself shared. The
    line is drawn by hand; it is never derived from a live track (decision 244).
    """

    __tablename__ = "routes"
    __table_args__ = (
        CheckConstraint("(departs_at IS NULL) = (arrives_at IS NULL)", name="ck_route_times_paired"),
        CheckConstraint("arrives_at > departs_at", name="ck_route_arrival_after_departure"),
        CheckConstraint("departs_at IS NULL OR departs_on IS NOT NULL", name="ck_route_time_needs_a_day"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    mode: Mapped[RouteMode] = mapped_column(_enum_column(RouteMode, "travel_route_mode"), default=RouteMode.OTHER)
    status: Mapped[PlanningStatus] = mapped_column(
        _enum_column(PlanningStatus, "travel_planning_status"), default=PlanningStatus.PLANNED
    )
    # A name for the route; without one it is shown as "<from> → <to>".
    label_nl: Mapped[str | None] = mapped_column(String(160), nullable=True)
    label_en: Mapped[str | None] = mapped_column(String(160), nullable=True)
    label = Localized()
    departure_area_id: Mapped[str] = mapped_column(ForeignKey("areas.id"), nullable=False)
    arrival_area_id: Mapped[str] = mapped_column(ForeignKey("areas.id"), nullable=False)
    departure_location_id: Mapped[str | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    arrival_location_id: Mapped[str | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    # The local calendar day of departure, in the departure time zone. A route
    # can have a day before it has a train ("Kaohsiung → Taipei on 5 December");
    # once ``departs_at`` is set, this is always its local date.
    departs_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    departs_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    arrives_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # IANA zones of each end. When set, the owner enters and reads the local
    # wall-clock time there; the instants above stay in UTC.
    departure_timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    arrival_timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    carrier: Mapped[str | None] = mapped_column(String(160), nullable=True)
    service_reference: Mapped[str | None] = mapped_column(String(40), nullable=True)
    travel_class: Mapped[str | None] = mapped_column(String(80), nullable=True)
    booking_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # An owner-drawn, approximate GeoJSON line; optional.
    geometry: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    visibility: Mapped[Visibility] = _visibility_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped[Trip] = relationship(back_populates="routes")
    # Owner-only: the alternative group this route is compared in, if any. Never delivered to a visitor.
    alternative_membership: Mapped[AlternativeGroupMember | None] = relationship(
        back_populates="route", cascade="all, delete-orphan", uselist=False
    )
    departure_area: Mapped[Area] = relationship(foreign_keys=[departure_area_id])
    arrival_area: Mapped[Area] = relationship(foreign_keys=[arrival_area_id])
    departure_location: Mapped[Location | None] = relationship(foreign_keys=[departure_location_id])
    arrival_location: Mapped[Location | None] = relationship(foreign_keys=[arrival_location_id])
    document_links: Mapped[list[RouteDocumentAsset]] = relationship(
        back_populates="route", cascade="all, delete-orphan", order_by="RouteDocumentAsset.created_at"
    )

    @property
    def content_language(self) -> str:
        return _trip_language(self)

    @property
    def document_asset_ids(self) -> list[str]:
        return [link.document_asset_id for link in self.document_links]


class RouteDocumentAsset(Base):
    """An owner-only, explicit attachment of a document to a route.

    Deliberately separate from a share derivative, exactly like
    :class:`TravelUpdateMediaAsset`: attaching a document gives the owner a
    private booking-material reference and never makes it eligible for
    projection.
    """

    __tablename__ = "route_document_assets"

    route_id: Mapped[str] = mapped_column(ForeignKey("routes.id", ondelete="CASCADE"), primary_key=True)
    document_asset_id: Mapped[str] = mapped_column(
        ForeignKey("document_assets.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    route: Mapped[Route] = relationship(back_populates="document_links")
    document_asset: Mapped[DocumentAsset] = relationship()


# By day; within a day, day-only routes follow the timed ones, as in the Agenda.
ROUTE_ORDER = (
    Route.departs_on.is_(None),
    Route.departs_on,
    Route.departs_at.is_(None),
    Route.departs_at,
    Route.created_at,
    Route.id,
)
