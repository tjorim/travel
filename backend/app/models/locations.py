"""Location ORM model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.content_language import Localized
from app.db.base import Base
from app.models.base import _trip_language, _visibility_column, opaque_id
from app.models.enums import Visibility

from .localized import LocalizedRecord

if TYPE_CHECKING:
    from app.models.areas import Area
    from app.models.trips import Trip


class Location(LocalizedRecord, Base):
    """A hotel, station or monument, with an address and coordinates, or just a city.

    A location always belongs to one ``area``. It can be shared by its
    ``visibility``, but only through a fixed allowlist: its public ``label`` (and the
    ``local_name`` beside it), city, country and point, and its address only when the owner has also
    chosen ``share_address``. Notes, provider ids and the display name (which
    usually contains the address) are never shared, and a location cannot be
    shared without a ``label``."""

    localized_fields = ("label",)

    __tablename__ = "locations"
    __table_args__ = (
        Index("ix_locations_osm_element", "osm_element_type", "osm_element_id"),
        CheckConstraint(
            "(osm_element_type IS NULL) = (osm_element_id IS NULL)", name="ck_locations_osm_reference_pair"
        ),
        CheckConstraint(
            "osm_element_type IS NULL OR osm_element_type IN ('node', 'way', 'relation')",
            name="ck_locations_osm_element_type",
        ),
        CheckConstraint("latitude >= -90 AND latitude <= 90", name="ck_locations_latitude"),
        CheckConstraint("longitude >= -180 AND longitude <= 180", name="ck_locations_longitude"),
        CheckConstraint(
            "viewport_north >= -90 AND viewport_north <= 90 AND viewport_south >= -90 AND viewport_south <= 90",
            name="ck_locations_viewport_latitudes",
        ),
        CheckConstraint(
            "viewport_east >= -180 AND viewport_east <= 180 AND viewport_west >= -180 AND viewport_west <= 180",
            name="ck_locations_viewport_longitudes",
        ),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    # Derived from the location's city when it is created, and changeable.
    area_id: Mapped[str] = mapped_column(ForeignKey("areas.id"), nullable=False, index=True)
    visibility: Mapped[Visibility] = _visibility_column()
    # The name a shared location goes by: owner-only until the location is shared,
    # and required for that, because the display name usually contains the address.
    label_nl: Mapped[str | None] = mapped_column(String(120), nullable=True)
    label_en: Mapped[str | None] = mapped_column(String(120), nullable=True)
    label_nl_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    label_en_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    label = Localized()
    # The name as written where the place is (#376), as on an area. It follows the label's visibility.
    local_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # Whether a shared location also shows its address, for example a hotel family
    # may need to contact. A separate choice from sharing the location at all.
    share_address: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # An OSM element is durable as the (type, id) pair.  In particular,
    # Nominatim's result-local ``place_id`` is intentionally not stored.
    osm_element_type: Mapped[str | None] = mapped_column(String(12), nullable=True)
    osm_element_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    osm_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    address_line1: Mapped[str | None] = mapped_column(String(160), nullable=True)
    address_line2: Mapped[str | None] = mapped_column(String(160), nullable=True)
    locality: Mapped[str | None] = mapped_column(String(120), nullable=True)
    admin_area: Mapped[str | None] = mapped_column(String(120), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    viewport_north: Mapped[float | None] = mapped_column(Float, nullable=True)
    viewport_south: Mapped[float | None] = mapped_column(Float, nullable=True)
    viewport_east: Mapped[float | None] = mapped_column(Float, nullable=True)
    viewport_west: Mapped[float | None] = mapped_column(Float, nullable=True)
    navigation_provider: Mapped[str | None] = mapped_column(String(40), nullable=True)
    navigation_provider_place_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    area: Mapped[Area] = relationship(foreign_keys=[area_id])
    trip: Mapped[Trip] = relationship(foreign_keys=[trip_id], viewonly=True)

    @property
    def content_language(self) -> str:
        return _trip_language(self)
