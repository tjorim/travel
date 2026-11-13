"""Collection links: one owner-wide capability that opens several trips.

A collection has its own token and keyed verifier and never reuses a per-trip
link's. Each member is a ``(trip, scope)`` pair; the member's scope decides what
that trip delivers, through the same projection code as every other audience.
``state`` gates the whole collection, and removing a member or deleting its trip
ends that trip's page at once.
"""

import re
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..audit import SYSTEM_ACTOR, record_collection_event, scope_fingerprint
from ..auth import current_subject
from ..capability import generate_token, verifier_for
from ..database import get_session
from ..errors import ApiException, service_exception
from ..exclusion_review import exclusion_changes, scope_exclusions, widening
from ..models import Collection, CollectionAuditEvent, CollectionMember, LinkState, Trip
from ..projection import ScopeError, delivered, prepare_scope, render_projection, scoped_navigation_url
from ..ratelimit import shared_delivery_limit
from ..schemas import (
    AuditReasonInput,
    CollectionAuditEventResponse,
    CollectionCreate,
    CollectionIndexDocument,
    CollectionIndexEntry,
    CollectionMemberCreate,
    CollectionMemberResponse,
    CollectionMembershipResponse,
    CollectionResponse,
    CollectionUpdate,
    ExclusionWideningConflict,
    Identifier,
    ProjectionDocument,
    SafeText,
    ShareLinkActivateRequest,
    ShareScopeInput,
)
from ..sharing_presets import apply_preset, exceptions_of
from ..storage import ObjectStorage, get_storage
from .publication import (
    UNLISTED_HEADERS,
    _file_response,
    _preview_navigation,
    _reject_malformed_token,
    aware_utc,
    delivery_router,
    refuse_unacknowledged_widening,
)
from .trips import owned_trip, trip_query

router = APIRouter(prefix="/collections", tags=["collections"])
membership_router = APIRouter(prefix="/trips/{trip_id}", tags=["collections"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
StorageDep = Annotated[ObjectStorage, Depends(get_storage)]

EDITABLE_STATES = (LinkState.DRAFT, LinkState.ACTIVE)
MAX_MEMBERS = 50


def _not_found() -> ApiException:
    return ApiException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found", code="not_found")


# --- Owner -----------------------------------------------------------------------


def _expire(session: Session, collection: Collection) -> None:
    """Persist active -> expired, stamping the audit event with the real expiry time."""
    collection.state = LinkState.EXPIRED
    record_collection_event(
        session,
        owner_subject=collection.owner_subject,
        actor_subject=SYSTEM_ACTOR,
        collection_id=collection.id,
        kind="collection.expire",
        occurred_at=collection.expires_at,
    )
    session.commit()


def _settle_expired(session: Session, collections: list[Collection]) -> None:
    now = datetime.now(UTC)
    for collection in collections:
        if (
            collection.state == LinkState.ACTIVE
            and collection.expires_at is not None
            and aware_utc(collection.expires_at) <= now
        ):
            _expire(session, collection)


def owned_collection(session: Session, subject: str, collection_id: Identifier) -> Collection:
    collection = session.scalar(
        select(Collection).where(Collection.id == collection_id, Collection.owner_subject == subject)
    )
    if collection is None:
        raise _not_found()
    _settle_expired(session, [collection])
    return collection


def _trips_by_id(session: Session, collection: Collection) -> dict[str, Trip]:
    ids = [member.trip_id for member in collection.members]
    if not ids:
        return {}
    return {trip.id: trip for trip in session.scalars(trip_query().where(Trip.id.in_(ids)))}


def _member_response(member: CollectionMember, trip: Trip) -> CollectionMemberResponse:
    return CollectionMemberResponse(
        revision=member.revision,
        id=member.id,
        trip_id=member.trip_id,
        trip_title=trip.title,
        scope=member.scope,
        delivered_records=sum(len(records) for records in delivered(trip, member.scope).values()),
        exclusions=scope_exclusions(trip, member.scope),
        applied_preset=member.applied_preset,
        applied_preset_at=member.applied_preset_at,
        preset_exceptions=exceptions_of(trip, member),
        created_at=member.created_at,
        updated_at=member.updated_at,
    )


def collection_response(session: Session, collection: Collection) -> CollectionResponse:
    trips = _trips_by_id(session, collection)
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
            _member_response(member, trips[member.trip_id]) for member in collection.members if member.trip_id in trips
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
        raise service_exception(status.HTTP_422_UNPROCESSABLE_CONTENT, error) from error


@router.post("", response_model=CollectionResponse, status_code=status.HTTP_201_CREATED)
def create_collection(payload: CollectionCreate, session: SessionDep, subject: SubjectDep) -> CollectionResponse:
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
    session.commit()
    return collection_response(session, collection)


@router.get("/audit-events", response_model=list[CollectionAuditEventResponse])
def list_collection_audit_events(session: SessionDep, subject: SubjectDep) -> list[CollectionAuditEvent]:
    return list(
        session.scalars(
            select(CollectionAuditEvent)
            .where(CollectionAuditEvent.owner_subject == subject)
            .order_by(CollectionAuditEvent.occurred_at.desc())
        )
    )


@router.get("", response_model=list[CollectionResponse])
def list_collections(session: SessionDep, subject: SubjectDep) -> list[CollectionResponse]:
    collections = list(
        session.scalars(
            select(Collection).where(Collection.owner_subject == subject).order_by(Collection.created_at.desc())
        )
    )
    _settle_expired(session, collections)
    return [collection_response(session, collection) for collection in collections]


@router.get("/{collection_id}", response_model=CollectionResponse)
def get_collection(collection_id: Identifier, session: SessionDep, subject: SubjectDep) -> CollectionResponse:
    return collection_response(session, owned_collection(session, subject, collection_id))


@router.patch("/{collection_id}", response_model=CollectionResponse)
def update_collection(
    collection_id: Identifier, payload: CollectionUpdate, session: SessionDep, subject: SubjectDep
) -> CollectionResponse:
    collection = owned_collection(session, subject, collection_id)
    if collection.state not in EDITABLE_STATES:
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A revoked or expired collection cannot be edited",
            code="a_revoked_or_expired_collection_cannot_be_edited",
        )
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
    session.commit()
    return collection_response(session, collection)


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_collection(collection_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    collection = owned_collection(session, subject, collection_id)
    if collection.state == LinkState.ACTIVE:
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Revoke an active collection before deleting it",
            code="revoke_an_active_collection_before_deleting_it",
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
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _owned_member(session: Session, collection: Collection, member_id: Identifier) -> CollectionMember:
    member = next((item for item in collection.members if item.id == member_id), None)
    if member is None:
        raise ApiException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found", code="not_found")
    return member


def _claim_member_revision(session: Session, member: CollectionMember, expected: str | None) -> None:
    statement = update(CollectionMember).where(CollectionMember.id == member.id)
    if expected is not None:
        if not re.fullmatch(r'"[0-9]+"', expected):
            raise ApiException(status_code=400, detail="Invalid revision", code="invalid_revision")
        statement = statement.where(CollectionMember.revision == int(expected[1:-1]))
    result = session.execute(
        statement.values(revision=CollectionMember.revision + 1)
        .returning(CollectionMember.revision)
        .execution_options(synchronize_session=False)
    )
    if result.scalar_one_or_none() is None:
        session.rollback()
        session.refresh(member)
        trip = session.scalar(trip_query().where(Trip.id == member.trip_id))
        current = _member_response(member, trip) if trip is not None else None
        raise ApiException(
            code="scope_revision_conflict",
            status_code=412,
            detail={
                "code": "scope_revision_conflict",
                "current": current.model_dump(mode="json") if current is not None else None,
            },
        )
    session.refresh(member)


@router.post("/{collection_id}/members", response_model=CollectionResponse, status_code=status.HTTP_201_CREATED)
def add_collection_member(
    collection_id: Identifier, payload: CollectionMemberCreate, session: SessionDep, subject: SubjectDep
) -> CollectionResponse:
    collection = owned_collection(session, subject, collection_id)
    if collection.state not in EDITABLE_STATES:
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A revoked or expired collection cannot be edited",
            code="a_revoked_or_expired_collection_cannot_be_edited",
        )
    trip, scope = _scope_for(session, subject, payload.trip_id, payload.scope)
    if any(member.trip_id == payload.trip_id for member in collection.members):
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This trip is already in the collection",
            code="this_trip_is_already_in_the_collection",
        )
    if len(collection.members) >= MAX_MEMBERS:
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A collection holds at most 50 trips",
            code="a_collection_holds_at_most_50_trips",
        )
    member = CollectionMember(collection_id=collection.id, trip_id=payload.trip_id, scope=scope)
    try:
        with session.begin_nested():
            collection.members.append(member)
            session.flush()
    except IntegrityError as error:
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This trip is already in the collection",
            code="this_trip_is_already_in_the_collection",
        ) from error
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
    session.commit()
    return collection_response(session, collection)


@router.put(
    "/{collection_id}/members/{member_id}",
    response_model=CollectionResponse,
    responses={409: {"model": ExclusionWideningConflict, "description": "A live audience would newly show records."}},
)
def set_collection_member_scope(
    collection_id: Identifier,
    member_id: Identifier,
    payload: ShareScopeInput,
    session: SessionDep,
    subject: SubjectDep,
    if_match: Annotated[str | None, Header()] = None,
    confirm_widening: Annotated[
        bool,
        Query(
            description="Accept that removing exclusions from an active collection shows its visitors records they "
            "did not receive. Without it such a change is refused with 409 exclusion_widening_needs_acknowledgement, "
            "which lists the records, and nothing changes. Not stored."
        ),
    ] = False,
) -> CollectionResponse:
    collection = owned_collection(session, subject, collection_id)
    if collection.state not in EDITABLE_STATES:
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A revoked or expired collection cannot be edited",
            code="a_revoked_or_expired_collection_cannot_be_edited",
        )
    member = _owned_member(session, collection, member_id)
    trip, scope = _scope_for(session, subject, member.trip_id, payload, member.scope)
    live = collection.state == LinkState.ACTIVE
    # Before the revision is claimed: a refused widening changes nothing, not even the revision.
    refuse_unacknowledged_widening(trip, member.scope, scope, live=live, confirmed=confirm_widening)
    _claim_member_revision(session, member, if_match)
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
    session.commit()
    return collection_response(session, collection)


@router.delete("/{collection_id}/members/{member_id}", response_model=CollectionResponse)
def remove_collection_member(
    collection_id: Identifier, member_id: Identifier, session: SessionDep, subject: SubjectDep
) -> CollectionResponse:
    collection = owned_collection(session, subject, collection_id)
    if collection.state not in EDITABLE_STATES:
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A revoked or expired collection cannot be edited",
            code="a_revoked_or_expired_collection_cannot_be_edited",
        )
    member = _owned_member(session, collection, member_id)
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
    session.commit()
    return collection_response(session, collection)


def _member_preview_scope(
    session: Session, subject: str, member: CollectionMember, candidate: ShareScopeInput | None
) -> tuple[Trip, dict]:
    """The member's trip and the scope a preview renders: a validated unsaved candidate, else the saved one.

    Nothing is stored and no audit event is recorded."""
    if candidate is not None:
        return _scope_for(session, subject, member.trip_id, candidate, member.scope)
    return owned_trip(session, member.trip_id, subject, load_relations=True), member.scope


@router.post("/{collection_id}/members/{member_id}/preview", response_model=ProjectionDocument)
def preview_collection_member(
    collection_id: Identifier,
    member_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    response: Response,
    payload: ShareScopeInput | None = None,
) -> dict:
    member = _owned_member(session, owned_collection(session, subject, collection_id), member_id)
    trip, scope = _member_preview_scope(session, subject, member, payload)
    response.headers["Cache-Control"] = "no-store"
    return render_projection(trip, scope, "travel/unlisted-trip@1")


@router.post("/{collection_id}/members/{member_id}/preview/files/{local_id}")
def preview_collection_member_file(
    collection_id: Identifier,
    member_id: Identifier,
    local_id: SafeText,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    request: Request,
    payload: ShareScopeInput | None = None,
) -> Response:
    member = _owned_member(session, owned_collection(session, subject, collection_id), member_id)
    trip, scope = _member_preview_scope(session, subject, member, payload)
    return _file_response(trip, scope, local_id, storage, UNLISTED_HEADERS, request)


@router.get("/{collection_id}/members/{member_id}/preview/files/{local_id}")
def preview_collection_member_saved_file(
    collection_id: Identifier,
    member_id: Identifier,
    local_id: SafeText,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    request: Request,
) -> Response:
    return preview_collection_member_file(collection_id, member_id, local_id, session, subject, storage, request, None)


@router.post("/{collection_id}/members/{member_id}/preview/navigation/{local_id}")
def preview_collection_member_navigation(
    collection_id: Identifier,
    member_id: Identifier,
    local_id: SafeText,
    session: SessionDep,
    subject: SubjectDep,
    payload: ShareScopeInput | None = None,
) -> JSONResponse:
    member = _owned_member(session, owned_collection(session, subject, collection_id), member_id)
    trip, scope = _member_preview_scope(session, subject, member, payload)
    return _preview_navigation(trip, scope, local_id)


@router.get("/{collection_id}/members/{member_id}/preview/navigation/{local_id}")
def preview_collection_member_saved_navigation(
    collection_id: Identifier, member_id: Identifier, local_id: SafeText, session: SessionDep, subject: SubjectDep
) -> JSONResponse:
    return preview_collection_member_navigation(collection_id, member_id, local_id, session, subject, None)


@router.get("/{collection_id}/preview", response_model=CollectionIndexDocument)
def preview_collection_index(
    collection_id: Identifier, session: SessionDep, subject: SubjectDep, response: Response
) -> CollectionIndexDocument:
    """The index exactly as a visitor of this collection would receive it."""
    response.headers["Cache-Control"] = "no-store"
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


@router.post("/{collection_id}/activate", response_model=CollectionResponse)
def activate_collection(
    collection_id: Identifier, payload: ShareLinkActivateRequest, session: SessionDep, subject: SubjectDep
) -> CollectionResponse:
    collection = owned_collection(session, subject, collection_id)
    if collection.state != LinkState.DRAFT:
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only a draft collection can be activated",
            code="only_a_draft_collection_can_be_activated",
        )
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
    session.commit()
    return collection_response(session, collection)


@router.post("/{collection_id}/revoke", response_model=CollectionResponse)
def revoke_collection(
    collection_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    payload: AuditReasonInput = AuditReasonInput(),
) -> CollectionResponse:
    collection = owned_collection(session, subject, collection_id)
    if collection.state != LinkState.ACTIVE:
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only an active collection can be revoked",
            code="only_an_active_collection_can_be_revoked",
        )
    collection.state = LinkState.REVOKED
    collection.token = None
    collection.revoked_at = datetime.now(UTC)
    details: dict = {}
    if payload.reason:
        details["reason"] = payload.reason
    record_collection_event(
        session,
        owner_subject=subject,
        actor_subject=subject,
        collection_id=collection.id,
        kind="collection.revoke",
        details=details,
    )
    session.commit()
    return collection_response(session, collection)


@router.post("/{collection_id}/rotate", response_model=CollectionResponse)
def rotate_collection(
    collection_id: Identifier, payload: ShareLinkActivateRequest, session: SessionDep, subject: SubjectDep
) -> CollectionResponse:
    """Replace the capability in place: the old token stops working, members and scopes stay."""
    collection = owned_collection(session, subject, collection_id)
    if collection.state != LinkState.ACTIVE:
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only an active collection can be rotated",
            code="only_an_active_collection_can_be_rotated",
        )
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
    session.commit()
    return collection_response(session, collection)


@membership_router.get("/collections", response_model=list[CollectionMembershipResponse])
def list_trip_collections(
    trip_id: Identifier, session: SessionDep, subject: SubjectDep
) -> list[CollectionMembershipResponse]:
    """Which collections reach this trip, so the owner sees every way it can be opened."""
    owned_trip(session, trip_id, subject)
    rows = session.execute(
        select(CollectionMember, Collection)
        .join(Collection, Collection.id == CollectionMember.collection_id)
        .where(CollectionMember.trip_id == trip_id, Collection.owner_subject == subject)
        .order_by(Collection.created_at.desc())
    ).all()
    _settle_expired(session, [collection for _, collection in rows])
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


# --- Anonymous delivery ----------------------------------------------------------


def active_collection(session: Session, token: str) -> Collection | None:
    """The collection this token opens right now, or nothing (unknown, draft, revoked, expired)."""
    collection = session.scalar(select(Collection).where(Collection.token_verifier == verifier_for(token)))
    if collection is None or collection.state != LinkState.ACTIVE:
        return None
    if collection.expires_at is not None and aware_utc(collection.expires_at) <= datetime.now(UTC):
        _expire(session, collection)
        return None
    return collection


def collection_index(session: Session, collection: Collection) -> CollectionIndexDocument:
    """The members as the audience sees them: each entry is built from its own projection, so it
    can show nothing the member's trip page would not."""
    trips = _trips_by_id(session, collection)
    entries = []
    for member in collection.members:
        trip = trips.get(member.trip_id)
        if trip is None:
            continue
        projection = render_projection(trip, member.scope, "travel/unlisted-trip@1")
        entries.append(
            CollectionIndexEntry(
                id=member.id,
                title=projection["title"],
                summary_text=projection["summary_text"],
                dates=projection["dates"],
                cover=projection["cover"],
            )
        )
    return CollectionIndexDocument(title=collection.title, trips=entries)


def _member_of_active_collection(
    session: Session, token: str, member_id: str, not_found: ApiException
) -> tuple[Trip, CollectionMember]:
    collection = active_collection(session, token)
    if collection is None:
        raise not_found
    member = next((item for item in collection.members if item.id == member_id), None)
    trip = session.scalar(trip_query().where(Trip.id == member.trip_id)) if member is not None else None
    if member is None or trip is None:
        raise not_found
    return trip, member


@delivery_router.get(
    "/shared/{token}/trips/{member_id}",
    response_model=ProjectionDocument,
    dependencies=[Depends(shared_delivery_limit)],
)
def get_shared_collection_trip(
    request: Request, token: str, member_id: str, session: SessionDep, response: Response
) -> dict:
    not_found = ApiException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Link not found", headers=UNLISTED_HEADERS, code="not_found"
    )
    _reject_malformed_token(request, not_found)
    trip, member = _member_of_active_collection(session, token, member_id, not_found)
    for header, value in UNLISTED_HEADERS.items():
        response.headers[header] = value
    return render_projection(trip, member.scope, "travel/unlisted-trip@1")


@delivery_router.get(
    "/shared/{token}/trips/{member_id}/navigation/{local_id}",
    status_code=status.HTTP_302_FOUND,
    dependencies=[Depends(shared_delivery_limit)],
)
def get_shared_collection_navigation(
    request: Request, token: str, member_id: str, local_id: str, session: SessionDep
) -> RedirectResponse:
    not_found = ApiException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Link not found", headers=UNLISTED_HEADERS, code="not_found"
    )
    _reject_malformed_token(request, not_found)
    trip, member = _member_of_active_collection(session, token, member_id, not_found)
    target = scoped_navigation_url(trip, member.scope, local_id)
    if target is None:
        raise ApiException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Navigation target not found",
            headers=UNLISTED_HEADERS,
            code="not_found",
        )
    return RedirectResponse(target, status_code=status.HTTP_302_FOUND, headers=UNLISTED_HEADERS)


@delivery_router.get(
    "/shared/{token}/trips/{member_id}/files/{local_id}", dependencies=[Depends(shared_delivery_limit)]
)
def get_shared_collection_file(
    request: Request, token: str, member_id: str, local_id: str, session: SessionDep, storage: StorageDep
) -> Response:
    not_found = ApiException(
        status_code=status.HTTP_404_NOT_FOUND, detail="File not found", headers=UNLISTED_HEADERS, code="not_found"
    )
    _reject_malformed_token(request, not_found)
    trip, member = _member_of_active_collection(session, token, member_id, not_found)
    return _file_response(trip, member.scope, local_id, storage, UNLISTED_HEADERS, request)
