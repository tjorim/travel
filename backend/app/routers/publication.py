from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..audit import SYSTEM_ACTOR, record_audit_event, scope_fingerprint
from ..auth import current_subject
from ..capability import generate_token, verifier_for
from ..database import get_session
from ..errors import ApiException, service_exception
from ..media.ranges import media_response
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
from ..projection import (
    ScopeError,
    render_projection,
    scoped_file,
    scoped_navigation_url,
    shared_trip_dates,
    validate_scope,
)
from ..ratelimit import delivery_limit, limiter, retry_after_seconds, shared_link_limit
from ..schemas import (
    AuditEventResponse,
    AuditReasonInput,
    ProjectionDocument,
    PublicProjectionStatusResponse,
    PublicTripCard,
    ShareLinkActivateRequest,
    ShareLinkActivateResponse,
    ShareLinkCreate,
    ShareLinkResponse,
    ShareLinkUpdate,
    ShareScopeInput,
)
from ..storage import ObjectStorage, get_storage
from .trips import owned_trip, trip_query

router = APIRouter(prefix="/trips/{trip_id}", tags=["publication"])
delivery_router = APIRouter(tags=["sharing-delivery"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
StorageDep = Annotated[ObjectStorage, Depends(get_storage)]


def _aware_utc(value: datetime) -> datetime:
    # SQLite (used in tests) drops tzinfo on round-trip even for a
    # DateTime(timezone=True) column; Postgres (production) preserves it.
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


UNLISTED_HEADERS = {
    "Cache-Control": "no-store, private",
    "X-Robots-Tag": "noindex, noarchive",
    "Referrer-Policy": "no-referrer",
}


async def delivery_rate_limit_handler(request: Request, error: RateLimitExceeded) -> JSONResponse:
    """The 429 of a visitor delivery route: a fixed body that never names the route's token.

    An unlisted-link response carries the same privacy headers as its 404, so a throttled probe stays
    uncacheable and unindexable and says nothing about whether the token exists.
    """
    headers = UNLISTED_HEADERS if request.url.path.startswith("/api/shared/") else {"Cache-Control": "no-store"}
    descriptor = {"code": "rate_limited", "params": {}, "path": []}
    return JSONResponse(
        {"detail": "Too many requests", "errors": [descriptor]},
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        headers={**headers, "Retry-After": str(retry_after_seconds(request, error))},
    )


def _apply_scope(session: Session, trip_id: str, subject: str, scope: ShareScopeInput) -> dict:
    trip = owned_trip(session, trip_id, subject)
    scope_dict = scope.model_dump()
    try:
        validate_scope(trip, scope_dict)
    except ScopeError as error:
        raise service_exception(status.HTTP_422_UNPROCESSABLE_CONTENT, error) from error
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


@router.get("/public-projection/preview/files/{local_id}")
def preview_public_file(
    trip_id: str, local_id: str, session: SessionDep, subject: SubjectDep, storage: StorageDep, request: Request
) -> Response:
    trip = owned_trip(session, trip_id, subject)
    surface = session.get(PublicSurface, trip_id)
    return _file_response(trip, surface.scope if surface else {}, local_id, storage, UNLISTED_HEADERS, request)


@router.get("/public-projection/preview/navigation/{local_id}")
def preview_public_navigation(trip_id: str, local_id: str, session: SessionDep, subject: SubjectDep) -> JSONResponse:
    trip = owned_trip(session, trip_id, subject)
    surface = session.get(PublicSurface, trip_id)
    return _preview_navigation(trip, surface.scope if surface else {}, local_id)


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
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT, detail="This trip is not published", code="this_trip_is_not_published"
        )
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
def get_public_projection_status(
    trip_id: str, session: SessionDep, subject: SubjectDep
) -> PublicProjectionStatusResponse:
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
# holding the token. `activate` is the only step that mints the URL; `rotate`
# remains useful on its own (a fresh URL for a suspected-leaked one) since
# scope changes no longer need it.

EDITABLE_LINK_STATES = (LinkState.DRAFT, LinkState.ACTIVE)


def owned_link(session: Session, trip_id: str, subject: str, link_id: str) -> ShareLink:
    owned_trip(session, trip_id, subject)
    link = session.scalar(select(ShareLink).where(ShareLink.id == link_id, ShareLink.trip_id == trip_id))
    if link is None:
        raise ApiException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found", code="not_found")
    return link


@router.post("/share-links", response_model=ShareLinkResponse, status_code=status.HTTP_201_CREATED)
def create_share_link(trip_id: str, payload: ShareLinkCreate, session: SessionDep, subject: SubjectDep) -> ShareLink:
    scope = _apply_scope(session, trip_id, subject, payload.scope)
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
    session.commit()
    return link


@router.get("/audit-events", response_model=list[AuditEventResponse])
def list_audit_events(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[AuditEvent]:
    owned_trip(session, trip_id, subject)
    return list(
        session.scalars(select(AuditEvent).where(AuditEvent.trip_id == trip_id).order_by(AuditEvent.occurred_at.desc()))
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
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A revoked or expired link cannot be edited",
            code="a_revoked_or_expired_link_cannot_be_edited",
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


@router.get("/share-links/{link_id}/preview/files/{local_id}")
def preview_share_file(
    trip_id: str,
    link_id: str,
    local_id: str,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    request: Request,
) -> Response:
    trip = owned_trip(session, trip_id, subject)
    link = owned_link(session, trip_id, subject, link_id)
    return _file_response(trip, link.scope, local_id, storage, UNLISTED_HEADERS, request)


@router.get("/share-links/{link_id}/preview/navigation/{local_id}")
def preview_share_navigation(
    trip_id: str, link_id: str, local_id: str, session: SessionDep, subject: SubjectDep
) -> JSONResponse:
    trip = owned_trip(session, trip_id, subject)
    link = owned_link(session, trip_id, subject, link_id)
    return _preview_navigation(trip, link.scope, local_id)


def _preview_navigation(trip: Trip, scope: dict, local_id: str) -> JSONResponse:
    target = scoped_navigation_url(trip, scope, local_id)
    if target is None:
        raise ApiException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Navigation target not found",
            headers=UNLISTED_HEADERS,
            code="not_found",
        )
    return JSONResponse({"url": target}, headers=UNLISTED_HEADERS)


def _activate_link(link: ShareLink, expires_in_days: int | None) -> str:
    token = generate_token()
    now = datetime.now(UTC)
    link.token = token
    link.token_verifier = verifier_for(token)
    link.expires_at = now + timedelta(days=expires_in_days) if expires_in_days is not None else None
    link.state = LinkState.ACTIVE
    link.activated_at = now
    return token


@router.post("/share-links/{link_id}/activate", response_model=ShareLinkActivateResponse)
def activate_share_link(
    trip_id: str, link_id: str, payload: ShareLinkActivateRequest, session: SessionDep, subject: SubjectDep
) -> ShareLinkActivateResponse:
    link = owned_link(session, trip_id, subject, link_id)
    if link.state != LinkState.DRAFT:
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only a draft link can be activated",
            code="only_a_draft_link_can_be_activated",
        )
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
    session.commit()
    return ShareLinkActivateResponse.model_validate(link)


@router.post("/share-links/{link_id}/revoke", response_model=ShareLinkResponse)
def revoke_share_link(
    trip_id: str, link_id: str, session: SessionDep, subject: SubjectDep, payload: AuditReasonInput = AuditReasonInput()
) -> ShareLink:
    link = owned_link(session, trip_id, subject, link_id)
    if link.state != LinkState.ACTIVE:
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only an active link can be revoked",
            code="only_an_active_link_can_be_revoked",
        )
    link.state = LinkState.REVOKED
    link.token = None
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
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only an active link can be rotated",
            code="only_an_active_link_can_be_rotated",
        )
    old_link.state = LinkState.REVOKED
    old_link.token = None
    old_link.revoked_at = datetime.now(UTC)

    new_link = ShareLink(
        trip_id=trip_id,
        label=old_link.label,
        series_id=old_link.series_id or old_link.id,
        scope=old_link.scope,
        state=LinkState.DRAFT,
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
    session.commit()
    return ShareLinkActivateResponse.model_validate(new_link)


# --- Anonymous delivery -------------------------------------------------------------


@delivery_router.get("/public/trips", response_model=list[PublicTripCard])
@limiter.shared_limit(delivery_limit, scope="public-trip")
def list_public_trips(request: Request, session: SessionDep, response: Response) -> list[PublicTripCard]:
    # Select only published surfaces. Card text is separately gated by the
    # current scope, just as it is on the individual visitor page.
    rows = session.execute(
        select(PublicSurface, Trip)
        .join(Trip, Trip.id == PublicSurface.trip_id)
        .where(PublicSurface.state == SurfaceState.PUBLISHED)
        .order_by(PublicSurface.created_at.desc(), PublicSurface.slug)
    ).all()
    response.headers["Cache-Control"] = "no-store"
    return [
        PublicTripCard(
            slug=surface.slug,
            title=trip.title if surface.scope.get("trip", {}).get("title", True) else None,
            summary=trip.summary if surface.scope.get("trip", {}).get("summary", True) else None,
            dates=shared_trip_dates(trip, surface.scope),
        )
        for surface, trip in rows
    ]


@delivery_router.get("/public/trips/{slug}", response_model=ProjectionDocument)
@limiter.shared_limit(delivery_limit, scope="public-trip")
def get_public_trip(request: Request, slug: str, session: SessionDep, response: Response) -> dict:
    surface = session.scalar(select(PublicSurface).where(PublicSurface.slug == slug))
    if surface is None or surface.state != SurfaceState.PUBLISHED:
        raise ApiException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found",
            headers={"Cache-Control": "no-store"},
            code="not_found",
        )
    trip = session.scalar(trip_query().where(Trip.id == surface.trip_id))
    if trip is None:
        raise ApiException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found",
            headers={"Cache-Control": "no-store"},
            code="not_found",
        )
    # Scope edits and unpublishing must be visible on the next browser load.
    # A public intermediary cache would otherwise keep serving a withdrawn
    # projection without asking the API again.
    response.headers["Cache-Control"] = "no-store"
    return render_projection(trip, surface.scope, "travel/public-trip@1")


@delivery_router.get("/public/trips/{slug}/navigation/{local_id}", status_code=status.HTTP_302_FOUND)
@limiter.shared_limit(delivery_limit, scope="public-trip")
def get_public_navigation(request: Request, slug: str, local_id: str, session: SessionDep) -> RedirectResponse:
    surface = session.scalar(select(PublicSurface).where(PublicSurface.slug == slug))
    if surface is None or surface.state != SurfaceState.PUBLISHED:
        raise ApiException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found", code="not_found")
    trip = session.scalar(trip_query().where(Trip.id == surface.trip_id))
    target = scoped_navigation_url(trip, surface.scope, local_id) if trip is not None else None
    if target is None:
        raise ApiException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Navigation target not found", code="not_found"
        )
    return RedirectResponse(target, status_code=status.HTTP_302_FOUND, headers={"Cache-Control": "no-store"})


def _file_response(
    trip: Trip, scope: dict, local_id: str, storage: ObjectStorage, headers: dict, request: Request
) -> Response:
    resolved = scoped_file(trip, scope, local_id)
    if resolved is None:
        raise ApiException(
            status_code=status.HTTP_404_NOT_FOUND, detail="File not found", headers=headers, code="not_found"
        )
    kind, object_row = resolved
    media_type = object_row.content_type
    disposition = (
        "inline"
        if kind == "media_derivative" and media_type in {"image/jpeg", "image/png", "image/webp", "video/mp4"}
        else "attachment"
    )
    return media_response(storage, object_row, request, {**headers, "Content-Disposition": disposition})


@delivery_router.get("/public/trips/{slug}/files/{local_id}")
@limiter.shared_limit(delivery_limit, scope="public-trip")
def get_public_file(slug: str, local_id: str, session: SessionDep, storage: StorageDep, request: Request) -> Response:
    headers = {"Cache-Control": "no-store"}
    surface = session.scalar(select(PublicSurface).where(PublicSurface.slug == slug))
    if surface is None or surface.state != SurfaceState.PUBLISHED:
        raise ApiException(
            status_code=status.HTTP_404_NOT_FOUND, detail="File not found", headers=headers, code="not_found"
        )
    trip = session.scalar(trip_query().where(Trip.id == surface.trip_id))
    if trip is None:
        raise ApiException(
            status_code=status.HTTP_404_NOT_FOUND, detail="File not found", headers=headers, code="not_found"
        )
    return _file_response(trip, surface.scope, local_id, storage, headers, request)


@delivery_router.get("/shared/{token}", response_model=ProjectionDocument)
@limiter.shared_limit(shared_link_limit, scope="shared-link")
def get_shared_trip(request: Request, token: str, session: SessionDep, response: Response) -> dict:
    # Headers are also attached to each HTTPException below: FastAPI's error
    # path builds its own response and does not carry over `response.headers`
    # mutations, and a not-found/expired/revoked link must be just as
    # uncacheable and unindexable as a valid one.
    not_found = ApiException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Link not found", headers=UNLISTED_HEADERS, code="not_found"
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
@limiter.shared_limit(shared_link_limit, scope="shared-link")
def get_shared_navigation(request: Request, token: str, local_id: str, session: SessionDep) -> RedirectResponse:
    not_found = ApiException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Link not found", headers=UNLISTED_HEADERS, code="not_found"
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
    target = scoped_navigation_url(trip, link.scope, local_id) if trip is not None else None
    if target is None:
        raise ApiException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Navigation target not found",
            headers=UNLISTED_HEADERS,
            code="not_found",
        )
    return RedirectResponse(target, status_code=status.HTTP_302_FOUND, headers=UNLISTED_HEADERS)


@delivery_router.get("/shared/{token}/files/{local_id}")
@limiter.shared_limit(shared_link_limit, scope="shared-link")
def get_shared_file(token: str, local_id: str, session: SessionDep, storage: StorageDep, request: Request) -> Response:
    not_found = ApiException(
        status_code=status.HTTP_404_NOT_FOUND, detail="File not found", headers=UNLISTED_HEADERS, code="not_found"
    )
    link = session.scalar(select(ShareLink).where(ShareLink.token_verifier == verifier_for(token)))
    if link is None or link.state != LinkState.ACTIVE:
        raise not_found
    if link.expires_at is not None and _aware_utc(link.expires_at) <= datetime.now(UTC):
        raise not_found
    trip = session.scalar(trip_query().where(Trip.id == link.trip_id))
    if trip is None:
        raise not_found
    return _file_response(trip, link.scope, local_id, storage, UNLISTED_HEADERS, request)
