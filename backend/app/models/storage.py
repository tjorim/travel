"""Stored object ORM model."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.base import _enum_column, opaque_id
from app.models.enums import ObjectState


class StoredObject(Base):
    """Object-storage inventory for one stored file.

    A row moves `staged` -> `available` only after its checksum is verified
    against the just-written bytes; only an `available` object may back a
    `MediaAsset`, `MediaDerivative` or `DocumentAsset`.

    A media original or derivative belongs to a trip (`trip_id`) and two uploads of identical bytes for the same
    trip reuse one row (`uq_stored_object_trip_sha256`). A document original belongs to the owner (`owner_subject`),
    whichever trip the document is filed under, and identical bytes are stored once per owner
    (`uq_stored_object_owner_sha256`). Both homes are set only on an object that an older version shared between a
    photo and a document. Detached purge inventory has neither and survives trip deletion until the locked
    maintenance purge succeeds. Deduplication never crosses trips or owners.
    """

    __tablename__ = "stored_objects"
    __table_args__ = (
        UniqueConstraint("trip_id", "sha256", name="uq_stored_object_trip_sha256"),
        Index(
            "uq_stored_object_owner_sha256",
            "owner_subject",
            "sha256",
            unique=True,
            postgresql_where=text("owner_subject IS NOT NULL"),
            sqlite_where=text("owner_subject IS NOT NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str | None] = mapped_column(ForeignKey("trips.id", ondelete="SET NULL"), nullable=True, index=True)
    owner_subject: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    bucket: Mapped[str] = mapped_column(String(64), nullable=False, default="media")
    object_key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    # 64-bit: `media_max_upload_bytes` is configurable, so a 32-bit column could overflow.
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    state: Mapped[ObjectState] = mapped_column(
        _enum_column(ObjectState, "travel_object_state"), default=ObjectState.STAGED
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
