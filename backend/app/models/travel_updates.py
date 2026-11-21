"""Travel update (reisupdate) ORM models."""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.content_language import Localized
from app.core.update_day import ZoneSpan, update_day, update_zone
from app.db.base import Base
from app.models.base import _enum_column, _languages, _trip_language, _visibility_column, opaque_id
from app.models.enums import DatePrecision, Visibility

if TYPE_CHECKING:
    from app.models.areas import Area
    from app.models.locations import Location
    from app.models.media import MediaAsset
    from app.models.trips import Trip


class TravelUpdateMediaAsset(Base):
    """An owner-only, explicit attachment of an ingested asset to a reisupdate.

    This is deliberately separate from a share derivative. Attaching an
    original gives the owner a private editing affordance; it never makes the
    asset or its EXIF eligible for projection.
    """

    __tablename__ = "travel_update_media_assets"

    travel_update_id: Mapped[str] = mapped_column(ForeignKey("travel_updates.id", ondelete="CASCADE"), primary_key=True)
    media_asset_id: Mapped[str] = mapped_column(
        ForeignKey("media_assets.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    travel_update: Mapped[TravelUpdate] = relationship(back_populates="media_links")
    media_asset: Mapped[MediaAsset] = relationship(back_populates="update_links")


class TravelUpdate(Base):
    """A reisupdate: the one record for something that happened on a trip.

    It has a private part and a shared part, kept in separate columns so that
    private text can never reach a visitor by changing a switch.

    Private, always: ``private_notes``, the exact ``location``, the
    attached originals (``media_links``) and the precise ``occurred_at`` time.

    Shared, once ``visibility`` allows it: ``title``, ``body`` (written for
    visitors and empty until the owner writes it), the date at
    ``share_date_precision``, and the ``chosen_area``. ``area_id``
    always references an area, never a location."""

    __tablename__ = "travel_updates"
    __table_args__ = _languages("travel_updates.title")
    __allow_unmapped__ = True  # ``zone_spans`` is a plain attribute, not a column

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    share_id: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    area_id: Mapped[str | None] = mapped_column(ForeignKey("areas.id"), nullable=True)
    location_id: Mapped[str | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    share_date_precision: Mapped[DatePrecision] = mapped_column(_enum_column(DatePrecision, "travel_date_precision"))
    title_nl: Mapped[str | None] = mapped_column(String(160), nullable=True)
    title_en: Mapped[str | None] = mapped_column(String(160), nullable=True)
    title = Localized(default="")
    body_nl: Mapped[str | None] = mapped_column(Text, nullable=True)
    body_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    body = Localized(default="")
    private_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    visibility: Mapped[Visibility] = _visibility_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped[Trip] = relationship(back_populates="travel_updates")
    chosen_area: Mapped[Area | None] = relationship(foreign_keys=[area_id])
    location: Mapped[Location | None] = relationship(foreign_keys=[location_id])
    media_links: Mapped[list[TravelUpdateMediaAsset]] = relationship(
        back_populates="travel_update", cascade="all, delete-orphan", order_by="TravelUpdateMediaAsset.created_at"
    )

    @property
    def content_language(self) -> str:
        return _trip_language(self)

    @property
    def media_asset_ids(self) -> list[str]:
        return [link.media_asset_id for link in self.media_links]

    @property
    def area(self) -> Area | None:
        """The update's area: its location wins; location-less updates name one directly."""
        return (self.location.area if self.location is not None else None) or self.chosen_area

    # The trip's zoned stay and visit days, set by the service that lists updates so that reading each one does not
    # reload them; without them the update reads them from its trip (see ``app.core.update_day``).
    zone_spans: tuple[ZoneSpan, ...] | None = None

    @property
    def timezone(self) -> str:
        """The zone the update's day is read in: its area's, else the trip's nearest stay or visit, else UTC."""
        return update_zone(self, self.zone_spans)

    @property
    def local_date(self) -> date:
        """The calendar day of ``occurred_at`` in ``timezone``: the day every surface shows for the update."""
        return update_day(self, self.zone_spans)


# Chronological, like every dated kind above: the order a visitor reads the story in, the PDF and the export write it
# in, and the owner's list returns it in. A client that wants the newest first reads the tail (``?latest=N``).
TRAVEL_UPDATE_ORDER = (TravelUpdate.occurred_at, TravelUpdate.id)


def travel_update_order_key(update: TravelUpdate) -> tuple:
    """``TRAVEL_UPDATE_ORDER`` for updates already in memory (a stored instant may read back without its offset)."""
    return (update.occurred_at.replace(tzinfo=None), update.id)
