"""What an owner sees of the audiences of a trip, and the capabilities behind a hidden link and a collection.

The owner's per-kind responses (the payloads stay as they are, decision 360), the lazy expiry of a link or
collection a reader found past its ``expires_at``, minting a capability, and the collection index a visitor
receives. Shared by the owner routers, the preset service and the MCP tools; what every audience does alike is in
``services.audiences``. Nothing here commits: the caller owns the transaction, including the lazy expiry write.
"""

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..audience import (
    Audience,
    LinkAudience,
    MemberAudience,
    PublicAudience,
    default_public_scope,
    has_expired,
)
from ..audit import SYSTEM_ACTOR, record_audit_event, record_collection_event
from ..capability import generate_token, verifier_for
from ..exclusion_review import scope_exclusions
from ..models import (
    AuditEventKind,
    AuditTargetType,
    Collection,
    CollectionAuditKind,
    CollectionMember,
    LinkState,
    PublicSurface,
    ShareLink,
    Trip,
)
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
from .live_location import forget_audience
from .trips import trip_query

# Set on the session when a read recorded an expiry (see ``expire_collection`` and ``expire_link``): the caller
# commits before it answers, and ``http_delivery.persist_lazy_expiry`` does so for the routers.
LAZY_EXPIRY = "lazy_expiry"


def get_or_create_surface(session: Session, trip_id: Identifier) -> PublicSurface:
    surface = session.get(PublicSurface, trip_id)
    if surface is None:
        try:
            with session.begin_nested():
                # A new public view reads dates by month until the owner chooses otherwise.
                surface = PublicSurface(trip_id=trip_id, scope=default_public_scope())
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


def audience_response(audience: Audience, trip: Trip | None) -> BaseModel | None:
    """The owner's response for a stored audience, in the payload its kind has always had.

    ``trip`` fills in what needs its records (a link's exclusions, a preset's exceptions); without it a link is
    answered from its row and a collection member, which is only meaningful with its trip, not at all."""
    match audience:
        case PublicAudience(surface=PublicSurface() as surface):
            return public_status_of(surface, trip)
        case LinkAudience(link=link):
            return link_response(link, trip) if trip is not None else ShareLinkResponse.model_validate(link)
        case MemberAudience(member=member):
            return member_response(member, trip) if trip is not None else None
    raise ValueError("An audience that was never saved has no response")


def mint_capability(record: ShareLink | Collection, expires_in_days: int | None) -> str:
    """Make a draft link or collection active under a fresh token; the caller records the audit event."""
    token = generate_token()
    now = datetime.now(UTC)
    record.token = token
    record.token_verifier = verifier_for(token)
    record.expires_at = now + timedelta(days=expires_in_days) if expires_in_days is not None else None
    record.state = LinkState.ACTIVE
    record.activated_at = now
    return token


def expire_link(session: Session, link: ShareLink) -> None:
    """Record the active -> expired transition, stamping the audit event with the real expiry time rather than
    the time someone noticed. The caller commits."""
    link.state = LinkState.EXPIRED
    forget_audience(session, LinkAudience(link))
    record_audit_event(
        session,
        trip_id=link.trip_id,
        actor_subject=SYSTEM_ACTOR,
        kind=AuditEventKind.SHARE_LINK_EXPIRE,
        target_type=AuditTargetType.SHARE_LINK,
        target_id=link.id,
        details={},
        occurred_at=link.expires_at,
    )
    session.info[LAZY_EXPIRY] = True


def expire_collection(session: Session, collection: Collection) -> None:
    """Record active -> expired, stamping the audit event with the real expiry time; the caller commits."""
    collection.state = LinkState.EXPIRED
    record_collection_event(
        session,
        owner_subject=collection.owner_subject,
        actor_subject=SYSTEM_ACTOR,
        collection_id=collection.id,
        kind=CollectionAuditKind.EXPIRE,
        occurred_at=collection.expires_at,
    )
    session.flush()
    session.info[LAZY_EXPIRY] = True


def settle_expired(session: Session, records: Iterable[ShareLink | Collection]) -> None:
    """Lazy write for owner reads: an active link or collection past ``expires_at`` is stored as expired the first
    time the owner (or a visitor) sees it. No sweep job runs. The caller commits."""
    for record in records:
        if record.state == LinkState.ACTIVE and has_expired(record.expires_at):
            if isinstance(record, ShareLink):
                expire_link(session, record)
            else:
                expire_collection(session, record)


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
    if has_expired(collection.expires_at):
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
