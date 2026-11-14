"""Owner-only review and apply of a sharing preset for one audience (#241), whichever kind it is (decision 360).

The review plans the preset and compares what the audience receives before and after, in a transaction that is
rolled back: it stores nothing, claims no revision and records no audit event. The apply writes the same plan in one
transaction (see ``app.sharing_presets.apply_preset``) and leaves the commit to the caller. Both are shared by the
REST routes and the MCP tools, and never reachable through a visitor response.
"""

from sqlalchemy.orm import Session

from ..audience import LinkAudience, MemberAudience, PublicAudience
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
    apply_preset,
    preset_catalog,
    review_preset,
)
from . import audiences
from .sharing import link_response, member_response, public_status
from .trips import owned_trip


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


def review_sharing_preset(
    session: Session, subject: str, trip_id: Identifier, audience_id: str, payload: SharingPresetRequest
) -> SharingPresetReview:
    """Review a preset for ``public``, ``link:<id>`` or ``collection:<member id>`` of one of the owner's trips.

    Reads only: this never creates the public view, and a view that was never saved is reviewed as the default scope
    (dates by month) that a new one would hold."""
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    audience = audiences.resolve_audience(session, subject, trip_id, audience_id)
    return review_preset(session, trip, audience, payload.preset)


def review_member_preset(
    session: Session,
    subject: str,
    collection_id: Identifier,
    member_id: Identifier,
    payload: SharingPresetRequest,
) -> SharingPresetReview:
    member = audiences.owned_member_unsettled(session, subject, collection_id, member_id)
    return review_sharing_preset(session, subject, member.trip_id, member.id, payload)


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
    audience = audiences.resolve_audience(session, subject, trip_id, audience_id)
    if isinstance(audience, PublicAudience) and audience.surface is None:
        audience = audiences.saved_public_audience(session, trip_id)
    review, applied = apply_preset(
        session,
        trip,
        subject,
        audience,
        payload.preset,
        fingerprint=payload.fingerprint,
        confirm_widening=payload.confirm_widening,
        claim=lambda: audiences.claim_revision(session, audience, if_match),
    )
    session.flush()
    match audience:
        case PublicAudience(surface=surface) if surface is not None:
            return PublicPresetApplyResult(applied=applied, review=review, audience=public_status(session, surface))
        case MemberAudience(member=member):
            return MemberPresetApplyResult(applied=applied, review=review, audience=member_response(member, trip))
        case LinkAudience(link=link):
            return LinkPresetApplyResult(applied=applied, review=review, audience=link_response(link, trip))
    raise ValueError("An audience that was never saved cannot have a preset applied")


def apply_member_preset(
    session: Session,
    subject: str,
    collection_id: Identifier,
    member_id: Identifier,
    payload: SharingPresetApplyRequest,
    if_match: str | None = None,
) -> MemberPresetApplyResult:
    member = audiences.owned_member_unsettled(session, subject, collection_id, member_id)
    result = apply_sharing_preset(session, subject, member.trip_id, member.id, payload, if_match)
    assert isinstance(result, MemberPresetApplyResult)
    return result
