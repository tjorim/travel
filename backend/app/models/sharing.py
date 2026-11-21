"""Public surface and hidden share link ORM models."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base
from app.models.base import _enum_column, opaque_id
from app.models.enums import LinkState, SurfaceState


class PublicSurface(Base):
    """The trip's public follower view: a stable URL, whether it's currently
    published, and its live scope. Content and scope both render from
    current canonical data on every request, filtered to `scope` — there is
    no frozen snapshot. `state` is the only gate: it controls whether this
    trip is served publicly at all; while published, editing `scope` takes
    effect immediately."""

    __tablename__ = "public_surfaces"

    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), primary_key=True)
    slug: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, default=opaque_id)
    state: Mapped[SurfaceState] = mapped_column(
        _enum_column(SurfaceState, "travel_surface_state"), default=SurfaceState.UNPUBLISHED
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    scope: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Display label only (#241): the preset last applied to this audience and when. Nothing that decides what an
    # audience receives (projection, files, navigation, `access.receivers`) ever reads it.
    applied_preset: Mapped[str | None] = mapped_column(String(32), nullable=True)
    applied_preset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ShareLink(Base):
    """A named, revocable, high-entropy unlisted URL. The owner-managed URL
    is stored so its owner can copy it again later; the separate keyed
    verifier remains the only value used for anonymous delivery. `state`
    gates whether the URL works at all; while `active`, `scope` is live and
    editing it takes effect immediately for anyone holding the URL — content
    and scope both render from current canonical data on every exchange,
    never a frozen snapshot."""

    __tablename__ = "share_links"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    # Stable across rotations, so the owner sees one link and its prior URLs
    # as history rather than unrelated records.
    series_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    state: Mapped[LinkState] = mapped_column(_enum_column(LinkState, "travel_link_state"), default=LinkState.DRAFT)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    scope: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Display label only (#241): the preset last applied to this audience and when. Nothing that decides what an
    # audience receives (projection, files, navigation, `access.receivers`) ever reads it.
    applied_preset: Mapped[str | None] = mapped_column(String(32), nullable=True)
    applied_preset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    feed_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    feed_verifier: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    feed_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    token_verifier: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
