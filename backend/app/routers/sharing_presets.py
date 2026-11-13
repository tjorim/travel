"""Owner-only review and apply of a sharing preset for one audience (#241).

The review plans the preset and compares what the audience receives before and after, in a transaction that is
rolled back: it stores nothing, claims no revision and records no audit event. The apply writes the same plan in one
transaction (see ``sharing_presets.apply_preset``). Both are shared by the REST routes and the MCP tools, and never
reachable through a visitor response."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..errors import ApiException
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
from ..services.sharing import (
    claim_member_revision,
    claim_revision,
    get_or_create_surface,
    link_response,
    member_response,
    public_status,
)
from ..services.trips import owned_trip
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

router = APIRouter(tags=["publication"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]

# What a public view that was never saved holds once it is created: dates by month.
UNSAVED_PUBLIC_SCOPE = {"defaults": {"date_precision": "month"}}


def _not_found(detail: str) -> ApiException:
    return ApiException(status_code=status.HTTP_404_NOT_FOUND, detail=detail, code="not_found")


def _not_editable(what: str) -> ApiException:
    return ApiException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"A revoked or expired {what} cannot be edited",
        code=f"a_revoked_or_expired_{what}_cannot_be_edited",
    )


def _owned_member_of_collection(
    session: Session, collection_id: Identifier, member_id: Identifier, subject: str
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
        raise _not_found("Member not found")
    return member


def preset_catalog_response(trip_id: Identifier, session: Session, subject: str) -> SharingPresetCatalog:
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


def resolve_audience(session: Session, trip_id: Identifier, audience_id: str, subject: str) -> Holder | None:
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
            raise _not_found("Share link not found")
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
            raise _not_found("Member not found")
        member, collection = found
        if collection.state not in (LinkState.DRAFT, LinkState.ACTIVE) or (
            collection.state == LinkState.ACTIVE and expired(collection.expires_at)
        ):
            raise _not_editable("collection")
        return member
    raise _not_found("Audience not found")


def review_sharing_preset(
    trip_id: Identifier, audience_id: str, payload: SharingPresetRequest, session: Session, subject: str
) -> SharingPresetReview:
    """Review a preset for ``public``, ``link:<id>`` or ``collection:<member id>`` of one of the owner's trips.

    Reads only: this never creates the public view, and a view that was never saved is reviewed as the default scope
    (dates by month) that a new one would hold."""
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    holder = resolve_audience(session, trip_id, audience_id, subject)
    audience = (
        audience_of(holder)
        if holder is not None
        else PresetAudience(
            id="public", kind="public", label=None, scope=UNSAVED_PUBLIC_SCOPE, live=False, can_exclude=False
        )
    )
    return review_preset(session, trip, audience, payload.preset)


def apply_sharing_preset(
    trip_id: Identifier,
    audience_id: str,
    payload: SharingPresetApplyRequest,
    session: Session,
    subject: str,
    if_match: str | None = None,
) -> PublicPresetApplyResult | LinkPresetApplyResult | MemberPresetApplyResult:
    """Apply a reviewed preset to one audience and commit; see ``sharing_presets.apply_preset`` for the rules.

    The audience's revision is claimed from ``If-Match`` (412 ``scope_revision_conflict`` when stale; absent stays an
    unconditional write that still advances the revision, like every other scope write)."""
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    holder = resolve_audience(session, trip_id, audience_id, subject)
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
    session.commit()
    if isinstance(holder, PublicSurface):
        return PublicPresetApplyResult(applied=applied, review=review, audience=public_status(session, holder))
    if isinstance(holder, ShareLink):
        return LinkPresetApplyResult(applied=applied, review=review, audience=link_response(holder, trip))
    return MemberPresetApplyResult(applied=applied, review=review, audience=member_response(holder, trip))


@router.get("/trips/{trip_id}/sharing-presets", response_model=SharingPresetCatalog)
def list_sharing_presets(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> SharingPresetCatalog:
    return preset_catalog_response(trip_id, session, subject)


@router.post("/trips/{trip_id}/public-projection/preset/review", response_model=SharingPresetReview)
def review_public_preset(
    trip_id: Identifier, payload: SharingPresetRequest, session: SessionDep, subject: SubjectDep
) -> SharingPresetReview:
    return review_sharing_preset(trip_id, "public", payload, session, subject)


@router.post("/trips/{trip_id}/share-links/{link_id}/preset/review", response_model=SharingPresetReview)
def review_link_preset(
    trip_id: Identifier, link_id: Identifier, payload: SharingPresetRequest, session: SessionDep, subject: SubjectDep
) -> SharingPresetReview:
    return review_sharing_preset(trip_id, f"link:{link_id}", payload, session, subject)


@router.post("/collections/{collection_id}/members/{member_id}/preset/review", response_model=SharingPresetReview)
def review_collection_member_preset(
    collection_id: Identifier,
    member_id: Identifier,
    payload: SharingPresetRequest,
    session: SessionDep,
    subject: SubjectDep,
) -> SharingPresetReview:
    member = _owned_member_of_collection(session, collection_id, member_id, subject)
    return review_sharing_preset(member.trip_id, f"collection:{member.id}", payload, session, subject)


@router.post("/trips/{trip_id}/public-projection/preset", response_model=PublicPresetApplyResult)
def apply_public_preset(
    trip_id: Identifier,
    payload: SharingPresetApplyRequest,
    session: SessionDep,
    subject: SubjectDep,
    if_match: Annotated[str | None, Header()] = None,
) -> PublicPresetApplyResult:
    result = apply_sharing_preset(trip_id, "public", payload, session, subject, if_match)
    assert isinstance(result, PublicPresetApplyResult)
    return result


@router.post("/trips/{trip_id}/share-links/{link_id}/preset", response_model=LinkPresetApplyResult)
def apply_link_preset(
    trip_id: Identifier,
    link_id: Identifier,
    payload: SharingPresetApplyRequest,
    session: SessionDep,
    subject: SubjectDep,
    if_match: Annotated[str | None, Header()] = None,
) -> LinkPresetApplyResult:
    result = apply_sharing_preset(trip_id, f"link:{link_id}", payload, session, subject, if_match)
    assert isinstance(result, LinkPresetApplyResult)
    return result


@router.post("/collections/{collection_id}/members/{member_id}/preset", response_model=MemberPresetApplyResult)
def apply_collection_member_preset(
    collection_id: Identifier,
    member_id: Identifier,
    payload: SharingPresetApplyRequest,
    session: SessionDep,
    subject: SubjectDep,
    if_match: Annotated[str | None, Header()] = None,
) -> MemberPresetApplyResult:
    member = _owned_member_of_collection(session, collection_id, member_id, subject)
    result = apply_sharing_preset(member.trip_id, f"collection:{member.id}", payload, session, subject, if_match)
    assert isinstance(result, MemberPresetApplyResult)
    return result
