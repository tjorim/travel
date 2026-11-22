"""Collection link ORM models."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates
from sqlalchemy.types import JSON

from app.core.content_language import Localized
from app.db.base import Base
from app.models.base import _code, _content_language_column, _enum_column, opaque_id
from app.models.enums import CollectionAuditKind, LinkState

from .localized import LocalizedRecord


class Collection(LocalizedRecord, Base):
    """An owner-wide, named, revocable capability that opens several trips at once.

    It has its own token and keyed verifier and never reuses a per-trip link's.
    `state` gates the whole collection; each member owns the scope its trip is
    delivered at, so a collection can show less than the trip's own links.
    Everything renders live from canonical data -- there is no snapshot. The
    label is owner-only; `title` is optional text written for visitors."""

    localized_fields = ("title",)

    __tablename__ = "collections"
    __table_args__ = (CheckConstraint("content_language IN ('nl', 'en')", name="ck_collections_content_language"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    owner_subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    # A collection belongs to no single trip, so it has its own content language, like a trip.
    content_language: Mapped[str] = _content_language_column()
    title_nl: Mapped[str | None] = mapped_column(String(160), nullable=True)
    title_en: Mapped[str | None] = mapped_column(String(160), nullable=True)
    title_nl_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    title_en_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    title = Localized()
    state: Mapped[LinkState] = mapped_column(_enum_column(LinkState, "travel_link_state"), default=LinkState.DRAFT)
    token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    token_verifier: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Counts completed rotations, so the owner sees the capability was replaced.
    rotations: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    members: Mapped[list[CollectionMember]] = relationship(
        back_populates="collection", cascade="all, delete-orphan", order_by="CollectionMember.created_at"
    )


class CollectionMember(Base):
    """One trip in a collection, with the scope the collection delivers it at.

    `id` is the opaque identifier visitors see in the path instead of the trip's
    own id. A member disappears with its trip or its collection."""

    __tablename__ = "collection_members"
    __table_args__ = (UniqueConstraint("collection_id", "trip_id", name="uq_collection_members_trip"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    collection_id: Mapped[str] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE"), nullable=False, index=True
    )
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
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

    collection: Mapped[Collection] = relationship(back_populates="members")


class CollectionAuditEvent(Base):
    """Owner-only audit trail for collection lifecycle and membership changes.

    Collections belong to the owner, not a trip, so these events are kept apart
    from `AuditEvent`. Ids are kept after a collection or trip is deleted (there
    is no foreign key). Like `AuditEvent`, `details` never holds a raw token or
    recipient identity. Retained and purged with the other audit tables."""

    __tablename__ = "collection_audit_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    owner_subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    actor_subject: Mapped[str] = mapped_column(String(255), nullable=False)
    collection_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    trip_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    kind: Mapped[str] = mapped_column(String(60), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    @validates("kind")
    def _validate_kind(self, _key: str, value: object) -> str:
        return _code(CollectionAuditKind, value)
