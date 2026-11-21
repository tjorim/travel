"""Live location session, audience and point ORM models."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.base import _enum_column, opaque_id
from app.models.enums import LIVE_DELAYS, LiveAudienceKind, LivePrecision


class LiveSession(Base):
    """Explicit owner/source/trip binding; never traversed by story projections.

    ``source`` is an opaque identifier the owner chooses; Travel never interprets it. The audiences that may receive
    the current position, each with its own precision and delay, are the rows of ``audiences``."""

    __tablename__ = "live_sessions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(128))
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    watermark: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The newest accepted point. Deleting the tracks clears it; the circular reference is added after both tables.
    current_id: Mapped[str | None] = mapped_column(
        ForeignKey("live_points.id", ondelete="SET NULL", use_alter=True, name="fk_live_sessions_current_point")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    audiences: Mapped[list[LiveSessionAudience]] = relationship(
        back_populates="session", cascade="all, delete-orphan", passive_deletes=True, order_by="LiveSessionAudience.id"
    )


class LiveSessionAudience(Base):
    """One audience a session's current position may be shown to, with the precision and delay chosen for it.

    The audience is its kind plus the record it names: the public view has none, a hidden link names its
    ``share_link_id``. The row goes with the link (``ON DELETE CASCADE``); the application also removes it when the
    link is revoked, expires or is rotated and when the public view is unpublished, so a setting never outlives the
    audience it was for. Collection members receive no live location (decision 244) and have no kind here."""

    __tablename__ = "live_session_audiences"
    __table_args__ = (
        UniqueConstraint("session_id", "share_link_id", name="uq_live_session_audiences_link"),
        Index(
            "uq_live_session_audiences_public",
            "session_id",
            unique=True,
            postgresql_where=text("kind = 'public'"),
            sqlite_where=text("kind = 'public'"),
        ),
        CheckConstraint("(kind = 'link') = (share_link_id IS NOT NULL)", name="ck_live_session_audiences_link_pair"),
        CheckConstraint(
            "delay_seconds IN (" + ", ".join(str(delay) for delay in LIVE_DELAYS) + ")",
            name="ck_live_session_audiences_delay",
        ),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[LiveAudienceKind] = mapped_column(
        _enum_column(LiveAudienceKind, "travel_live_audience_kind"), nullable=False
    )
    share_link_id: Mapped[str | None] = mapped_column(
        ForeignKey("share_links.id", ondelete="CASCADE"), nullable=True, index=True
    )
    precision: Mapped[LivePrecision] = mapped_column(
        _enum_column(LivePrecision, "travel_live_precision"), nullable=False
    )
    delay_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    session: Mapped[LiveSession] = relationship(back_populates="audiences")


class LivePoint(Base):
    __tablename__ = "live_points"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid7().hex)
    session_id: Mapped[str] = mapped_column(ForeignKey("live_sessions.id", ondelete="CASCADE"))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    __table_args__ = (
        UniqueConstraint("session_id", "observed_at", name="uq_live_points_session_observed"),
        Index("ix_live_points_session_id_id", "session_id", "id"),
        CheckConstraint("latitude >= -90 AND latitude <= 90", name="ck_live_points_latitude"),
        CheckConstraint("longitude >= -180 AND longitude <= 180", name="ck_live_points_longitude"),
    )
