"""What every audience shares (#360, decision 360): the public view, a hidden link and a collection member.

Each operation here takes an ``app.audience.Audience`` and is written once: finding the one an owner addresses,
previewing what it receives (the document, a file, a navigation target, what it would show of a trip that has not
started), claiming its revision, and editing its scope with the widening check and the audit entry. The per-kind
services (``publication`` and ``collections``) and routes only say which audience is meant and keep what is theirs
alone: a link's token and lifecycle, a collection's members, the public view's publishing.

Nothing here commits. A read that finds a link or collection past its ``expires_at`` marks it expired in the
caller's transaction (see ``services.sharing``), so the caller commits after reads too.
"""

import re
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..audience import (
    PUBLIC_KEY,
    UNLISTED_SCHEMA,
    Audience,
    LinkAudience,
    MemberAudience,
    PublicAudience,
    capability_editable,
)
from ..audit import record_audience_event, scope_fingerprint
from ..errors import Conflict, InvalidRevision, RecordNotFound, RevisionConflict, service_error
from ..exclusion_review import exclusion_changes, widening
from ..models import Collection, CollectionMember, PublicSurface, ShareLink, Trip
from ..overview import future_counts
from ..projection import ScopeError, prepare_scope, render_projection
from ..schemas import FutureDisclosure, Identifier, ShareScopeInput
from ..storage import ObjectStorage
from .delivery import inspect_delivered_file, navigation_target
from .live_location import current_for_audience
from .sharing import audience_response, get_or_create_surface, settle_expired
from .trips import owned_trip, trip_query

EXCLUSION_WIDENING_CODE = "exclusion_widening_needs_acknowledgement"

# --- finding an audience ---------------------------------------------------------------------------------------


def public_audience(session: Session, trip_id: Identifier) -> PublicAudience:
    """The public view of a trip as it is stored; one that was never saved reads as the default scope."""
    return PublicAudience(session.get(PublicSurface, trip_id), trip_id)


def saved_public_audience(session: Session, trip_id: Identifier) -> PublicAudience:
    """The public view of a trip, created with the default scope when the owner never saved one."""
    return PublicAudience(get_or_create_surface(session, trip_id))


def owned_link(session: Session, subject: str, trip_id: Identifier, link_id: Identifier) -> LinkAudience:
    """One of the owner's hidden links, settled if it ran out, or 404."""
    owned_trip(session, trip_id, subject)
    link = session.scalar(select(ShareLink).where(ShareLink.id == link_id, ShareLink.trip_id == trip_id))
    if link is None:
        raise RecordNotFound("Share link not found")
    settle_expired(session, [link])
    return LinkAudience(link)


def owned_collection(session: Session, subject: str, collection_id: Identifier) -> Collection:
    """One of the owner's collections, settled if it ran out, or 404."""
    collection = session.scalar(
        select(Collection).where(Collection.id == collection_id, Collection.owner_subject == subject)
    )
    if collection is None:
        raise RecordNotFound("Collection not found")
    settle_expired(session, [collection])
    return collection


def member_of(collection: Collection, member_id: Identifier) -> MemberAudience:
    member = next((item for item in collection.members if item.id == member_id), None)
    if member is None:
        raise RecordNotFound("Member not found")
    return MemberAudience(member, collection)


def owned_member(session: Session, subject: str, collection_id: Identifier, member_id: Identifier) -> MemberAudience:
    """A member of one of the owner's collections (the collection settled if it ran out), or 404."""
    return member_of(owned_collection(session, subject, collection_id), member_id)


def owned_member_unsettled(
    session: Session, subject: str, collection_id: Identifier, member_id: Identifier
) -> MemberAudience:
    """The same without the lazy expiry write, for the owner's reads that store nothing."""
    found = session.execute(
        select(CollectionMember, Collection)
        .join(Collection, Collection.id == CollectionMember.collection_id)
        .where(
            CollectionMember.id == member_id,
            CollectionMember.collection_id == collection_id,
            Collection.owner_subject == subject,
        )
    ).first()
    if found is None:
        raise RecordNotFound("Member not found")
    return MemberAudience(*found)


def not_editable(noun: str) -> Conflict:
    return Conflict(
        f"A revoked or expired {noun} cannot be edited", code=f"a_revoked_or_expired_{noun}_cannot_be_edited"
    )


def require_editable(audience: Audience) -> None:
    """Refuse (409) to change a revoked or expired audience; a draft and a live one can be edited."""
    if not audience.editable:
        raise not_editable(audience.noun)


def require_collection_editable(collection: Collection) -> None:
    if not capability_editable(collection):
        raise not_editable("collection")


def resolve_audience(session: Session, subject: str, trip_id: Identifier, audience_id: str) -> Audience:
    """The audience named ``public``, ``link:<id>`` or ``collection:<member id>`` on one of the owner's trips.

    Reads only, as a preset review does: nothing is settled or created (a public view that was never saved comes
    back unsaved). A draft link or collection and an unpublished page can be edited (they deliver nothing yet); a
    revoked or expired one cannot. Another owner's audience is a 404."""
    owned_trip(session, trip_id, subject)
    kind, _, identifier = audience_id.partition(":")
    audience: Audience
    if audience_id == PUBLIC_KEY:
        return public_audience(session, trip_id)
    if kind == "link" and identifier:
        link = session.scalar(select(ShareLink).where(ShareLink.id == identifier, ShareLink.trip_id == trip_id))
        if link is None:
            raise RecordNotFound("Share link not found")
        audience = LinkAudience(link)
    elif kind == "collection" and identifier:
        found = session.execute(
            select(CollectionMember, Collection)
            .join(Collection, Collection.id == CollectionMember.collection_id)
            .where(
                CollectionMember.id == identifier,
                CollectionMember.trip_id == trip_id,
                Collection.owner_subject == subject,
            )
        ).first()
        if found is None:
            raise RecordNotFound("Member not found")
        audience = MemberAudience(*found)
    else:
        raise RecordNotFound("Audience not found")
    require_editable(audience)
    return audience


# --- scopes ----------------------------------------------------------------------------------------------------


def checked_scope(trip: Trip, audience: Audience, candidate: ShareScopeInput) -> dict:
    """The scope a submitted candidate would store for this audience, validated like a save."""
    return new_scope(trip, candidate, audience.stored_scope, can_exclude=audience.can_exclude)


def new_scope(trip: Trip, candidate: ShareScopeInput, stored: dict | None, *, can_exclude: bool) -> dict:
    """Validate a submitted scope and return it as stored.

    ``stored`` is the audience's current scope; a new audience passes ``None`` and so starts with the conservative
    default date precision (see ``ShareScopeInput.document``). The public view is the baseline every other audience
    subtracts from, so it cannot exclude records (``can_exclude=False``)."""
    try:
        return prepare_scope(trip, candidate.document(stored), stored, allow_exclusions=can_exclude)
    except ScopeError as error:
        raise service_error(error) from error


def preview_scope(
    session: Session, subject: str, audience: Audience, candidate: ShareScopeInput | None = None
) -> tuple[Trip, dict]:
    """The trip and the scope a preview renders: the owner's unsaved candidate, validated like a save, else the
    saved scope.

    Nothing is stored and no audit event is recorded, so a preview never changes what a live audience receives."""
    trip = owned_trip(session, audience.trip_id, subject, load_relations=True)
    if candidate is None:
        # A public view that was never saved previews as the default scope (dates by month) its first save holds.
        return trip, audience.scope
    return trip, checked_scope(trip, audience, candidate)


def render_document(session: Session, audience: Audience, trip: Trip, scope: dict) -> dict:
    """The document a visitor of this audience receives for ``scope``, with the current location live location may
    show it (only the public view and a hidden link can be shown one)."""
    document = render_projection(trip, scope, audience.schema_version)
    key = audience.live_location_key
    if key is not None and (positions := current_for_audience(session, trip.id, key)):
        document["current_locations"] = positions
    return document


def preview_document(
    session: Session, subject: str, audience: Audience, candidate: ShareScopeInput | None = None
) -> dict:
    trip, scope = preview_scope(session, subject, audience, candidate)
    return render_document(session, audience, trip, scope)


def review_future(
    session: Session, subject: str, audience: Audience, candidate: ShareScopeInput | None = None
) -> FutureDisclosure:
    """What the candidate scope would show of a trip that has not started yet: transport and day dates.

    The same scope the preview renders, counted from the same document, so the preview's review and the delivered
    fields cannot disagree. Stores nothing and records no audit event. The review is the same for every kind of
    audience; ``POST .../future-disclosure`` exists for the public view, a hidden link and a collection member
    (decision 360)."""
    trip, scope = preview_scope(session, subject, audience, candidate)
    document = render_projection(trip, scope, UNLISTED_SCHEMA)
    return FutureDisclosure(**future_counts(trip, document, datetime.now(UTC).date()))


def preview_navigation_target(
    session: Session, subject: str, audience: Audience, local_id: str, candidate: ShareScopeInput | None = None
) -> str:
    trip, scope = preview_scope(session, subject, audience, candidate)
    return navigation_target(trip, scope, local_id)


def inspect_preview_file(
    session: Session, subject: str, audience: Audience, local_id: str, storage: ObjectStorage
) -> dict[str, str | None]:
    trip, scope = preview_scope(session, subject, audience)
    return inspect_delivered_file(trip, scope, local_id, storage)


# --- editing a scope -------------------------------------------------------------------------------------------


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


def scope_change_details(trip: Trip, audience: Audience, before: dict, after: dict) -> dict:
    """The audit entry of a live scope edit: fingerprints and, when exclusions changed, their ids and counts only."""
    details: dict = {"scope_version_before": scope_fingerprint(before), "scope_version_after": scope_fingerprint(after)}
    if audience.can_exclude and (changes := exclusion_changes(before, after)):
        details["exclusions"] = {**changes, "widened": widening(trip, before, after).counts}
    return details


def claim_revision(session: Session, audience: Audience, expected: str | None) -> None:
    """Atomically advance the revision; without ``If-Match`` (the MCP tools send none) the write is unconditional.

    A stale ``If-Match`` rolls the transaction back and answers with the winner's state."""
    model, key, identity = audience.revision_column
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
        session.refresh(audience.holder)
        trip = session.scalar(trip_query().where(Trip.id == audience.trip_id))
        current = audience_response(audience, trip)
        raise RevisionConflict(current.model_dump(mode="json") if current is not None else None)
    session.refresh(audience.holder)


def edit_scope(
    session: Session,
    subject: str,
    audience: Audience,
    trip: Trip,
    candidate: ShareScopeInput | None,
    *,
    if_match: str | None,
    confirm_widening: bool = False,
) -> None:
    """The one scope edit of every audience: validate the candidate, refuse an unacknowledged widening, claim the
    revision (``If-Match``) and store the scope, recording the change when the audience delivers.

    Without a candidate only the revision is claimed (a link's label edit). The widening is refused before the
    revision is claimed, so a refused edit changes nothing, not even the revision. A draft delivers nothing yet, so
    its activation records the scope instead; the public view is the baseline and has no exclusions to widen."""
    if candidate is not None:
        # Lock the row and read it again before the candidate is built from the stored scope: a concurrent edit that
        # committed since this audience was loaded (an added exclusion) would otherwise be overwritten by a scope
        # prepared from the older one, and the widening check below would never see it.
        session.refresh(audience.holder, with_for_update=True)
        require_editable(audience)
    scope = checked_scope(trip, audience, candidate) if candidate is not None else None
    if scope is not None and audience.can_exclude:
        refuse_unacknowledged_widening(trip, audience.scope, scope, live=audience.live, confirmed=confirm_widening)
    claim_revision(session, audience, if_match)
    if scope is None:
        return
    previous = audience.scope
    audience.scope = scope
    if audience.live and scope_fingerprint(previous) != scope_fingerprint(scope):
        record_audience_event(
            session,
            subject=subject,
            audience=audience,
            event="scope_change",
            details=scope_change_details(trip, audience, previous, scope),
        )
