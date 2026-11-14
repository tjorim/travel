"""The owner's public page and named share links: scope edits, previews, publishing and the link lifecycle.

Shared by the HTTP routers and the MCP tools. Nothing here commits: a reader that finds a link past its
``expires_at`` marks it expired in the caller's transaction, so the caller commits after every call (reads too).
Anonymous delivery lives in ``routers/publication.py``; it only reads what these functions write.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..audit import SYSTEM_ACTOR, record_audit_event, scope_fingerprint
from ..capability import generate_token, verifier_for
from ..errors import Conflict, RecordNotFound, Refusal, service_error
from ..exclusion_review import exclusion_review
from ..models import (
    AuditEvent,
    AuditEventKind,
    AuditTargetType,
    LinkState,
    PublicSurface,
    ShareLink,
    SurfaceState,
    Trip,
)
from ..overview import future_counts
from ..projection import ScopeError, prepare_scope, render_projection
from ..schemas import (
    AuditReasonInput,
    ExclusionReview,
    ExclusionReviewRequest,
    FeedEnableRequest,
    FutureDisclosure,
    Identifier,
    PublicProjectionStatusResponse,
    ShareLinkActivateRequest,
    ShareLinkActivateResponse,
    ShareLinkCreate,
    ShareLinkResponse,
    ShareLinkUpdate,
    ShareScopeInput,
)
from ..sharing_presets import apply_preset
from ..storage import ObjectStorage
from .delivery import inspect_delivered_file, navigation_target
from .live_location import current_for_audience
from .sharing import (
    LAZY_EXPIRY,
    activation_response,
    aware_utc,
    claim_revision,
    get_or_create_surface,
    link_response,
    public_status,
    refuse_unacknowledged_widening,
    scope_change_details,
)
from .trips import lock_trip, owned_trip

EDITABLE_LINK_STATES = (LinkState.DRAFT, LinkState.ACTIVE)


def apply_scope(
    session: Session,
    subject: str,
    trip_id: Identifier,
    scope: ShareScopeInput,
    stored: dict | None = None,
    *,
    public: bool = False,
) -> dict:
    """Validate a submitted scope and return it as stored.

    ``stored`` is the audience's current scope; a new audience passes ``None`` and so starts with the
    conservative default date precision (see ``ShareScopeInput.document``). The public view is the
    baseline every other audience subtracts from, so it cannot exclude records (``public=True``)."""
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    scope_dict = scope.document(stored)
    try:
        return prepare_scope(trip, scope_dict, stored, allow_exclusions=not public)
    except ScopeError as error:
        raise service_error(error) from error


def preview_scope(
    session: Session,
    subject: str,
    trip_id: Identifier,
    candidate: ShareScopeInput | None,
    saved: dict | None,
    *,
    public: bool = False,
) -> dict:
    """The scope a preview renders: the owner's unsaved candidate, validated like a save, else the saved one.

    Nothing is stored and no audit event is recorded, so a preview never changes what a live audience receives.
    """
    if candidate is None:
        return saved or {}
    return apply_scope(session, subject, trip_id, candidate, saved, public=public)


# --- The public page -------------------------------------------------------------
#
# `state` is the only gate: it controls whether this trip is served publicly
# at all. While published (or before first publishing), `scope` is a live
# field — editing it takes effect immediately, and delivery always renders
# current trip content filtered to it. There is no frozen snapshot to
# republish: widening scope is a live edit, same as narrowing it.


def get_public_projection_status(session: Session, subject: str, trip_id: Identifier) -> PublicProjectionStatusResponse:
    owned_trip(session, trip_id, subject)
    return public_status(session, get_or_create_surface(session, trip_id))


def set_public_projection_scope(
    session: Session, subject: str, trip_id: Identifier, payload: ShareScopeInput, if_match: str | None = None
) -> PublicProjectionStatusResponse:
    owned_trip(session, trip_id, subject)
    surface = get_or_create_surface(session, trip_id)
    scope = apply_scope(session, subject, trip_id, payload, surface.scope, public=True)
    claim_revision(session, surface, if_match)
    before = scope_fingerprint(surface.scope)
    surface.scope = scope
    after = scope_fingerprint(scope)
    # An unpublished page delivers nothing, so only a live page's edit counts.
    if surface.state == SurfaceState.PUBLISHED and before != after:
        record_audit_event(
            session,
            trip_id=trip_id,
            actor_subject=subject,
            kind=AuditEventKind.PUBLIC_PROJECTION_SCOPE_CHANGE,
            target_type=AuditTargetType.PUBLIC_SURFACE,
            target_id=surface.trip_id,
            details={"scope_version_before": before, "scope_version_after": after},
        )
    session.flush()
    return public_status(session, surface)


def public_preview(
    session: Session, subject: str, trip_id: Identifier, candidate: ShareScopeInput | None = None
) -> tuple[Trip, dict]:
    """The trip and the scope a preview of the public page renders: the candidate, else the saved scope."""
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    surface = session.get(PublicSurface, trip_id)
    return trip, preview_scope(session, subject, trip_id, candidate, surface.scope if surface else None, public=True)


def preview_public_projection(
    session: Session, subject: str, trip_id: Identifier, candidate: ShareScopeInput | None = None
) -> dict:
    trip, scope = public_preview(session, subject, trip_id, candidate)
    document = render_projection(trip, scope, "travel/public-trip@1")
    if positions := current_for_audience(session, trip_id, "public"):
        document["current_locations"] = positions
    return document


def _future_disclosure(trip: Trip, scope: dict) -> FutureDisclosure:
    document = render_projection(trip, scope, "travel/unlisted-trip@1")
    return FutureDisclosure(**future_counts(trip, document, datetime.now(UTC).date()))


def review_public_future(
    session: Session, subject: str, trip_id: Identifier, candidate: ShareScopeInput | None = None
) -> FutureDisclosure:
    """What the candidate public view would show of a trip that has not started yet: transport and day dates.

    The same scope the preview renders, counted from the same document, so the preview's review and the
    delivered fields cannot disagree. Stores nothing and records no audit event."""
    trip, scope = public_preview(session, subject, trip_id, candidate)
    return _future_disclosure(trip, scope)


def public_preview_navigation(
    session: Session, subject: str, trip_id: Identifier, local_id: str, candidate: ShareScopeInput | None = None
) -> str:
    trip, scope = public_preview(session, subject, trip_id, candidate)
    return navigation_target(trip, scope, local_id)


def inspect_public_preview_file(
    session: Session, subject: str, trip_id: Identifier, local_id: str, storage: ObjectStorage
) -> dict[str, str | None]:
    trip, scope = public_preview(session, subject, trip_id)
    return inspect_delivered_file(trip, scope, local_id, storage)


def publish_public_projection(session: Session, subject: str, trip_id: Identifier) -> PublicProjectionStatusResponse:
    owned_trip(session, trip_id, subject)
    surface = get_or_create_surface(session, trip_id)
    surface.state = SurfaceState.PUBLISHED
    record_audit_event(
        session,
        trip_id=trip_id,
        actor_subject=subject,
        kind=AuditEventKind.PUBLIC_PROJECTION_PUBLISH,
        target_type=AuditTargetType.PUBLIC_SURFACE,
        target_id=surface.trip_id,
        details={"scope_version": scope_fingerprint(surface.scope)},
    )
    return public_status(session, surface)


def unpublish_public_projection(
    session: Session, subject: str, trip_id: Identifier, payload: AuditReasonInput | None = None
) -> PublicProjectionStatusResponse:
    lock_trip(session, trip_id, subject)
    owned_trip(session, trip_id, subject)
    surface = session.get(PublicSurface, trip_id)
    if surface is None or surface.state != SurfaceState.PUBLISHED:
        raise Conflict("This trip is not published", code="this_trip_is_not_published")
    surface.state = SurfaceState.UNPUBLISHED
    details: dict = {"scope_version": scope_fingerprint(surface.scope)}
    if payload is not None and payload.reason:
        details["reason"] = payload.reason
    record_audit_event(
        session,
        trip_id=trip_id,
        actor_subject=subject,
        kind=AuditEventKind.PUBLIC_PROJECTION_UNPUBLISH,
        target_type=AuditTargetType.PUBLIC_SURFACE,
        target_id=surface.trip_id,
        details=details,
    )
    return public_status(session, surface)


# --- Named unlisted share links --------------------------------------------------
#
# `state` gates whether the token works at all. While `active`, `scope` is
# likewise live: editing it takes effect immediately for anyone already
# holding the token. `activate` is the only step that mints the URL; `rotate`
# remains useful on its own (a fresh URL for a suspected-leaked one) since
# scope changes no longer need it.


def expire_link(session: Session, link: ShareLink) -> None:
    """Record the active -> expired transition, stamping the audit event with the real expiry time rather than
    the time someone noticed. The caller commits."""
    link.state = LinkState.EXPIRED
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


def link_has_expired(link: ShareLink) -> bool:
    return link.expires_at is not None and aware_utc(link.expires_at) <= datetime.now(UTC)


def settle_expired(session: Session, links: list[ShareLink]) -> None:
    """Lazy write for owner reads: an active link past `expires_at` is stored as expired the first time the owner
    (or a visitor) sees it. No sweep job runs."""
    for link in links:
        if link.state == LinkState.ACTIVE and link_has_expired(link):
            expire_link(session, link)


def owned_link(session: Session, subject: str, trip_id: Identifier, link_id: Identifier) -> ShareLink:
    owned_trip(session, trip_id, subject)
    link = session.scalar(select(ShareLink).where(ShareLink.id == link_id, ShareLink.trip_id == trip_id))
    if link is None:
        raise RecordNotFound("Share link not found")
    settle_expired(session, [link])
    return link


def create_share_link(
    session: Session, subject: str, trip_id: Identifier, payload: ShareLinkCreate
) -> ShareLinkResponse:
    lock_trip(session, trip_id, subject)
    scope = apply_scope(session, subject, trip_id, payload.scope, None)
    link = ShareLink(trip_id=trip_id, label=payload.label, series_id="", scope=scope, state=LinkState.DRAFT)
    session.add(link)
    session.flush()
    link.series_id = link.id
    record_audit_event(
        session,
        trip_id=trip_id,
        actor_subject=subject,
        kind=AuditEventKind.SHARE_LINK_CREATE,
        target_type=AuditTargetType.SHARE_LINK,
        target_id=link.id,
        details={"label": link.label, "scope_version": scope_fingerprint(scope)},
    )
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    if payload.preset is not None:
        # In the same transaction, through the same code as the apply route: a new link has received nothing yet.
        apply_preset(
            session, trip, subject, link, payload.preset, fingerprint=None, confirm_widening=False, claim=None, new=True
        )
    return link_response(link, trip)


def list_audit_events(session: Session, subject: str, trip_id: Identifier) -> list[AuditEvent]:
    owned_trip(session, trip_id, subject)
    return list(
        session.scalars(select(AuditEvent).where(AuditEvent.trip_id == trip_id).order_by(AuditEvent.occurred_at.desc()))
    )


def list_share_links(session: Session, subject: str, trip_id: Identifier) -> list[ShareLinkResponse]:
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    links = list(
        session.scalars(select(ShareLink).where(ShareLink.trip_id == trip_id).order_by(ShareLink.created_at.desc()))
    )
    settle_expired(session, links)
    return [link_response(link, trip) for link in links]


def get_share_link(session: Session, subject: str, trip_id: Identifier, link_id: Identifier) -> ShareLinkResponse:
    link = owned_link(session, subject, trip_id, link_id)
    return link_response(link, owned_trip(session, trip_id, subject, load_relations=True))


def update_share_link(
    session: Session,
    subject: str,
    trip_id: Identifier,
    link_id: Identifier,
    payload: ShareLinkUpdate,
    if_match: str | None = None,
) -> ShareLinkResponse:
    link = owned_link(session, subject, trip_id, link_id)
    if link.state not in EDITABLE_LINK_STATES:
        raise Conflict("A revoked or expired link cannot be edited", code="a_revoked_or_expired_link_cannot_be_edited")
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    new_scope = apply_scope(session, subject, trip_id, payload.scope, link.scope) if payload.scope is not None else None
    if new_scope is not None:
        # Before the revision is claimed: a refused widening changes nothing, not even the revision.
        refuse_unacknowledged_widening(
            trip, link.scope, new_scope, live=link.state == LinkState.ACTIVE, confirmed=payload.confirm_widening
        )
    claim_revision(session, link, if_match)
    if payload.label is not None:
        link.label = payload.label
    if new_scope is not None:
        previous = link.scope
        link.scope = new_scope
        # A draft link delivers nothing yet; its activation records the scope.
        if link.state == LinkState.ACTIVE and scope_fingerprint(previous) != scope_fingerprint(new_scope):
            record_audit_event(
                session,
                trip_id=trip_id,
                actor_subject=subject,
                kind=AuditEventKind.SHARE_LINK_SCOPE_CHANGE,
                target_type=AuditTargetType.SHARE_LINK,
                target_id=link.id,
                details=scope_change_details(trip, previous, new_scope),
            )
    session.flush()
    return link_response(link, trip)


def review_exclusions(
    session: Session, subject: str, trip_id: Identifier, payload: ExclusionReviewRequest
) -> ExclusionReview:
    """What these exclusions would hide from a hidden link or collection member, before anything is saved.

    Lists the records the public baseline reaches (the ones an audience may exclude), each exclusion that
    applies with the records it also hides (an excluded area hides the locations in it and the visits, stays,
    routes and updates that use it; an excluded update hides its photos), and how many stored entries are
    stale. ``items`` is the audience's own custom selection, so the counts are what its visitors would lose.
    Stores nothing and records no audit event."""
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    scope = {
        "items": [item.model_dump(mode="json") for item in payload.items],
        "exclude": [item.model_dump(mode="json") for item in payload.exclude],
    }
    return exclusion_review(trip, scope)


def link_preview(
    session: Session,
    subject: str,
    trip_id: Identifier,
    link_id: Identifier,
    candidate: ShareScopeInput | None = None,
) -> tuple[Trip, ShareLink, dict]:
    """The trip, the link and the scope a preview of the link renders: the candidate, else the saved scope."""
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    link = owned_link(session, subject, trip_id, link_id)
    return trip, link, preview_scope(session, subject, trip_id, candidate, link.scope)


def preview_share_link(
    session: Session,
    subject: str,
    trip_id: Identifier,
    link_id: Identifier,
    candidate: ShareScopeInput | None = None,
) -> dict:
    trip, link, scope = link_preview(session, subject, trip_id, link_id, candidate)
    document = render_projection(trip, scope, "travel/unlisted-trip@1")
    if positions := current_for_audience(session, trip_id, link_id):
        document["current_locations"] = positions
    return document


def review_link_future(
    session: Session,
    subject: str,
    trip_id: Identifier,
    link_id: Identifier,
    candidate: ShareScopeInput | None = None,
) -> FutureDisclosure:
    """The same review as the public one, for a hidden link's candidate scope. Stores nothing."""
    trip, _link, scope = link_preview(session, subject, trip_id, link_id, candidate)
    return _future_disclosure(trip, scope)


def share_preview_navigation(
    session: Session,
    subject: str,
    trip_id: Identifier,
    link_id: Identifier,
    local_id: str,
    candidate: ShareScopeInput | None = None,
) -> str:
    trip, _link, scope = link_preview(session, subject, trip_id, link_id, candidate)
    return navigation_target(trip, scope, local_id)


def inspect_share_preview_file(
    session: Session, subject: str, trip_id: Identifier, link_id: Identifier, local_id: str, storage: ObjectStorage
) -> dict[str, str | None]:
    trip, _link, scope = link_preview(session, subject, trip_id, link_id)
    return inspect_delivered_file(trip, scope, local_id, storage)


def _activate_link(link: ShareLink, expires_in_days: int | None) -> str:
    token = generate_token()
    now = datetime.now(UTC)
    link.token = token
    link.token_verifier = verifier_for(token)
    link.expires_at = now + timedelta(days=expires_in_days) if expires_in_days is not None else None
    link.state = LinkState.ACTIVE
    link.activated_at = now
    return token


def activate_share_link(
    session: Session, subject: str, trip_id: Identifier, link_id: Identifier, payload: ShareLinkActivateRequest
) -> ShareLinkActivateResponse:
    lock_trip(session, trip_id, subject)
    link = owned_link(session, subject, trip_id, link_id)
    if link.state != LinkState.DRAFT:
        raise Conflict("Only a draft link can be activated", code="only_a_draft_link_can_be_activated")
    _activate_link(link, payload.expires_in_days)
    details: dict = {
        "scope_version": scope_fingerprint(link.scope),
        "expires_at": link.expires_at.isoformat() if link.expires_at else None,
    }
    if payload.reason:
        details["reason"] = payload.reason
    record_audit_event(
        session,
        trip_id=trip_id,
        actor_subject=subject,
        kind=AuditEventKind.SHARE_LINK_ACTIVATE,
        target_type=AuditTargetType.SHARE_LINK,
        target_id=link.id,
        details=details,
    )
    return activation_response(link, owned_trip(session, trip_id, subject, load_relations=True))


def revoke_share_link(
    session: Session,
    subject: str,
    trip_id: Identifier,
    link_id: Identifier,
    payload: AuditReasonInput | None = None,
) -> ShareLinkResponse:
    lock_trip(session, trip_id, subject)
    link = owned_link(session, subject, trip_id, link_id)
    if link.state != LinkState.ACTIVE:
        raise Conflict("Only an active link can be revoked", code="only_an_active_link_can_be_revoked")
    link.state = LinkState.REVOKED
    link.token = None
    link.revoked_at = datetime.now(UTC)
    details: dict = {}
    if payload is not None and payload.reason:
        details["reason"] = payload.reason
    record_audit_event(
        session,
        trip_id=trip_id,
        actor_subject=subject,
        kind=AuditEventKind.SHARE_LINK_REVOKE,
        target_type=AuditTargetType.SHARE_LINK,
        target_id=link.id,
        details=details,
    )
    return link_response(link, owned_trip(session, trip_id, subject, load_relations=True))


def rotate_share_link(
    session: Session, subject: str, trip_id: Identifier, link_id: Identifier, payload: ShareLinkActivateRequest
) -> ShareLinkActivateResponse:
    lock_trip(session, trip_id, subject)
    old_link = owned_link(session, subject, trip_id, link_id)
    if old_link.state != LinkState.ACTIVE:
        raise Conflict("Only an active link can be rotated", code="only_an_active_link_can_be_rotated")
    old_link.state = LinkState.REVOKED
    old_link.token = None
    old_link.revoked_at = datetime.now(UTC)

    new_link = ShareLink(
        trip_id=trip_id,
        label=old_link.label,
        series_id=old_link.series_id or old_link.id,
        scope=old_link.scope,
        state=LinkState.DRAFT,
        # The same scope under a new URL: the display label carries over with it.
        applied_preset=old_link.applied_preset,
        applied_preset_at=old_link.applied_preset_at,
    )
    session.add(new_link)
    session.flush()
    _activate_link(new_link, payload.expires_in_days)
    details: dict = {
        "predecessor_id": old_link.id,
        "scope_version": scope_fingerprint(new_link.scope),
        "expires_at": new_link.expires_at.isoformat() if new_link.expires_at else None,
    }
    if payload.reason:
        details["reason"] = payload.reason
    record_audit_event(
        session,
        trip_id=trip_id,
        actor_subject=subject,
        kind=AuditEventKind.SHARE_LINK_ROTATE,
        target_type=AuditTargetType.SHARE_LINK,
        target_id=new_link.id,
        details=details,
    )
    return activation_response(new_link, owned_trip(session, trip_id, subject, load_relations=True))


def manage_feed(
    session: Session,
    subject: str,
    trip_id: Identifier,
    link_id: Identifier,
    action: str,
    payload: FeedEnableRequest,
) -> ShareLinkResponse:
    """Enable, rotate or revoke the Atom feed capability of an active link."""
    link = owned_link(session, subject, trip_id, link_id)
    session.refresh(link, with_for_update=True)
    if action not in {"enable", "rotate", "revoke"}:
        raise RecordNotFound("Not found")
    if action != "revoke" and (link.state != LinkState.ACTIVE or link_has_expired(link)):
        raise Conflict("Link is not active", code="invalid_state")
    if (action == "enable" and link.feed_token) or (action != "enable" and not link.feed_token):
        raise Conflict("Feed state conflict", code="invalid_state")
    if action != "revoke" and not payload.acknowledge_copies:
        raise Refusal("Acknowledgement required", code="invalid_input")
    token = generate_token() if action != "revoke" else None
    link.feed_token = token
    link.feed_verifier = verifier_for(token) if token else None
    link.feed_expires_at = (
        datetime.now(UTC) + timedelta(days=payload.expires_in_days)
        if token and payload.expires_in_days is not None
        else None
    )
    record_audit_event(
        session,
        trip_id=trip_id,
        actor_subject=subject,
        kind=AuditEventKind(f"feed.{action}"),
        target_type=AuditTargetType.SHARE_LINK,
        target_id=link.id,
        details={},
    )
    return link_response(link, owned_trip(session, trip_id, subject, load_relations=True))
