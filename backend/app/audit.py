"""Owner-only audit trail for publication/share-link lifecycle transitions.

Every write here is append-only and happens inside the caller's existing
transaction (via `session.flush()`, never its own `commit()`), so an audit
event and the state transition it records land together or not at all.
"""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import CursorResult, delete, select
from sqlalchemy.orm import Session

from .access import receivers
from .models import (
    AuditEvent,
    AuditEventKind,
    AuditTargetType,
    LinkState,
    PublicSurface,
    ShareLink,
    SurfaceState,
    Visibility,
)

# A system-enacted transition (e.g. a link expiring on a later anonymous
# request) has no authenticated owner subject to attribute it to.
SYSTEM_ACTOR = "system"

# The sharing policy's audit retention window (#36).
RETENTION_WINDOW = timedelta(days=730)


def scope_fingerprint(scope: dict) -> str:
    """A short, stable fingerprint of a scope so an audit event can record
    "the scope active at this transition" without duplicating its contents."""
    canonical = json.dumps(scope, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


def record_audit_event(
    session: Session,
    *,
    trip_id: str,
    actor_subject: str,
    kind: AuditEventKind,
    target_type: AuditTargetType,
    target_id: str,
    details: dict[str, Any] | None = None,
) -> AuditEvent:
    event = AuditEvent(
        trip_id=trip_id,
        actor_subject=actor_subject,
        kind=kind,
        target_type=target_type,
        target_id=target_id,
        details=details or {},
    )
    session.add(event)
    session.flush()
    return event


def purge_expired_audit_events(session: Session, *, older_than: timedelta = RETENTION_WINDOW) -> int:
    """Hard-delete audit events past the retention window. Pure application
    code with no scheduler wiring: v1 runs it manually or from a one-off
    script, per the issue's documented-manual-process allowance; recurring
    VPS scheduling is out of scope here (see tjorim/apps for that job, as
    with `purge_deleted_media`'s own schedule)."""
    cutoff = datetime.now(UTC) - older_than
    result = cast(CursorResult, session.execute(delete(AuditEvent).where(AuditEvent.occurred_at < cutoff)))
    session.commit()
    return result.rowcount


PUBLIC_AUDIENCE = "public"


def delivering_audiences(session: Session, trip_id: str) -> list[tuple[str, dict]]:
    """Audiences that deliver today, by id only (never a link label): the
    published public page and active links. Drafts and an unpublished page
    deliver nothing, so changes to them are not recorded."""
    audiences: list[tuple[str, dict]] = []
    surface = session.get(PublicSurface, trip_id)
    if surface is not None and surface.state == SurfaceState.PUBLISHED:
        audiences.append((PUBLIC_AUDIENCE, surface.scope))
    for link in session.scalars(
        select(ShareLink).where(ShareLink.trip_id == trip_id, ShareLink.state == LinkState.ACTIVE)
    ):
        audiences.append((f"link:{link.id}", link.scope))
    return audiences


def record_visibility_change(
    session: Session,
    *,
    trip_id: str,
    actor_subject: str,
    kind: str,
    record: Any,
    before: Visibility,
    before_receivers: set[str],
) -> None:
    """Record a change to or from `everyone`/`custom`; call after applying it."""
    after = record.visibility
    if before == after:
        return
    now_reached = receivers(kind, record, delivering_audiences(session, trip_id))
    record_audit_event(
        session,
        trip_id=trip_id,
        actor_subject=actor_subject,
        kind=AuditEventKind.VISIBILITY_CHANGE,
        target_type=AuditTargetType.RECORD,
        target_id=record.id,
        details={
            "record_kind": kind,
            "from": before.value,
            "to": after.value,
            "newly_reached": sorted(now_reached - before_receivers),
            "no_longer_reached": sorted(before_receivers - now_reached),
        },
    )
