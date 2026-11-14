"""The owner's public view and hidden (named share) links: publishing and the link lifecycle.

What every audience shares (previews, the scope edit, the revision claim) is in ``services.audiences``; this module
keeps what belongs to these two kinds alone. Shared by the HTTP routers and the MCP tools. Nothing here commits: a
reader that finds a link past its ``expires_at`` marks it expired in the caller's transaction, so the caller commits
after every call (reads too). Anonymous delivery lives in ``routers/publication.py``; it only reads what these
functions write.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..audience import LinkAudience, has_expired
from ..audit import record_audit_event, scope_fingerprint
from ..capability import generate_token, verifier_for
from ..errors import Conflict, RecordNotFound, Refusal
from ..exclusion_review import exclusion_review
from ..models import (
    AuditEvent,
    AuditEventKind,
    AuditTargetType,
    LinkState,
    ShareLink,
    SurfaceState,
    Trip,
)
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
from . import audiences
from .live_location import forget_audience
from .sharing import (
    activation_response,
    get_or_create_surface,
    link_response,
    mint_capability,
    public_status,
    settle_expired,
)
from .trips import lock_trip, owned_trip

# --- The public view ---------------------------------------------------------------
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
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    audience = audiences.saved_public_audience(session, trip_id)
    audiences.edit_scope(session, subject, audience, trip, payload, if_match=if_match)
    session.flush()
    return public_status(session, audience.row)


def public_preview(
    session: Session, subject: str, trip_id: Identifier, candidate: ShareScopeInput | None = None
) -> tuple[Trip, dict]:
    """The trip and the scope a preview of the public view renders: the candidate, else the saved scope."""
    return audiences.preview_scope(session, subject, audiences.public_audience(session, trip_id), candidate)


def preview_public_projection(
    session: Session, subject: str, trip_id: Identifier, candidate: ShareScopeInput | None = None
) -> dict:
    return audiences.preview_document(session, subject, audiences.public_audience(session, trip_id), candidate)


def review_public_future(
    session: Session, subject: str, trip_id: Identifier, candidate: ShareScopeInput | None = None
) -> FutureDisclosure:
    """What the candidate public view would show of a trip that has not started yet (``audiences.review_future``)."""
    return audiences.review_future(session, subject, audiences.public_audience(session, trip_id), candidate)


def public_preview_navigation(
    session: Session, subject: str, trip_id: Identifier, local_id: str, candidate: ShareScopeInput | None = None
) -> str:
    return audiences.preview_navigation_target(
        session, subject, audiences.public_audience(session, trip_id), local_id, candidate
    )


def inspect_public_preview_file(
    session: Session, subject: str, trip_id: Identifier, local_id: str, storage: ObjectStorage
) -> dict[str, str | None]:
    return audiences.inspect_preview_file(
        session, subject, audiences.public_audience(session, trip_id), local_id, storage
    )


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
    audience = audiences.public_audience(session, trip_id)
    surface = audience.surface
    if surface is None or surface.state != SurfaceState.PUBLISHED:
        raise Conflict("This trip is not published", code="this_trip_is_not_published")
    surface.state = SurfaceState.UNPUBLISHED
    forget_audience(session, audience)
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


# --- Hidden (named share) links ----------------------------------------------------
#
# `state` gates whether the token works at all. While `active`, `scope` is
# likewise live: editing it takes effect immediately for anyone already
# holding the token. `activate` is the only step that mints the URL; `rotate`
# remains useful on its own (a fresh URL for a suspected-leaked one) since
# scope changes no longer need it.


def owned_link(session: Session, subject: str, trip_id: Identifier, link_id: Identifier) -> ShareLink:
    return audiences.owned_link(session, subject, trip_id, link_id).link


def create_share_link(
    session: Session, subject: str, trip_id: Identifier, payload: ShareLinkCreate
) -> ShareLinkResponse:
    lock_trip(session, trip_id, subject)
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    scope = audiences.new_scope(trip, payload.scope, None, can_exclude=True)
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
    if payload.preset is not None:
        # In the same transaction, through the same code as the apply route: a new link has received nothing yet.
        apply_preset(
            session,
            trip,
            subject,
            LinkAudience(link),
            payload.preset,
            fingerprint=None,
            confirm_widening=False,
            claim=None,
            new=True,
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
    audience = audiences.owned_link(session, subject, trip_id, link_id)
    audiences.require_editable(audience)
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    audiences.edit_scope(
        session, subject, audience, trip, payload.scope, if_match=if_match, confirm_widening=payload.confirm_widening
    )
    if payload.label is not None:
        audience.link.label = payload.label
    session.flush()
    return link_response(audience.link, trip)


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
) -> tuple[Trip, dict]:
    """The trip and the scope a preview of the link renders: the candidate, else the saved scope."""
    return audiences.preview_scope(
        session, subject, audiences.owned_link(session, subject, trip_id, link_id), candidate
    )


def preview_share_link(
    session: Session,
    subject: str,
    trip_id: Identifier,
    link_id: Identifier,
    candidate: ShareScopeInput | None = None,
) -> dict:
    return audiences.preview_document(
        session, subject, audiences.owned_link(session, subject, trip_id, link_id), candidate
    )


def review_link_future(
    session: Session,
    subject: str,
    trip_id: Identifier,
    link_id: Identifier,
    candidate: ShareScopeInput | None = None,
) -> FutureDisclosure:
    """The same review as the public one, for a hidden link's candidate scope. Stores nothing."""
    return audiences.review_future(
        session, subject, audiences.owned_link(session, subject, trip_id, link_id), candidate
    )


def share_preview_navigation(
    session: Session,
    subject: str,
    trip_id: Identifier,
    link_id: Identifier,
    local_id: str,
    candidate: ShareScopeInput | None = None,
) -> str:
    return audiences.preview_navigation_target(
        session, subject, audiences.owned_link(session, subject, trip_id, link_id), local_id, candidate
    )


def inspect_share_preview_file(
    session: Session, subject: str, trip_id: Identifier, link_id: Identifier, local_id: str, storage: ObjectStorage
) -> dict[str, str | None]:
    return audiences.inspect_preview_file(
        session, subject, audiences.owned_link(session, subject, trip_id, link_id), local_id, storage
    )


def activate_share_link(
    session: Session, subject: str, trip_id: Identifier, link_id: Identifier, payload: ShareLinkActivateRequest
) -> ShareLinkActivateResponse:
    lock_trip(session, trip_id, subject)
    link = owned_link(session, subject, trip_id, link_id)
    if link.state != LinkState.DRAFT:
        raise Conflict("Only a draft link can be activated", code="only_a_draft_link_can_be_activated")
    mint_capability(link, payload.expires_in_days)
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
    forget_audience(session, LinkAudience(link))
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
    forget_audience(session, LinkAudience(old_link))
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
    mint_capability(new_link, payload.expires_in_days)
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
    if action != "revoke" and (link.state != LinkState.ACTIVE or has_expired(link.expires_at)):
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
