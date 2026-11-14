"""Collection links: one owner-wide capability that opens several trips.

A collection has its own token and keyed verifier and never reuses a per-trip link's. Each member is a
``(trip, scope)`` pair; the member's scope decides what that trip delivers, through the same projection code as
every other audience. ``state`` gates the whole collection, and removing a member or deleting its trip ends that
trip's page at once.

Shared by the HTTP routers and the MCP tools. Nothing here commits: a reader that finds a collection past its
``expires_at`` marks it expired in the caller's transaction, so the caller commits after every call (reads too).
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..audience import MemberAudience
from ..audit import record_collection_event, scope_fingerprint
from ..errors import Conflict
from ..models import Collection, CollectionAuditEvent, CollectionAuditKind, CollectionMember, LinkState, Trip
from ..schemas import (
    AuditReasonInput,
    CollectionCreate,
    CollectionIndexDocument,
    CollectionMemberCreate,
    CollectionMembershipResponse,
    CollectionResponse,
    CollectionUpdate,
    FutureDisclosure,
    Identifier,
    ShareLinkActivateRequest,
    ShareScopeInput,
)
from ..sharing_presets import apply_preset
from . import audiences
from .audiences import owned_collection, require_collection_editable
from .sharing import collection_index, member_response, mint_capability, settle_expired, trips_by_id
from .trips import owned_trip

MAX_MEMBERS = 50


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


def create_collection(session: Session, subject: str, payload: CollectionCreate) -> CollectionResponse:
    collection = Collection(owner_subject=subject, label=payload.label, title=payload.title, state=LinkState.DRAFT)
    session.add(collection)
    session.flush()
    record_collection_event(
        session,
        owner_subject=subject,
        actor_subject=subject,
        collection_id=collection.id,
        kind=CollectionAuditKind.CREATE,
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
    require_collection_editable(collection)
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
        kind=CollectionAuditKind.UPDATE,
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
        kind=CollectionAuditKind.DELETE,
        details={"label": collection.label},
    )
    session.delete(collection)
    session.flush()


def add_collection_member(
    session: Session, subject: str, collection_id: Identifier, payload: CollectionMemberCreate
) -> CollectionResponse:
    collection = owned_collection(session, subject, collection_id)
    require_collection_editable(collection)
    trip = owned_trip(session, payload.trip_id, subject, load_relations=True)
    scope = audiences.new_scope(trip, payload.scope, None, can_exclude=True)
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
        kind=CollectionAuditKind.MEMBER_ADD,
        details={"member_id": member.id, "scope_version": scope_fingerprint(scope)},
    )
    if payload.preset is not None:
        # In the same transaction, through the same code as the apply route: a new member has received nothing yet.
        apply_preset(
            session,
            trip,
            subject,
            MemberAudience(member, collection),
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
    require_collection_editable(collection)
    audience = audiences.member_of(collection, member_id)
    trip = owned_trip(session, audience.trip_id, subject, load_relations=True)
    audiences.edit_scope(
        session, subject, audience, trip, payload, if_match=if_match, confirm_widening=confirm_widening
    )
    session.flush()
    return collection_response(session, collection)


def remove_collection_member(
    session: Session, subject: str, collection_id: Identifier, member_id: Identifier
) -> CollectionResponse:
    collection = owned_collection(session, subject, collection_id)
    require_collection_editable(collection)
    member = audiences.member_of(collection, member_id).member
    record_collection_event(
        session,
        owner_subject=subject,
        actor_subject=subject,
        collection_id=collection.id,
        trip_id=member.trip_id,
        kind=CollectionAuditKind.MEMBER_REMOVE,
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
    return audiences.preview_scope(
        session, subject, audiences.owned_member(session, subject, collection_id, member_id), candidate
    )


def preview_collection_member(
    session: Session,
    subject: str,
    collection_id: Identifier,
    member_id: Identifier,
    candidate: ShareScopeInput | None = None,
) -> dict:
    return audiences.preview_document(
        session, subject, audiences.owned_member(session, subject, collection_id, member_id), candidate
    )


def review_member_future(
    session: Session,
    subject: str,
    collection_id: Identifier,
    member_id: Identifier,
    candidate: ShareScopeInput | None = None,
) -> FutureDisclosure:
    """What a member's candidate scope would show of a trip that has not started yet. Stores nothing.

    The same review as a hidden link has (decision 360, #426)."""
    return audiences.review_future(
        session, subject, audiences.owned_member(session, subject, collection_id, member_id), candidate
    )


def member_preview_navigation(
    session: Session,
    subject: str,
    collection_id: Identifier,
    member_id: Identifier,
    local_id: str,
    candidate: ShareScopeInput | None = None,
) -> str:
    return audiences.preview_navigation_target(
        session, subject, audiences.owned_member(session, subject, collection_id, member_id), local_id, candidate
    )


def preview_collection_index(session: Session, subject: str, collection_id: Identifier) -> CollectionIndexDocument:
    """The index exactly as a visitor of this collection would receive it."""
    return collection_index(session, owned_collection(session, subject, collection_id))


def _member_fingerprint(collection: Collection) -> str:
    return scope_fingerprint({member.id: member.scope for member in collection.members})


def activate_collection(
    session: Session, subject: str, collection_id: Identifier, payload: ShareLinkActivateRequest
) -> CollectionResponse:
    collection = owned_collection(session, subject, collection_id)
    if collection.state != LinkState.DRAFT:
        raise Conflict("Only a draft collection can be activated", code="only_a_draft_collection_can_be_activated")
    mint_capability(collection, payload.expires_in_days)
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
        kind=CollectionAuditKind.ACTIVATE,
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
        kind=CollectionAuditKind.REVOKE,
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
    mint_capability(collection, payload.expires_in_days)
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
        kind=CollectionAuditKind.ROTATE,
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
