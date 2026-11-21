"""Emergency information ORM model."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.base import _enum_column, opaque_id
from app.models.enums import EmergencyInfoKind


class EmergencyInfoEntry(Base):
    """One owner-only emergency-information entry: a contact, a relevant
    number, or a concise medical/assistance note.

    Deliberately trip-independent and file-free, so it is hard-deleted like
    :class:`TripTask`/:class:`Visit` rather than soft-deleted like
    the file-backed resources.
    """

    __tablename__ = "emergency_info_entries"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    owner_subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    kind: Mapped[EmergencyInfoKind] = mapped_column(_enum_column(EmergencyInfoKind, "travel_emergency_info_kind"))
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
