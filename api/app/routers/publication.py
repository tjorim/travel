from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..audit import SYSTEM_ACTOR, record_audit_event, scope_fingerprint
from ..auth import current_subject
from ..capability import generate_token, verifier_for
from ..database import get_session
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
from ..navigation import scoped_navigation_url
from ..projection import ScopeError, render_projection, validate_scope
from ..schemas import (
    AuditEventResponse,
    AuditReasonInput,
    ProjectionDocument,
    PublicProjectionStatusResponse,
    ShareLinkActivateRequest,
    ShareLinkActivateResponse,
    ShareLinkCreate,
    ShareLinkResponse,
    ShareLinkUpdate,
    ShareScopeInput,
)
from .trips import owned_trip, trip_query

router = APIRouter(prefix="/trips/{trip_id}", tags=["publication"])
delivery_router = APIRouter(tags=["sharing-delivery"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def _aware_utc(value: datetime) -> datetime:
    # SQLite (used in tests) drops tzinfo on round-trip even for a
    # DateTime(timezone=True) column; Postgres (production) preserves it.
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


UNLISTED_HEADERS = {
    "Cache-Control": "no-store, private",
    "X-Robots-Tag": "noindex, noarchive",
    "Referrer-Policy": "no-referrer",
}


def _apply_scope(session: Session, trip_id: str, subject: str, scope: ShareScopeInput) -> dict:
    trip = owned_trip(session, trip_id, subject)
    scope_dict = scope.model_dump()
    try:
        validate_scope(trip, scope_dict)
    except ScopeError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
    return scope_dict


def _get_or_create_surface(session: Session, trip_id: str) -> PublicSurface:
    surface = session.get(PublicSurface, trip_id)
    if surface is None:
        surface = PublicSurface(trip_id=trip_id, scope={})
        session.add(surface)
        session.flush()
    return surface


# --- Owner: public follower view -------------------------------------------------
#
# `state` is the only gate: it controls whether this trip is served publicly
# at all. While published (or before first publishing), `scope` is a live
# field — editing it takes effect immediately, and delivery always renders
# current trip content filtered to it. There is no frozen snapshot to
# republish: widening scope is a live edit, same as narrowing it.


@router.put("/public-projection", response_model=PublicProjectionStatusResponse)
def set_public_projection_scope(
    trip_id: str, payload: ShareScopeInput, session: SessionDep, subject: SubjectDep
) -> PublicProjectionStatusResponse:
    scope = _apply_scope(session, trip_id, subject, payload)
    surface = _get_or_create_surface(session, trip_id)
    surface.scope = scope
    session.commit()
    return _public_status(surface)


@router.post("/public-projection/preview", response_model=ProjectionDocument)
def preview_public_projection(trip_id: str, session: SessionDep, subject: SubjectDep, response: Response) -> dict:
    trip = owned_trip(session, trip_id, subject)
    surface = _get_or_create_surface(session, trip_id)
    response.headers["Cache-Control"] = "no-store"
    return render_projection(trip, surface.scope, "travel/public-trip@1")


@router.post("/public-projection/publish", response_model=PublicProjectionStatusResponse)
def publish_public_projection(trip_id: str, session: SessionDep, subject: SubjectDep) -> PublicProjectionStatusResponse:
    owned_trip(session, trip_id, subject)
    surface = _get_or_create_surface(session, trip_id)
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
    session.commit()
    return _public_status(surface)


@router.post("/public-projection/unpublish", response_model=PublicProjectionStatusResponse)
def unpublish_public_projection(
    trip_id: str, session: SessionDep, subject: SubjectDep, payload: AuditReasonInput = AuditReasonInput()
) -> PublicProjectionStatusResponse:
    owned_trip(session, trip_id, subject)
    surface = session.get(PublicSurface, trip_id)
    if surface is None or surface.state != SurfaceState.PUBLISHED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This trip is not published")
    surface.state = SurfaceState.UNPUBLISHED
    details: dict = {"scope_version": scope_fingerprint(surface.scope)}
    if payload.reason:
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
    session.commit()
    return _public_status(surface)


@router.get("/public-projection", response_model=PublicProjectionStatusResponse)
def get_public_projection_status(trip_id: str, session: SessionDep, subject: SubjectDep) -> PublicProjectionStatusResponse:
    owned_trip(session, trip_id, subject)
    return _public_status(_get_or_create_surface(session, trip_id))


def _public_status(surface: PublicSurface) -> PublicProjectionStatusResponse:
    return PublicProjectionStatusResponse(
        trip_id=surface.trip_id, scope=surface.scope, surface_state=surface.state, slug=surface.slug
    )


# --- Owner: named unlisted share links --------------------------------------------
#
# `state` gates whether the token works at all. While `active`, `scope` is
# likewise live: editing it takes effect immediately for anyone already
# holding the token. `activate` remains a distinct, one-time action because
# it is the only step that mints the token itself; `rotate` remains useful on
# its own (a fresh token for a suspected-leaked one) since scope changes no
# longer need it.

EDITABLE_LINK_STATES = (LinkState.DRAFT, LinkState.ACTIVE)


def owned_link(session: Session, trip_id: str, subject: str, link_id: str) -> ShareLink:
    owned_trip(session, trip_id, subject)
    link = session.scalar(select(ShareLink).where(ShareLink.id == link_id, ShareLink.trip_id == trip_id))
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    return link


@router.post("/share-links", response_model=ShareLinkResponse, status_code=status.HTTP_201_CREATED)
def create_share_link(trip_id: str, payload: ShareLinkCreate, session: SessionDep, subject: SubjectDep) -> ShareLink:
    scope = _apply_scope(session, trip_id, subject, payload.scope)
    link = ShareLink(trip_id=trip_id, label=payload.label, scope=scope, state=LinkState.DRAFT)
    session.add(link)
    session.flush()
    record_audit_event(
        session,
        trip_id=trip_id,
        actor_subject=subject,
        kind=AuditEventKind.SHARE_LINK_CREATE,
        target_type=AuditTargetType.SHARE_LINK,
        target_id=link.id,
        details={"label": link.label, "scope_version": scope_fingerprint(scope)},
    )
    session.commit()
    return link


@router.get("/audit-events", response_model=list[AuditEventResponse])
def list_audit_events(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[AuditEvent]:
    owned_trip(session, trip_id, subject)
    return list(
        session.scalars(
            select(AuditEvent).where(AuditEvent.trip_id == trip_id).order_by(AuditEvent.occurred_at.desc())
        )
    )


@router.get("/share-links", response_model=list[ShareLinkResponse])
def list_share_links(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[ShareLink]:
    owned_trip(session, trip_id, subject)
    return list(
        session.scalars(select(ShareLink).where(ShareLink.trip_id == trip_id).order_by(ShareLink.created_at.desc()))
    )


@router.get("/share-links/{link_id}", response_model=ShareLinkResponse)
def get_share_link(trip_id: str, link_id: str, session: SessionDep, subject: SubjectDep) -> ShareLink:
    return owned_link(session, trip_id, subject, link_id)


@router.patch("/share-links/{link_id}", response_model=ShareLinkResponse)
def update_share_link(
    trip_id: str, link_id: str, payload: ShareLinkUpdate, session: SessionDep, subject: SubjectDep
) -> ShareLink:
    link = owned_link(session, trip_id, subject, link_id)
    if link.state not in EDITABLE_LINK_STATES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A revoked or expired link cannot be edited"
        )
    if payload.label is not None:
        link.label = payload.label
    if payload.scope is not None:
        link.scope = _apply_scope(session, trip_id, subject, payload.scope)
    session.commit()
    return link


@router.post("/share-links/{link_id}/preview", response_model=ProjectionDocument)
def preview_share_link(
    trip_id: str, link_id: str, session: SessionDep, subject: SubjectDep, response: Response
) -> dict:
    trip = owned_trip(session, trip_id, subject)
    link = owned_link(session, trip_id, subject, link_id)
    response.headers["Cache-Control"] = "no-store"
    return render_projection(trip, link.scope, "travel/unlisted-trip@1")


def _activate_link(link: ShareLink, expires_in_days: int) -> str:
    token = generate_token()
    now = datetime.now(UTC)
    link.token_verifier = verifier_for(token)
    link.expires_at = now + timedelta(days=expires_in_days)
    link.state = LinkState.ACTIVE
    link.activated_at = now
    return token


@router.post("/share-links/{link_id}/activate", response_model=ShareLinkActivateResponse)
def activate_share_link(
    trip_id: str, link_id: str, payload: ShareLinkActivateRequest, session: SessionDep, subject: SubjectDep
) -> ShareLinkActivateResponse:
    link = owned_link(session, trip_id, subject, link_id)
    if link.state != LinkState.DRAFT:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only a draft link can be activated")
    token = _activate_link(link, payload.expires_in_days)
    details: dict = {"scope_version": scope_fingerprint(link.scope), "expires_at": link.expires_at.isoformat()}
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
    session.commit()
    return ShareLinkActivateResponse(**ShareLinkResponse.model_validate(link).model_dump(), token=token)


@router.post("/share-links/{link_id}/revoke", response_model=ShareLinkResponse)
def revoke_share_link(
    trip_id: str, link_id: str, session: SessionDep, subject: SubjectDep, payload: AuditReasonInput = AuditReasonInput()
) -> ShareLink:
    link = owned_link(session, trip_id, subject, link_id)
    if link.state != LinkState.ACTIVE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only an active link can be revoked")
    link.state = LinkState.REVOKED
    link.revoked_at = datetime.now(UTC)
    details: dict = {}
    if payload.reason:
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
    session.commit()
    return link


@router.post("/share-links/{link_id}/rotate", response_model=ShareLinkActivateResponse)
def rotate_share_link(
    trip_id: str, link_id: str, payload: ShareLinkActivateRequest, session: SessionDep, subject: SubjectDep
) -> ShareLinkActivateResponse:
    old_link = owned_link(session, trip_id, subject, link_id)
    if old_link.state != LinkState.ACTIVE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only an active link can be rotated")
    old_link.state = LinkState.REVOKED
    old_link.revoked_at = datetime.now(UTC)

    new_link = ShareLink(trip_id=trip_id, label=old_link.label, scope=old_link.scope, state=LinkState.DRAFT)
    session.add(new_link)
    session.flush()
    token = _activate_link(new_link, payload.expires_in_days)
    details: dict = {
        "predecessor_id": old_link.id,
        "scope_version": scope_fingerprint(new_link.scope),
        "expires_at": new_link.expires_at.isoformat(),
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
    session.commit()
    return ShareLinkActivateResponse(**ShareLinkResponse.model_validate(new_link).model_dump(), token=token)


# --- Anonymous delivery -------------------------------------------------------------


@delivery_router.get("/public/trips/{slug}", response_model=ProjectionDocument)
def get_public_trip(slug: str, session: SessionDep, response: Response) -> dict:
    surface = session.scalar(select(PublicSurface).where(PublicSurface.slug == slug))
    if surface is None or surface.state != SurfaceState.PUBLISHED:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found", headers={"Cache-Control": "no-store"}
        )
    trip = session.scalar(trip_query().where(Trip.id == surface.trip_id))
    if trip is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found", headers={"Cache-Control": "no-store"}
        )
    # Scope edits and unpublishing must be visible on the next browser load.
    # A public intermediary cache would otherwise keep serving a withdrawn
    # projection without asking the API again.
    response.headers["Cache-Control"] = "no-store"
    return render_projection(trip, surface.scope, "travel/public-trip@1")


@delivery_router.get("/public/trips/{slug}/navigation/{local_id}", status_code=status.HTTP_302_FOUND)
def get_public_navigation(slug: str, local_id: str, session: SessionDep) -> RedirectResponse:
    surface = session.scalar(select(PublicSurface).where(PublicSurface.slug == slug))
    if surface is None or surface.state != SurfaceState.PUBLISHED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    trip = session.scalar(trip_query().where(Trip.id == surface.trip_id))
    target = scoped_navigation_url(trip, surface.scope, local_id) if trip is not None else None
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Navigation target not found")
    return RedirectResponse(target[0], status_code=status.HTTP_302_FOUND, headers={"Cache-Control": "no-store"})


@delivery_router.get("/shared/{token}", response_model=ProjectionDocument)
def get_shared_trip(token: str, session: SessionDep, response: Response) -> dict:
    # Headers are also attached to each HTTPException below: FastAPI's error
    # path builds its own response and does not carry over `response.headers`
    # mutations, and a not-found/expired/revoked link must be just as
    # uncacheable and unindexable as a valid one.
    not_found = HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Link not found", headers=UNLISTED_HEADERS
    )
    link = session.scalar(select(ShareLink).where(ShareLink.token_verifier == verifier_for(token)))
    if link is None or link.state != LinkState.ACTIVE:
        raise not_found
    if link.expires_at is not None and _aware_utc(link.expires_at) <= datetime.now(UTC):
        link.state = LinkState.EXPIRED
        record_audit_event(
            session,
            trip_id=link.trip_id,
            actor_subject=SYSTEM_ACTOR,
            kind=AuditEventKind.SHARE_LINK_EXPIRE,
            target_type=AuditTargetType.SHARE_LINK,
            target_id=link.id,
            details={},
        )
        session.commit()
        raise not_found
    trip = session.scalar(trip_query().where(Trip.id == link.trip_id))
    if trip is None:
        raise not_found
    for header, value in UNLISTED_HEADERS.items():
        response.headers[header] = value
    return render_projection(trip, link.scope, "travel/unlisted-trip@1")


@delivery_router.get("/shared/{token}/navigation/{local_id}", status_code=status.HTTP_302_FOUND)
def get_shared_navigation(token: str, local_id: str, session: SessionDep) -> RedirectResponse:
    not_found = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found", headers=UNLISTED_HEADERS)
    link = session.scalar(select(ShareLink).where(ShareLink.token_verifier == verifier_for(token)))
    if link is None or link.state != LinkState.ACTIVE:
        raise not_found
    if link.expires_at is not None and _aware_utc(link.expires_at) <= datetime.now(UTC):
        link.state = LinkState.EXPIRED
        record_audit_event(
            session,
            trip_id=link.trip_id,
            actor_subject=SYSTEM_ACTOR,
            kind=AuditEventKind.SHARE_LINK_EXPIRE,
            target_type=AuditTargetType.SHARE_LINK,
            target_id=link.id,
            details={},
        )
        session.commit()
        raise not_found
    trip = session.scalar(trip_query().where(Trip.id == link.trip_id))
    target = scoped_navigation_url(trip, link.scope, local_id) if trip is not None else None
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Navigation target not found", headers=UNLISTED_HEADERS)
    return RedirectResponse(target[0], status_code=status.HTTP_302_FOUND, headers=UNLISTED_HEADERS)
