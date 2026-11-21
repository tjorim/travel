"""Area ORM model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.content_language import Localized
from app.db.base import Base
from app.models.base import _trip_language, _visibility_column, opaque_id
from app.models.enums import Visibility

if TYPE_CHECKING:
    from app.models.trips import Trip


class Area(Base):
    """A city or region: where things are, without saying exactly where.

    An area holds a label, country and region, an optional rounded point and an
    optional IANA time zone (for example ``Asia/Taipei``), which lets the
    owner's views place stays and live local time. Sharing an area shows its
    label, local name (beside the label), region, country and point, never its time
    zone, and never shares the locations filed under it."""

    __tablename__ = "areas"
    __table_args__ = (
        CheckConstraint("latitude >= -90 AND latitude <= 90", name="ck_areas_latitude"),
        CheckConstraint("longitude >= -180 AND longitude <= 180", name="ck_areas_longitude"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    visibility: Mapped[Visibility] = _visibility_column()
    # Both ``None`` marks an unnamed area: the owner gave no name, so the interface
    # shows its own translated fallback and nothing language-bound is stored. ``label`` is the plain name over
    # the two languages (``app.core.content_language``).
    label_nl: Mapped[str | None] = mapped_column(String(120), nullable=True)
    label_en: Mapped[str | None] = mapped_column(String(120), nullable=True)
    label = Localized()
    # The name as written where the place is (#376): not a translation, often not in Latin script, and in neither
    # language of the labels. Shown beside the label wherever the label is shared, and used for navigation.
    local_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    region: Mapped[str | None] = mapped_column(String(120), nullable=True)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped[Trip] = relationship(foreign_keys=[trip_id], viewonly=True)

    @property
    def content_language(self) -> str:
        return _trip_language(self)
