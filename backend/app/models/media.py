"""Media asset, derivative, provider import and media worker job ORM models."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint, false, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.content_language import Localized
from app.db.base import Base
from app.models.base import _enum_column, _trip_language, _visibility_column, opaque_id
from app.models.enums import (
    DerivativeProcessingBackend,
    DerivativeProcessingState,
    DerivativePurpose,
    DerivativeReviewState,
    ImportProvider,
    ImportSessionState,
    ImportState,
    MediaKind,
    Visibility,
)

if TYPE_CHECKING:
    from app.models.storage import StoredObject
    from app.models.travel_updates import TravelUpdateMediaAsset
    from app.models.trips import Trip


class ImportSession(Base):
    """A Google Photos Picker / GoPro Cloud selection session for one owner.

    `provider_session_id` and any provider handle needed to poll selection
    status are owner-only provenance; they are never serialized to a client
    beyond the id needed to call `complete` again. A session starts `pending`
    and becomes `completed` once the owner's selection has been imported (an
    import may be completed more than once, safely, by retrying)."""

    __tablename__ = "import_sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    provider: Mapped[ImportProvider] = mapped_column(_enum_column(ImportProvider, "travel_import_provider"))
    provider_session_id: Mapped[str] = mapped_column(String(255), nullable=False)
    state: Mapped[ImportSessionState] = mapped_column(
        _enum_column(ImportSessionState, "travel_import_session_state"), default=ImportSessionState.PENDING
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ImportRecord(Base):
    """Provenance for one imported media item.

    Uniqueness on `(trip_id, provider, provider_item_id)` makes completing an
    import session idempotent: retrying it after a partial failure only
    (re)fetches items that do not already have a `completed` row. A provider
    access token is never stored here; it lives only in the secret store
    (`app.core.secrets`) for the lifetime the owner allows."""

    __tablename__ = "import_records"
    __table_args__ = (
        UniqueConstraint("trip_id", "provider", "provider_item_id", name="uq_import_record_provider_item"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    provider: Mapped[ImportProvider] = mapped_column(_enum_column(ImportProvider, "travel_import_provider"))
    provider_item_id: Mapped[str] = mapped_column(String(255), nullable=False)
    state: Mapped[ImportState] = mapped_column(
        _enum_column(ImportState, "travel_import_state"), default=ImportState.PENDING
    )
    media_asset_id: Mapped[str | None] = mapped_column(
        ForeignKey("media_assets.id", ondelete="SET NULL", use_alter=True, name="fk_import_records_media_asset_id"),
        nullable=True,
    )
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(120), nullable=True)


class MediaAsset(Base):
    """One imported/uploaded original. Raw EXIF/XMP/IPTC and camera data in
    `raw_metadata` are owner-only and never leave an owner-audience response;
    `original_object_id` always points to a copy in Travel-controlled object
    storage, never a provider URL."""

    __tablename__ = "media_assets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    original_object_id: Mapped[str] = mapped_column(ForeignKey("stored_objects.id"), unique=True, nullable=False)
    media_kind: Mapped[MediaKind] = mapped_column(_enum_column(MediaKind, "travel_media_kind"))
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # True when `captured_at` is the camera's wall-clock time as written in EXIF (stored with a nominal UTC label),
    # not an instant; it is shown unchanged in any viewer zone. See docs/decisions/297-exif-capture-time.md.
    captured_local: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)
    import_id: Mapped[str | None] = mapped_column(ForeignKey("import_records.id"), nullable=True)
    raw_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    original_object: Mapped[StoredObject] = relationship(foreign_keys=[original_object_id])
    derivatives: Mapped[list[MediaDerivative]] = relationship(
        back_populates="media_asset", cascade="all, delete-orphan"
    )
    update_links: Mapped[list[TravelUpdateMediaAsset]] = relationship(back_populates="media_asset")


class MediaDerivative(Base):
    """A stripped, resized copy of one `MediaAsset`, generated only when the
    owner selects that media for `share` publication (or, for `owner_preview`,
    for an in-app thumbnail). `metadata_stripped_at` records when stripping
    ran; `review_state` gates whether a `share` derivative may be referenced
    by a share scope item — a derivative is usable for sharing only once the
    owner has explicitly reviewed it."""

    __tablename__ = "media_derivatives"
    __table_args__ = (
        Index(
            "uq_media_derivatives_trip_cover",
            "trip_id",
            unique=True,
            postgresql_where=text("is_cover"),
            sqlite_where=text("is_cover"),
        ),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    media_asset_id: Mapped[str] = mapped_column(
        ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    object_id: Mapped[str | None] = mapped_column(ForeignKey("stored_objects.id"), nullable=True)
    poster_object_id: Mapped[str | None] = mapped_column(ForeignKey("stored_objects.id"), nullable=True)
    processing_state: Mapped[DerivativeProcessingState] = mapped_column(
        _enum_column(DerivativeProcessingState, "travel_derivative_processing_state"),
        default=DerivativeProcessingState.READY,
        nullable=False,
    )
    processing_backend: Mapped[DerivativeProcessingBackend] = mapped_column(
        _enum_column(DerivativeProcessingBackend, "travel_derivative_processing_backend"),
        default=DerivativeProcessingBackend.LOCAL,
        server_default=DerivativeProcessingBackend.LOCAL.value,
    )
    processing_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remove_audio: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    purpose: Mapped[DerivativePurpose] = mapped_column(_enum_column(DerivativePurpose, "travel_derivative_purpose"))
    metadata_stripped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_state: Mapped[DerivativeReviewState] = mapped_column(
        _enum_column(DerivativeReviewState, "travel_derivative_review_state"), default=DerivativeReviewState.PENDING
    )
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    travel_update_id: Mapped[str | None] = mapped_column(
        ForeignKey("travel_updates.id", ondelete="SET NULL"), nullable=True
    )
    caption_nl: Mapped[str | None] = mapped_column(String(500), nullable=True)
    caption_en: Mapped[str | None] = mapped_column(String(500), nullable=True)
    caption = Localized()
    alt_text_nl: Mapped[str | None] = mapped_column(String(300), nullable=True)
    alt_text_en: Mapped[str | None] = mapped_column(String(300), nullable=True)
    alt_text = Localized()
    focal_x: Mapped[int | None] = mapped_column(Integer, nullable=True)
    focal_y: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # A photo attached to a reisupdate is delivered with that update and this
    # choice is ignored; it only governs a loose gallery photo.
    visibility: Mapped[Visibility] = _visibility_column()
    # The owner's choice of this photo as its trip's cover, at most one per trip.
    # It only nominates the photo: an audience shows it only when it already
    # receives this derivative, so it never grants publication on its own.
    is_cover: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    trip: Mapped[Trip] = relationship(back_populates="media_derivatives")
    media_asset: Mapped[MediaAsset] = relationship(back_populates="derivatives")
    object: Mapped[StoredObject | None] = relationship(foreign_keys=[object_id])
    poster_object: Mapped[StoredObject | None] = relationship(foreign_keys=[poster_object_id])

    @property
    def content_language(self) -> str:
        return _trip_language(self)


class MediaWorkerJob(Base):
    """Private durable outbox; survives derivative/asset deletion to cancel and ACK remote work."""

    __tablename__ = "media_worker_jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    derivative_id: Mapped[str | None] = mapped_column(
        ForeignKey("media_derivatives.id", ondelete="SET NULL"), unique=True, nullable=True
    )
    worker_id: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    profile: Mapped[str] = mapped_column(String(40), default="travel-video-v1")
    remove_audio: Mapped[bool] = mapped_column(Boolean, nullable=False)
    source_key: Mapped[str] = mapped_column(String(300))
    source_sha256: Mapped[str] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    error_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
