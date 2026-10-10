"""Owner-only audit trail for publication/share-link lifecycle transitions.

Every write here is append-only and happens inside the caller's existing
transaction (via `session.flush()`, never its own `commit()`), so an audit
event and the state transition it records land together or not at all.
"""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import CursorResult, delete
from sqlalchemy.orm import Session

from .models import AuditEvent, AuditEventKind, AuditTargetType

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
