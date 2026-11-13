"""Collection links: one owner-wide capability that opens several trips.

A collection has its own token and keyed verifier and never reuses a per-trip link's. Each member is a
``(trip, scope)`` pair; the member's scope decides what that trip delivers, through the same projection code as
every other audience. ``state`` gates the whole collection, and removing a member or deleting its trip ends that
trip's page at once.

Shared by the HTTP routers and the MCP tools. Nothing here commits: a reader that finds a collection past its
``expires_at`` marks it expired in the caller's transaction, so the caller commits after every call (reads too).
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..audit import record_collection_event, scope_fingerprint
from ..capability import generate_token, verifier_for
from ..errors import Conflict, RecordNotFound, service_error
from ..exclusion_review import exclusion_changes, widening
from ..models import Collection, CollectionAuditEvent, CollectionMember, LinkState, Trip
from ..projection import ScopeError, prepare_scope, render_projection
from ..schemas import (
    AuditReasonInput,
    CollectionCreate,
    CollectionIndexDocument,
    CollectionMemberCreate,
    CollectionMembershipResponse,
    CollectionResponse,
    CollectionUpdate,
    Identifier,
    ShareLinkActivateRequest,
    ShareScopeInput,
)
from ..sharing_presets import apply_preset
from .delivery import navigation_target
from .sharing import (
    aware_utc,
    claim_member_revision,
    collection_index,
    expire_collection,
    member_response,
    refuse_unacknowledged_widening,
    trips_by_id,
)
from .trips import owned_trip

EDITABLE_STATES = (LinkState.DRAFT, LinkState.ACTIVE)
MAX_MEMBERS = 50


def _not_editable() -> Conflict:
    return Conflict(
        "A revoked or expired collection cannot be edited", code="a_revoked_or_expired_collection_cannot_be_edited"
    )


def settle_expired(session: Session, collections: list[Collection]) -> None:
    """Lazy write for owner reads: an active collection past `expires_at` is stored as expired the first time
    anyone sees it. The caller commits."""
    now = datetime.now(UTC)
    for collection in collections:
        if (
            collection.state == LinkState.ACTIVE
            and collection.expires_at is not None
            and aware_utc(collection.expires_at) <= now
        ):
            expire_collection(session, collection)


def owned_collection(session: Session, subject: str, collection_id: Identifier) -> Collection:
    collection = session.scalar(
        select(Collection).where(Collection.id == collection_id, Collection.owner_subject == subject)
    )
    if collection is None:
        raise RecordNotFound("Collection not found")
    settle_expired(session, [collection])
    return collection


def collection_response(session: Session, collection: Collection) -> CollectionResponse:
    trips = trips_by_id(session, collection)
    return CollectionResponse(
        id=collection.id,
        label=collection.label,
        title=collection.title,
        state=collection.state,
        token=collection.token,
        expires_at=collection.expires_at,
        rotations=collection.rotations,
        created_at=collection.created_at,
        updated_at=collection.updated_at,
        activated_at=collection.activated_at,
        revoked_at=collection.revoked_at,
        members=[
            member_response(member, trips[member.trip_id]) for member in collection.members if member.trip_id in trips
        ],
    )


def _scope_for(
    session: Session, subject: str, trip_id: Identifier, scope: ShareScopeInput, stored: dict | None = None
) -> tuple[Trip, dict]:
    """The member's trip and the scope to store; ``stored`` is its current scope, ``None`` for a new member."""
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    scope_dict = scope.document(stored)
    try:
        return trip, prepare_scope(trip, scope_dict, stored)
    except ScopeError as error:
        raise service_error(error) from error


def create_collection(session: Session, subject: str, payload: CollectionCreate) -> CollectionResponse:
    collection = Collection(owner_subject=subject, label=payload.label, title=payload.title, state=LinkState.DRAFT)
    session.add(collection)
    session.flush()
    record_collection_event(
        session,
        owner_subject=subject,
        actor_subject=subject,
        collection_id=collection.id,
        kind="collection.create",
        details={"label": collection.label},
    )
    return collection_response(session, collection)


def list_collection_audit_events(session: Session, subject: str) -> list[CollectionAuditEvent]:
    return list(
        session.scalars(
            select(CollectionAuditEvent)
            .where(CollectionAuditEvent.owner_subject == subject)
            .order_by(CollectionAuditEvent.occurred_at.desc())
        )
    )


def list_collections(session: Session, subject: str) -> list[CollectionResponse]:
    collections = list(
        session.scalars(
            select(Collection).where(Collection.owner_subject == subject).order_by(Collection.created_at.desc())
        )
    )
    settle_expired(session, collections)
    return [collection_response(session, collection) for collection in collections]


def get_collection(session: Session, subject: str, collection_id: Identifier) -> CollectionResponse:
    return collection_response(session, owned_collection(session, subject, collection_id))


def update_collection(
    session: Session, subject: str, collection_id: Identifier, payload: CollectionUpdate
) -> CollectionResponse:
    collection = owned_collection(session, subject, collection_id)
    if collection.state not in EDITABLE_STATES:
        raise _not_editable()
    fields = payload.model_fields_set
    if "label" in fields and payload.label is not None:
        collection.label = payload.label
    if "title" in fields:
        collection.title = payload.title
    record_collection_event(
        session,
        owner_subject=subject,
        actor_subject=subject,
        collection_id=collection.id,
        kind="collection.update",
        details={"fields": sorted(fields)},
    )
    return collection_response(session, collection)


def delete_collection(session: Session, subject: str, collection_id: Identifier) -> None:
    collection = owned_collection(session, subject, collection_id)
    if collection.state == LinkState.ACTIVE:
        raise Conflict(
            "Revoke an active collection before deleting it", code="revoke_an_active_collection_before_deleting_it"
        )
    record_collection_event(
        session,
        owner_subject=subject,
        actor_subject=subject,
        collection_id=collection.id,
        kind="collection.delete",
        details={"label": collection.label},
    )
    session.delete(collection)
    session.flush()


def owned_member(collection: Collection, member_id: Identifier) -> CollectionMember:
    member = next((item for item in collection.members if item.id == member_id), None)
    if member is None:
        raise RecordNotFound("Member not found")
    return member


def add_collection_member(
    session: Session, subject: str, collection_id: Identifier, payload: CollectionMemberCreate
) -> CollectionResponse:
    collection = owned_collection(session, subject, collection_id)
    if collection.state not in EDITABLE_STATES:
        raise _not_editable()
    trip, scope = _scope_for(session, subject, payload.trip_id, payload.scope)
    already_in = Conflict("This trip is already in the collection", code="this_trip_is_already_in_the_collection")
    if any(member.trip_id == payload.trip_id for member in collection.members):
        raise already_in
    if len(collection.members) >= MAX_MEMBERS:
        raise Conflict("A collection holds at most 50 trips", code="a_collection_holds_at_most_50_trips")
    member = CollectionMember(collection_id=collection.id, trip_id=payload.trip_id, scope=scope)
    try:
        with session.begin_nested():
            collection.members.append(member)
            session.flush()
    except IntegrityError as error:
        raise already_in from error
    record_collection_event(
        session,
        owner_subject=subject,
        actor_subject=subject,
        collection_id=collection.id,
        trip_id=payload.trip_id,
        kind="collection.member_add",
        details={"member_id": member.id, "scope_version": scope_fingerprint(scope)},
    )
    if payload.preset is not None:
        # In the same transaction, through the same code as the apply route: a new member has received nothing yet.
        apply_preset(
            session,
            trip,
            subject,
            member,
            payload.preset,
            fingerprint=None,
            confirm_widening=False,
            claim=None,
            new=True,
        )
    return collection_response(session, collection)


def set_collection_member_scope(
    session: Session,
    subject: str,
    collection_id: Identifier,
    member_id: Identifier,
    payload: ShareScopeInput,
    if_match: str | None = None,
    confirm_widening: bool = False,
) -> CollectionResponse:
    collection = owned_collection(session, subject, collection_id)
    if collection.state not in EDITABLE_STATES:
        raise _not_editable()
    member = owned_member(collection, member_id)
    trip, scope = _scope_for(session, subject, member.trip_id, payload, member.scope)
    live = collection.state == LinkState.ACTIVE
    # Before the revision is claimed: a refused widening changes nothing, not even the revision.
    refuse_unacknowledged_widening(trip, member.scope, scope, live=live, confirmed=confirm_widening)
    claim_member_revision(session, member, if_match)
    previous = member.scope
    before = scope_fingerprint(previous)
    member.scope = scope
    after = scope_fingerprint(scope)
    # A draft collection delivers nothing yet; its activation records the scopes.
    if live and before != after:
        details: dict = {"member_id": member.id, "scope_version_before": before, "scope_version_after": after}
        if changes := exclusion_changes(previous, scope):
            details["exclusions"] = {**changes, "widened": widening(trip, previous, scope).counts}
        record_collection_event(
            session,
            owner_subject=subject,
            actor_subject=subject,
            collection_id=collection.id,
            trip_id=member.trip_id,
            kind="collection.member_scope_change",
            details=details,
        )
    session.flush()
    return collection_response(session, collection)


def remove_collection_member(
    session: Session, subject: str, collection_id: Identifier, member_id: Identifier
) -> CollectionResponse:
    collection = owned_collection(session, subject, collection_id)
    if collection.state not in EDITABLE_STATES:
        raise _not_editable()
    member = owned_member(collection, member_id)
    record_collection_event(
        session,
        owner_subject=subject,
        actor_subject=subject,
        collection_id=collection.id,
        trip_id=member.trip_id,
        kind="collection.member_remove",
        details={"member_id": member.id, "scope_version": scope_fingerprint(member.scope)},
    )
    collection.members.remove(member)
    session.flush()
    return collection_response(session, collection)


def member_preview(
    session: Session,
    subject: str,
    collection_id: Identifier,
    member_id: Identifier,
    candidate: ShareScopeInput | None = None,
) -> tuple[Trip, dict]:
    """The member's trip and the scope a preview renders: a validated unsaved candidate, else the saved one.

    Nothing is stored and no audit event is recorded."""
    member = owned_member(owned_collection(session, subject, collection_id), member_id)
    if candidate is not None:
        return _scope_for(session, subject, member.trip_id, candidate, member.scope)
    return owned_trip(session, member.trip_id, subject, load_relations=True), member.scope


def preview_collection_member(
    session: Session,
    subject: str,
    collection_id: Identifier,
    member_id: Identifier,
    candidate: ShareScopeInput | None = None,
) -> dict:
    trip, scope = member_preview(session, subject, collection_id, member_id, candidate)
    return render_projection(trip, scope, "travel/unlisted-trip@1")


def member_preview_navigation(
    session: Session,
    subject: str,
    collection_id: Identifier,
    member_id: Identifier,
    local_id: str,
    candidate: ShareScopeInput | None = None,
) -> str:
    trip, scope = member_preview(session, subject, collection_id, member_id, candidate)
    return navigation_target(trip, scope, local_id)


def preview_collection_index(session: Session, subject: str, collection_id: Identifier) -> CollectionIndexDocument:
    """The index exactly as a visitor of this collection would receive it."""
    return collection_index(session, owned_collection(session, subject, collection_id))


def _activate(collection: Collection, expires_in_days: int | None) -> None:
    token = generate_token()
    now = datetime.now(UTC)
    collection.token = token
    collection.token_verifier = verifier_for(token)
    collection.expires_at = now + timedelta(days=expires_in_days) if expires_in_days is not None else None
    collection.state = LinkState.ACTIVE
    collection.activated_at = now


def _member_fingerprint(collection: Collection) -> str:
    return scope_fingerprint({member.id: member.scope for member in collection.members})


def activate_collection(
    session: Session, subject: str, collection_id: Identifier, payload: ShareLinkActivateRequest
) -> CollectionResponse:
    collection = owned_collection(session, subject, collection_id)
    if collection.state != LinkState.DRAFT:
        raise Conflict("Only a draft collection can be activated", code="only_a_draft_collection_can_be_activated")
    _activate(collection, payload.expires_in_days)
    details: dict = {
        "members": len(collection.members),
        "scope_version": _member_fingerprint(collection),
        "expires_at": collection.expires_at.isoformat() if collection.expires_at else None,
    }
    if payload.reason:
        details["reason"] = payload.reason
    record_collection_event(
        session,
        owner_subject=subject,
        actor_subject=subject,
        collection_id=collection.id,
        kind="collection.activate",
        details=details,
    )
    return collection_response(session, collection)


def revoke_collection(
    session: Session, subject: str, collection_id: Identifier, payload: AuditReasonInput | None = None
) -> CollectionResponse:
    collection = owned_collection(session, subject, collection_id)
    if collection.state != LinkState.ACTIVE:
        raise Conflict("Only an active collection can be revoked", code="only_an_active_collection_can_be_revoked")
    collection.state = LinkState.REVOKED
    collection.token = None
    collection.revoked_at = datetime.now(UTC)
    details: dict = {}
    if payload is not None and payload.reason:
        details["reason"] = payload.reason
    record_collection_event(
        session,
        owner_subject=subject,
        actor_subject=subject,
        collection_id=collection.id,
        kind="collection.revoke",
        details=details,
    )
    return collection_response(session, collection)


def rotate_collection(
    session: Session, subject: str, collection_id: Identifier, payload: ShareLinkActivateRequest
) -> CollectionResponse:
    """Replace the capability in place: the old token stops working, members and scopes stay."""
    collection = owned_collection(session, subject, collection_id)
    if collection.state != LinkState.ACTIVE:
        raise Conflict("Only an active collection can be rotated", code="only_an_active_collection_can_be_rotated")
    _activate(collection, payload.expires_in_days)
    collection.rotations += 1
    details: dict = {
        "rotation": collection.rotations,
        "scope_version": _member_fingerprint(collection),
        "expires_at": collection.expires_at.isoformat() if collection.expires_at else None,
    }
    if payload.reason:
        details["reason"] = payload.reason
    record_collection_event(
        session,
        owner_subject=subject,
        actor_subject=subject,
        collection_id=collection.id,
        kind="collection.rotate",
        details=details,
    )
    return collection_response(session, collection)


def list_trip_collections(session: Session, subject: str, trip_id: Identifier) -> list[CollectionMembershipResponse]:
    """Which collections reach this trip, so the owner sees every way it can be opened."""
    owned_trip(session, trip_id, subject)
    rows = session.execute(
        select(CollectionMember, Collection)
        .join(Collection, Collection.id == CollectionMember.collection_id)
        .where(CollectionMember.trip_id == trip_id, Collection.owner_subject == subject)
        .order_by(Collection.created_at.desc())
    ).all()
    settle_expired(session, [collection for _, collection in rows])
    return [
        CollectionMembershipResponse(
            collection_id=collection.id,
            member_id=member.id,
            label=collection.label,
            state=collection.state,
            expires_at=collection.expires_at,
        )
        for member, collection in rows
    ]
