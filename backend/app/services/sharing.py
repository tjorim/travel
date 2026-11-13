"""Audiences of a trip: public view, named links and collection members.

Shared by the owner routers, the preset service and the MCP tools. A write that loses its revision race rolls
the transaction back, so the caller sees the winner's state in the conflict it receives. Nothing here commits:
the caller owns the transaction, including the lazy expiry write of a link or collection a reader found past its
``expires_at``.
"""

import re
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..audit import SYSTEM_ACTOR, record_collection_event, scope_fingerprint
from ..capability import verifier_for
from ..errors import Conflict, InvalidRevision, RevisionConflict
from ..exclusion_review import exclusion_changes, scope_exclusions, widening
from ..models import Collection, CollectionMember, LinkState, PublicSurface, ShareLink, Trip
from ..projection import delivered, render_projection
from ..schemas import (
    CollectionIndexDocument,
    CollectionIndexEntry,
    CollectionMemberResponse,
    Identifier,
    PublicProjectionStatusResponse,
    ShareLinkActivateResponse,
    ShareLinkResponse,
)
from ..sharing_presets import exceptions_of
from .trips import trip_query

# Set on the session when a read recorded an expiry (see ``expire_collection`` and ``services.publication``): the
# caller commits before it answers, and ``http_delivery.persist_lazy_expiry`` does so for the routers.
LAZY_EXPIRY = "lazy_expiry"


def aware_utc(value: datetime) -> datetime:
    # SQLite (used in tests) drops tzinfo on round-trip even for a
    # DateTime(timezone=True) column; Postgres (production) preserves it.
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def get_or_create_surface(session: Session, trip_id: Identifier) -> PublicSurface:
    surface = session.get(PublicSurface, trip_id)
    if surface is None:
        try:
            with session.begin_nested():
                # A new public view reads dates by month until the owner chooses otherwise.
                surface = PublicSurface(trip_id=trip_id, scope={"defaults": {"date_precision": "month"}})
                session.add(surface)
                session.flush()
        except IntegrityError:
            # Another owner session may have created the initial surface first.
            surface = session.get(PublicSurface, trip_id)
            if surface is None:
                raise
    return surface


def public_status_of(surface: PublicSurface, trip: Trip | None = None) -> PublicProjectionStatusResponse:
    """The owner's view of the public page; ``trip`` fills in the exceptions of an applied preset."""
    return PublicProjectionStatusResponse(
        revision=surface.revision,
        trip_id=surface.trip_id,
        scope=surface.scope,
        surface_state=surface.state,
        slug=surface.slug,
        applied_preset=surface.applied_preset,
        applied_preset_at=surface.applied_preset_at,
        preset_exceptions=exceptions_of(trip, surface) if trip is not None else None,
    )


def public_status(session: Session, surface: PublicSurface) -> PublicProjectionStatusResponse:
    """The same, loading the trip only when a preset label needs it."""
    trip = session.scalar(trip_query().where(Trip.id == surface.trip_id)) if surface.applied_preset else None
    return public_status_of(surface, trip)


EXCLUSION_WIDENING_CODE = "exclusion_widening_needs_acknowledgement"


def link_response(link: ShareLink, trip: Trip) -> ShareLinkResponse:
    """The owner's view of a link, with what its exclusions leave out and also hide."""
    response = ShareLinkResponse.model_validate(link)
    response.exclusions = scope_exclusions(trip, link.scope)
    response.preset_exceptions = exceptions_of(trip, link)
    return response


def activation_response(link: ShareLink, trip: Trip) -> ShareLinkActivateResponse:
    """The same for a link that was just activated or rotated, which also carries its capability."""
    response = ShareLinkActivateResponse.model_validate(link)
    response.exclusions = scope_exclusions(trip, link.scope)
    response.preset_exceptions = exceptions_of(trip, link)
    return response


def refuse_unacknowledged_widening(trip: Trip, before: dict, after: dict, *, live: bool, confirmed: bool) -> None:
    """Refuse (409, nothing changes) a live audience's scope edit that removes exclusions without the owner's say-so.

    Removing an exclusion shows the audience records it did not receive, so it is a widening like the ones in
    decisions 27 and 36: the refusal lists them, and ``confirm_widening`` accepts them. A draft delivers nothing,
    and narrowing never needs a confirmation."""
    if not live or confirmed:
        return
    revealed = widening(trip, before, after)
    if revealed.revealed:
        raise Conflict(
            "Removing these exclusions shows the audience records it did not receive",
            code=EXCLUSION_WIDENING_CODE,
            detail={"code": EXCLUSION_WIDENING_CODE, **revealed.model_dump(mode="json")},
        )


def scope_change_details(trip: Trip, before: dict, after: dict) -> dict:
    """The audit entry of a live scope edit: fingerprints and, when exclusions changed, their ids and counts only."""
    details: dict = {"scope_version_before": scope_fingerprint(before), "scope_version_after": scope_fingerprint(after)}
    if changes := exclusion_changes(before, after):
        details["exclusions"] = {**changes, "widened": widening(trip, before, after).counts}
    return details


def claim_revision(session: Session, record: PublicSurface | ShareLink, expected: str | None) -> None:
    """Atomically advance the revision; without ``If-Match`` (the MCP tools send none) the write is unconditional."""
    model = type(record)
    key = PublicSurface.trip_id if isinstance(record, PublicSurface) else ShareLink.id
    identity = record.trip_id if isinstance(record, PublicSurface) else record.id
    statement = update(model).where(key == identity)
    if expected is not None:
        if not re.fullmatch(r'"[0-9]+"', expected):
            raise InvalidRevision
        statement = statement.where(model.revision == int(expected[1:-1]))
    result = session.execute(
        statement.values(revision=model.revision + 1)
        .returning(model.revision)
        .execution_options(synchronize_session=False)
    )
    if result.scalar_one_or_none() is None:
        session.rollback()
        session.refresh(record)
        trip = session.scalar(trip_query().where(Trip.id == record.trip_id))
        current = (
            public_status_of(record, trip)
            if isinstance(record, PublicSurface)
            else (link_response(record, trip) if trip is not None else ShareLinkResponse.model_validate(record))
        )
        raise RevisionConflict(current.model_dump(mode="json"))
    session.refresh(record)


def member_response(member: CollectionMember, trip: Trip) -> CollectionMemberResponse:
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


def claim_member_revision(session: Session, member: CollectionMember, expected: str | None) -> None:
    statement = update(CollectionMember).where(CollectionMember.id == member.id)
    if expected is not None:
        if not re.fullmatch(r'"[0-9]+"', expected):
            raise InvalidRevision
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
        current = member_response(member, trip) if trip is not None else None
        raise RevisionConflict(current.model_dump(mode="json") if current is not None else None)
    session.refresh(member)


def expire_collection(session: Session, collection: Collection) -> None:
    """Record active -> expired, stamping the audit event with the real expiry time; the caller commits."""
    collection.state = LinkState.EXPIRED
    record_collection_event(
        session,
        owner_subject=collection.owner_subject,
        actor_subject=SYSTEM_ACTOR,
        collection_id=collection.id,
        kind="collection.expire",
        occurred_at=collection.expires_at,
    )
    session.flush()
    session.info[LAZY_EXPIRY] = True


def trips_by_id(session: Session, collection: Collection) -> dict[str, Trip]:
    ids = [member.trip_id for member in collection.members]
    if not ids:
        return {}
    return {trip.id: trip for trip in session.scalars(trip_query().where(Trip.id.in_(ids)))}


def active_collection(session: Session, token: str) -> Collection | None:
    """The collection this token opens right now, or nothing (unknown, draft, revoked, expired).

    A collection found past its expiry is marked expired in the caller's transaction: commit before answering."""
    collection = session.scalar(select(Collection).where(Collection.token_verifier == verifier_for(token)))
    if collection is None or collection.state != LinkState.ACTIVE:
        return None
    if collection.expires_at is not None and aware_utc(collection.expires_at) <= datetime.now(UTC):
        expire_collection(session, collection)
        return None
    return collection


def collection_index(session: Session, collection: Collection) -> CollectionIndexDocument:
    """The members as the audience sees them: each entry is built from its own projection, so it
    can show nothing the member's trip page would not."""
    trips = trips_by_id(session, collection)
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
