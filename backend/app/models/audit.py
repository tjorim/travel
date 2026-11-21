"""Owner audit and activity event ORM models."""

from __future__ import annotations

import re
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, validates
from sqlalchemy.types import JSON

from app.db.base import Base
from app.models.base import _code, opaque_id
from app.models.enums import ActivityTransport, AuditEventKind, AuditTargetType

# An owner activity action is an MCP tool or operation name such as ``trip.export_pdf`` or ``create_trip``; the
# list grows with every tool, so the shape is checked instead of a code list.
_ACTIVITY_ACTION = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$")


class AuditEvent(Base):
    """Owner-only audit trail for publication/share-link lifecycle
    transitions (`travel/audit-event@1`). `details` records only
    link/projection ids, a scope fingerprint and owner-facing metadata --
    never a raw capability token, recipient identity or recipient IP, since
    an unlisted link is a forwardable capability and recording who redeemed
    it would defeat that model. Retained per the sharing policy's 24-month
    window; `purge_expired_audit_events` (`app.audit`) hard-deletes rows past
    it. `trip_id` is an id only (no foreign key): the events outlive a deleted
    trip until that window ends, and hold no trip content to leak (decision 36)."""

    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    actor_subject: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(60), nullable=False)
    target_type: Mapped[str] = mapped_column(String(32), nullable=False)
    target_id: Mapped[str] = mapped_column(String(32), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    @validates("kind")
    def _validate_kind(self, _key: str, value: object) -> str:
        return _code(AuditEventKind, value)

    @validates("target_type")
    def _validate_target_type(self, _key: str, value: object) -> str:
        return _code(AuditTargetType, value)


class OwnerActivityEvent(Base):
    """Append-only record of an authenticated owner operation that is not a sharing change: an MCP tool
    invocation, or an HTTP trip export or PDF export (`transport` says which).

    This is intentionally distinct from :class:`AuditEvent`, whose small,
    audience-safe vocabulary records publication-link lifecycle changes.  MCP
    tools need an owner operational audit for *every* invocation, including a
    rejected one, without ever recording request bodies, uploaded bytes, or a
    share-link URL.  Ids are kept after a trip is deleted (there is no foreign
    key); the rows are purged with the other audit tables.
    """

    __tablename__ = "owner_activity_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    owner_subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    transport: Mapped[str] = mapped_column(String(16), nullable=False)
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(80), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Keep the trip identifier after the trip itself is permanently deleted.
    trip_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    result: Mapped[str] = mapped_column(String(16), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Only a stable error code/message summary belongs here.  Never persist a
    # tool payload: it can contain private notes, raw media, OAuth tokens, or
    # share capabilities.
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    @validates("transport")
    def _validate_transport(self, _key: str, value: object) -> str:
        return _code(ActivityTransport, value)

    @validates("action")
    def _validate_action(self, _key: str, value: object) -> str:
        if not isinstance(value, str) or not _ACTIVITY_ACTION.fullmatch(value):
            raise ValueError(f"Owner activity action must be a lowercase tool or operation code: {value!r}")
        return value
