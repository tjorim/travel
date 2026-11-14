"""Owner-only audit trail for publication/share-link lifecycle transitions.

Every write here is append-only and happens inside the caller's existing
transaction (via `session.flush()`, never its own `commit()`), so an audit
event and the state transition it records land together or not at all.
"""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, cast

from sqlalchemy import CursorResult, delete, select
from sqlalchemy.orm import Session

from .access import receivers
from .audience import Audience, Reach, audiences_of_trip
from .models import (
    AuditEvent,
    AuditEventKind,
    AuditTargetType,
    CollectionAuditEvent,
    CollectionAuditKind,
    OwnerActivityEvent,
    Visibility,
)

# A system-enacted transition (e.g. a link expiring on a later anonymous
# request) has no authenticated owner subject to attribute it to.
SYSTEM_ACTOR = "system"

# Retention window of all three audit tables (#36, #116, #364).
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
    occurred_at: datetime | None = None,
) -> AuditEvent:
    event = AuditEvent(
        trip_id=trip_id,
        actor_subject=actor_subject,
        kind=kind,
        target_type=target_type,
        target_id=target_id,
        details=details or {},
    )
    if occurred_at is not None:
        event.occurred_at = occurred_at
    session.add(event)
    session.flush()
    return event


def record_audience_event(
    session: Session,
    *,
    subject: str,
    audience: Audience,
    event: Literal["scope_change", "preset_apply"],
    details: dict[str, Any],
) -> None:
    """Record a change to one audience on the trail its kind writes to (see ``Audience.audit_target``)."""
    target = audience.audit_target
    kind = target.scope_change if event == "scope_change" else target.preset_apply
    if target.collection_id is not None:
        assert isinstance(kind, CollectionAuditKind)
        record_collection_event(
            session,
            owner_subject=subject,
            actor_subject=subject,
            collection_id=target.collection_id,
            trip_id=audience.trip_id,
            kind=kind,
            details={"member_id": target.target_id, **details},
        )
    else:
        assert isinstance(kind, AuditEventKind) and target.target_type is not None
        record_audit_event(
            session,
            trip_id=audience.trip_id,
            actor_subject=subject,
            kind=kind,
            target_type=target.target_type,
            target_id=target.target_id,
            details=details,
        )


def record_collection_event(
    session: Session,
    *,
    owner_subject: str,
    actor_subject: str,
    collection_id: str,
    kind: CollectionAuditKind,
    trip_id: str | None = None,
    details: dict[str, Any] | None = None,
    occurred_at: datetime | None = None,
) -> CollectionAuditEvent:
    """Append a collection audit event in the caller's transaction (ids and fingerprints only)."""
    event = CollectionAuditEvent(
        owner_subject=owner_subject,
        actor_subject=actor_subject,
        collection_id=collection_id,
        trip_id=trip_id,
        kind=kind,
        details=details or {},
    )
    if occurred_at is not None:
        event.occurred_at = occurred_at
    session.add(event)
    session.flush()
    return event


# Owner-entered free text a sharing event may carry. It goes when the trip is deleted; ids, kinds, counts and
# fingerprints stay until the event expires (decision 36).
_OWNER_TEXT_KEYS = ("label", "reason")


def scrub_trip_audit_text(session: Session, trip_id: str) -> None:
    """Drop the owner's free text (a link label, a reason) from a trip's sharing events before the trip is deleted.

    The events themselves outlive the trip, so what remains must say nothing about it. Runs in the caller's
    transaction."""
    for event in session.scalars(select(AuditEvent).where(AuditEvent.trip_id == trip_id)):
        if any(key in event.details for key in _OWNER_TEXT_KEYS):
            event.details = {key: value for key, value in event.details.items() if key not in _OWNER_TEXT_KEYS}


def purge_expired_audit_events(session: Session, *, older_than: timedelta = RETENTION_WINDOW) -> int:
    """Purge all three audit tables (sharing, collection and owner activity) with one cutoff in one transaction.

    Owner activity recording remains best effort; retention does not make
    recording atomic with domain mutations. The maintenance command uses this
    policy default, including records whose trip or collection has already been deleted.
    """
    cutoff = datetime.now(UTC) - older_than
    purged = 0
    for model in (AuditEvent, CollectionAuditEvent, OwnerActivityEvent):
        result = cast(CursorResult, session.execute(delete(model).where(model.occurred_at < cutoff)))
        purged += result.rowcount
    session.commit()
    return purged


def live_audiences(session: Session, trip_id: str) -> list[Audience]:
    """Audiences that deliver today: the published public page, active links and active collections.
    Drafts and an unpublished page deliver nothing, so changes to them are not
    recorded and need no acknowledgement."""
    return audiences_of_trip(session, trip_id, Reach.DELIVERING)


def delivering_audiences(session: Session, trip_id: str) -> list[tuple[str, dict]]:
    """Live audiences by id only (never a link label), the shape ``receivers`` takes."""
    return [(audience.id, audience.scope) for audience in live_audiences(session, trip_id)]


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
