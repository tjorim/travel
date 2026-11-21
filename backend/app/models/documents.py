"""Owner document ORM model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base
from app.models.base import _enum_column, opaque_id
from app.models.enums import DocumentKind

if TYPE_CHECKING:
    from app.models.storage import StoredObject


class DocumentAsset(Base):
    """One owner-only original document.

    A document belongs to the owner and is optionally filed under one trip (`trip_id`). Only a document filed
    under a trip can be attached to that trip's stays and routes. Deleting the trip unfiles its documents instead
    of deleting them. The original object and its metadata remain behind owner authentication.
    """

    __tablename__ = "document_assets"
    __table_args__ = (
        # One document per file and trip (retry-safe upload); the same bytes may sit under several trips. Unfiled
        # documents are deliberately not unique: deleting a trip unfiles its documents, and two of them may then
        # hold the same file. No document is dropped to make a trip delete fit.
        Index(
            "uq_document_assets_object_trip",
            "original_object_id",
            "trip_id",
            unique=True,
            postgresql_where=text("trip_id IS NOT NULL"),
            sqlite_where=text("trip_id IS NOT NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    owner_subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    trip_id: Mapped[str | None] = mapped_column(ForeignKey("trips.id", ondelete="SET NULL"), nullable=True, index=True)
    original_object_id: Mapped[str] = mapped_column(ForeignKey("stored_objects.id"), nullable=False, index=True)
    document_kind: Mapped[DocumentKind] = mapped_column(_enum_column(DocumentKind, "travel_document_kind"))
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    owner_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    original_object: Mapped[StoredObject] = relationship(foreign_keys=[original_object_id])
