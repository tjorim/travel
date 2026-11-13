"""Owner-only review and apply of a sharing preset for one audience (#241).

The review plans the preset and compares what the audience receives before and after, in a transaction that is
rolled back: it stores nothing, claims no revision and records no audit event. The apply writes the same plan in one
transaction (see ``app.sharing_presets.apply_preset``) and leaves the commit to the caller. Both are shared by the
REST routes and the MCP tools, and never reachable through a visitor response.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import Conflict, RecordNotFound
from ..models import Collection, CollectionMember, LinkState, PublicSurface, ShareLink
from ..schemas import (
    Identifier,
    LinkPresetApplyResult,
    MemberPresetApplyResult,
    PublicPresetApplyResult,
    SharingPresetApplyRequest,
    SharingPresetCatalog,
    SharingPresetDefinition,
    SharingPresetKindRule,
    SharingPresetRequest,
    SharingPresetReview,
)
from ..sharing_presets import (
    PRESET_DATE_PRECISION,
    PRESET_SCHEMA_VERSION,
    Holder,
    PresetAudience,
    apply_preset,
    audience_of,
    expired,
    preset_catalog,
    review_preset,
)
from .sharing import (
    claim_member_revision,
    claim_revision,
    get_or_create_surface,
    link_response,
    member_response,
    public_status,
)
from .trips import owned_trip

# What a public view that was never saved holds once it is created: dates by month.
UNSAVED_PUBLIC_SCOPE = {"defaults": {"date_precision": "month"}}


def _not_editable(what: str) -> Conflict:
    return Conflict(
        f"A revoked or expired {what} cannot be edited", code=f"a_revoked_or_expired_{what}_cannot_be_edited"
    )


def owned_member_of_collection(
    session: Session, subject: str, collection_id: Identifier, member_id: Identifier
) -> CollectionMember:
    member = session.scalar(
        select(CollectionMember)
        .join(Collection, Collection.id == CollectionMember.collection_id)
        .where(
            CollectionMember.id == member_id,
            CollectionMember.collection_id == collection_id,
            Collection.owner_subject == subject,
        )
    )
    if member is None:
        raise RecordNotFound("Member not found")
    return member


def preset_catalog_response(session: Session, subject: str, trip_id: Identifier) -> SharingPresetCatalog:
    owned_trip(session, trip_id, subject)
    return SharingPresetCatalog(
        schema_version=PRESET_SCHEMA_VERSION,
        presets=[
            SharingPresetDefinition(
                id=preset.id,
                extends=preset.extends,
                selects=[
                    SharingPresetKindRule(kind=rule.kind, statuses=sorted(rule.statuses) if rule.statuses else None)
                    for rule in preset.selects
                ],
                photos="attached_to_included_updates",
                date_precision=PRESET_DATE_PRECISION,
            )
            for preset in preset_catalog()
        ],
    )


def resolve_audience(session: Session, subject: str, trip_id: Identifier, audience_id: str) -> Holder | None:
    """The stored public view, link or collection member named by ``public``, ``link:<id>`` or ``collection:<id>``.

    A draft link or collection and an unpublished page can be edited (they deliver nothing yet); a revoked or expired
    one cannot. Another owner's audience is a 404. ``None`` only for a public view that was never saved."""
    owned_trip(session, trip_id, subject)
    kind, _, identifier = audience_id.partition(":")
    if audience_id == "public":
        return session.get(PublicSurface, trip_id)
    if kind == "link" and identifier:
        link = session.scalar(select(ShareLink).where(ShareLink.id == identifier, ShareLink.trip_id == trip_id))
        if link is None:
            raise RecordNotFound("Share link not found")
        if link.state not in (LinkState.DRAFT, LinkState.ACTIVE) or (
            link.state == LinkState.ACTIVE and expired(link.expires_at)
        ):
            raise _not_editable("link")
        return link
    if kind == "collection" and identifier:
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
        member, collection = found
        if collection.state not in (LinkState.DRAFT, LinkState.ACTIVE) or (
            collection.state == LinkState.ACTIVE and expired(collection.expires_at)
        ):
            raise _not_editable("collection")
        return member
    raise RecordNotFound("Audience not found")


def review_sharing_preset(
    session: Session, subject: str, trip_id: Identifier, audience_id: str, payload: SharingPresetRequest
) -> SharingPresetReview:
    """Review a preset for ``public``, ``link:<id>`` or ``collection:<member id>`` of one of the owner's trips.

    Reads only: this never creates the public view, and a view that was never saved is reviewed as the default scope
    (dates by month) that a new one would hold."""
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    holder = resolve_audience(session, subject, trip_id, audience_id)
    audience = (
        audience_of(holder)
        if holder is not None
        else PresetAudience(
            id="public", kind="public", label=None, scope=UNSAVED_PUBLIC_SCOPE, live=False, can_exclude=False
        )
    )
    return review_preset(session, trip, audience, payload.preset)


def apply_sharing_preset(
    session: Session,
    subject: str,
    trip_id: Identifier,
    audience_id: str,
    payload: SharingPresetApplyRequest,
    if_match: str | None = None,
) -> PublicPresetApplyResult | LinkPresetApplyResult | MemberPresetApplyResult:
    """Apply a reviewed preset to one audience; the caller commits. See ``sharing_presets.apply_preset`` for the rules.

    The audience's revision is claimed from ``If-Match`` (412 ``scope_revision_conflict`` when stale; absent stays an
    unconditional write that still advances the revision, like every other scope write)."""
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    holder = resolve_audience(session, subject, trip_id, audience_id)
    if holder is None:
        holder = get_or_create_surface(session, trip_id)
    claim = (
        (lambda: claim_member_revision(session, holder, if_match))
        if isinstance(holder, CollectionMember)
        else (lambda: claim_revision(session, holder, if_match))
    )
    review, applied = apply_preset(
        session,
        trip,
        subject,
        holder,
        payload.preset,
        fingerprint=payload.fingerprint,
        confirm_widening=payload.confirm_widening,
        claim=claim,
    )
    session.flush()
    if isinstance(holder, PublicSurface):
        return PublicPresetApplyResult(applied=applied, review=review, audience=public_status(session, holder))
    if isinstance(holder, ShareLink):
        return LinkPresetApplyResult(applied=applied, review=review, audience=link_response(holder, trip))
    return MemberPresetApplyResult(applied=applied, review=review, audience=member_response(holder, trip))
