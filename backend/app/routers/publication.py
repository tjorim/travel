"""Owner publication routes (the public page, named share links) and anonymous delivery of what they share.

The owner routes are thin: ``app.services.publication`` holds the operations, shared with the MCP tools, and each
route commits once. Anonymous delivery stays here because it is HTTP only.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..atom import atom_document
from ..audience import LinkAudience, PublicAudience, has_expired
from ..auth import current_subject
from ..capability import verifier_for
from ..database import get_session
from ..errors import ApiException
from ..http_delivery import (
    file_response,
    malformed_path,
    persist_lazy_expiry,
    preview_navigation,
    reject_malformed_token,
    validate_public_path,
)
from ..models import (
    AuditEvent,
    LinkState,
    PublicSurface,
    ShareLink,
    SurfaceState,
    Trip,
)
from ..projection import render_projection, scoped_navigation_url
from ..ratelimit import public_delivery_limit, retry_after_seconds, shared_delivery_limit
from ..request_limits import RateLimitExceeded
from ..schemas import (
    AuditEventResponse,
    AuditReasonInput,
    CollectionIndexDocument,
    ExclusionReview,
    ExclusionReviewRequest,
    ExclusionWideningConflict,
    FeedEnableRequest,
    FutureDisclosure,
    Identifier,
    ProjectionDocument,
    PublicProjectionStatusResponse,
    PublicTripCard,
    SafeText,
    ShareLinkActivateRequest,
    ShareLinkActivateResponse,
    ShareLinkCreate,
    ShareLinkResponse,
    ShareLinkUpdate,
    ShareScopeInput,
)
from ..services import publication as service
from ..services.audiences import render_document
from ..services.delivery import UNLISTED_HEADERS
from ..services.sharing import active_collection, collection_index, expire_link
from ..services.trips import trip_query
from ..storage import ObjectStorage, get_storage

router = APIRouter(prefix="/trips/{trip_id}", tags=["publication"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
StorageDep = Annotated[ObjectStorage, Depends(get_storage)]


async def delivery_rate_limit_handler(request: Request, error: RateLimitExceeded) -> JSONResponse:
    """The 429 of a visitor delivery route: a fixed body that never names the route's token.

    An unlisted-link response carries the same privacy headers as its 404, so a throttled probe stays
    uncacheable and unindexable and says nothing about whether the token exists.
    """
    headers = (
        UNLISTED_HEADERS
        if request.url.path.startswith("/api/shared/") or request.url.path.endswith("/feed.atom")
        else {"Cache-Control": "no-store"}
    )
    descriptor = {"code": "rate_limited", "params": {}, "path": []}
    return JSONResponse(
        {"detail": "Too many requests", "errors": [descriptor]},
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        headers={**headers, "Retry-After": str(retry_after_seconds(request, error))},
    )


# --- Owner: public follower view -------------------------------------------------


@router.put("/public-projection", response_model=PublicProjectionStatusResponse)
def set_public_projection_scope(
    trip_id: Identifier,
    payload: ShareScopeInput,
    session: SessionDep,
    subject: SubjectDep,
    if_match: Annotated[str | None, Header()] = None,
) -> PublicProjectionStatusResponse:
    result = service.set_public_projection_scope(session, subject, trip_id, payload, if_match)
    session.commit()
    return result


@router.post("/public-projection/preview", response_model=ProjectionDocument)
def preview_public_projection(
    trip_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    response: Response,
    payload: ShareScopeInput | None = None,
) -> dict:
    document = service.preview_public_projection(session, subject, trip_id, payload)
    response.headers["Cache-Control"] = "no-store"
    return document


@router.get("/public-projection/preview/files/{local_id}")
def preview_public_file(
    trip_id: Identifier,
    local_id: SafeText,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    request: Request,
) -> Response:
    trip, scope = service.public_preview(session, subject, trip_id)
    return file_response(trip, scope, local_id, storage, UNLISTED_HEADERS, request)


@router.post("/public-projection/future-disclosure", response_model=FutureDisclosure)
def review_public_future(
    trip_id: Identifier, session: SessionDep, subject: SubjectDep, payload: ShareScopeInput | None = None
) -> FutureDisclosure:
    """What the candidate public view would show of a trip that has not started yet: transport and day dates.

    The same scope the preview renders, counted from the same document, so the preview's review and the
    delivered fields cannot disagree. Stores nothing and records no audit event."""
    return service.review_public_future(session, subject, trip_id, payload)


@router.post("/share-links/{link_id}/future-disclosure", response_model=FutureDisclosure)
def review_link_future(
    trip_id: Identifier,
    link_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    payload: ShareScopeInput | None = None,
) -> FutureDisclosure:
    """The same review as the public one, for a hidden link's candidate scope. Stores nothing."""
    result = service.review_link_future(session, subject, trip_id, link_id, payload)
    session.commit()
    return result


@router.post("/public-projection/preview/files/{local_id}")
def preview_public_candidate_file(
    trip_id: Identifier,
    local_id: SafeText,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    request: Request,
    payload: ShareScopeInput | None = None,
) -> Response:
    trip, scope = service.public_preview(session, subject, trip_id, payload)
    return file_response(trip, scope, local_id, storage, UNLISTED_HEADERS, request)


@router.post("/public-projection/preview/navigation/{local_id}")
def preview_public_candidate_navigation(
    trip_id: Identifier,
    local_id: SafeText,
    session: SessionDep,
    subject: SubjectDep,
    payload: ShareScopeInput | None = None,
) -> JSONResponse:
    trip, scope = service.public_preview(session, subject, trip_id, payload)
    return preview_navigation(trip, scope, local_id)


@router.get("/public-projection/preview/navigation/{local_id}")
def preview_public_navigation(
    trip_id: Identifier, local_id: SafeText, session: SessionDep, subject: SubjectDep
) -> JSONResponse:
    trip, scope = service.public_preview(session, subject, trip_id)
    return preview_navigation(trip, scope, local_id)


@router.post("/public-projection/publish", response_model=PublicProjectionStatusResponse)
def publish_public_projection(
    trip_id: Identifier, session: SessionDep, subject: SubjectDep
) -> PublicProjectionStatusResponse:
    result = service.publish_public_projection(session, subject, trip_id)
    session.commit()
    return result


@router.post("/public-projection/unpublish", response_model=PublicProjectionStatusResponse)
def unpublish_public_projection(
    trip_id: Identifier, session: SessionDep, subject: SubjectDep, payload: AuditReasonInput = AuditReasonInput()
) -> PublicProjectionStatusResponse:
    result = service.unpublish_public_projection(session, subject, trip_id, payload)
    session.commit()
    return result


@router.get("/public-projection", response_model=PublicProjectionStatusResponse)
def get_public_projection_status(
    trip_id: Identifier, session: SessionDep, subject: SubjectDep
) -> PublicProjectionStatusResponse:
    result = service.get_public_projection_status(session, subject, trip_id)
    session.commit()
    return result


# --- Owner: named unlisted share links --------------------------------------------


@router.post("/share-links", response_model=ShareLinkResponse, status_code=status.HTTP_201_CREATED)
def create_share_link(
    trip_id: Identifier, payload: ShareLinkCreate, session: SessionDep, subject: SubjectDep
) -> ShareLinkResponse:
    result = service.create_share_link(session, subject, trip_id, payload)
    session.commit()
    return result


@router.get("/audit-events", response_model=list[AuditEventResponse])
def list_audit_events(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> list[AuditEvent]:
    return service.list_audit_events(session, subject, trip_id)


@router.get("/share-links", response_model=list[ShareLinkResponse])
def list_share_links(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> list[ShareLinkResponse]:
    result = service.list_share_links(session, subject, trip_id)
    session.commit()
    return result


@router.get("/share-links/{link_id}", response_model=ShareLinkResponse)
def get_share_link(
    trip_id: Identifier, link_id: Identifier, session: SessionDep, subject: SubjectDep
) -> ShareLinkResponse:
    result = service.get_share_link(session, subject, trip_id, link_id)
    session.commit()
    return result


@router.patch(
    "/share-links/{link_id}",
    response_model=ShareLinkResponse,
    responses={409: {"model": ExclusionWideningConflict, "description": "A live audience would newly show records."}},
)
def update_share_link(
    trip_id: Identifier,
    link_id: Identifier,
    payload: ShareLinkUpdate,
    session: SessionDep,
    subject: SubjectDep,
    if_match: Annotated[str | None, Header()] = None,
) -> ShareLinkResponse:
    result = service.update_share_link(session, subject, trip_id, link_id, payload, if_match)
    session.commit()
    return result


@router.post("/share-scope/exclusion-review", response_model=ExclusionReview)
def review_exclusions(
    trip_id: Identifier, payload: ExclusionReviewRequest, session: SessionDep, subject: SubjectDep
) -> ExclusionReview:
    """What these exclusions would hide from a hidden link or collection member, before anything is saved.

    Lists the records the public baseline reaches (the ones an audience may exclude), each exclusion that
    applies with the records it also hides (an excluded area hides the locations in it and the visits, stays,
    routes and updates that use it; an excluded update hides its photos), and how many stored entries are
    stale. ``items`` is the audience's own custom selection, so the counts are what its visitors would lose.
    Stores nothing and records no audit event."""
    return service.review_exclusions(session, subject, trip_id, payload)


@router.post("/share-links/{link_id}/preview", response_model=ProjectionDocument)
def preview_share_link(
    trip_id: Identifier,
    link_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    response: Response,
    payload: ShareScopeInput | None = None,
) -> dict:
    document = service.preview_share_link(session, subject, trip_id, link_id, payload)
    session.commit()
    response.headers["Cache-Control"] = "no-store"
    return document


@router.get("/share-links/{link_id}/preview/files/{local_id}")
def preview_share_file(
    trip_id: Identifier,
    link_id: Identifier,
    local_id: SafeText,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    request: Request,
) -> Response:
    trip, scope = service.link_preview(session, subject, trip_id, link_id)
    persist_lazy_expiry(session)
    return file_response(trip, scope, local_id, storage, UNLISTED_HEADERS, request)


@router.post("/share-links/{link_id}/preview/files/{local_id}")
def preview_share_candidate_file(
    trip_id: Identifier,
    link_id: Identifier,
    local_id: SafeText,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    request: Request,
    payload: ShareScopeInput | None = None,
) -> Response:
    trip, scope = service.link_preview(session, subject, trip_id, link_id, payload)
    persist_lazy_expiry(session)
    return file_response(trip, scope, local_id, storage, UNLISTED_HEADERS, request)


@router.post("/share-links/{link_id}/preview/navigation/{local_id}")
def preview_share_candidate_navigation(
    trip_id: Identifier,
    link_id: Identifier,
    local_id: SafeText,
    session: SessionDep,
    subject: SubjectDep,
    payload: ShareScopeInput | None = None,
) -> JSONResponse:
    trip, scope = service.link_preview(session, subject, trip_id, link_id, payload)
    persist_lazy_expiry(session)
    return preview_navigation(trip, scope, local_id)


@router.get("/share-links/{link_id}/preview/navigation/{local_id}")
def preview_share_navigation(
    trip_id: Identifier, link_id: Identifier, local_id: SafeText, session: SessionDep, subject: SubjectDep
) -> JSONResponse:
    trip, scope = service.link_preview(session, subject, trip_id, link_id)
    persist_lazy_expiry(session)
    return preview_navigation(trip, scope, local_id)


@router.post("/share-links/{link_id}/activate", response_model=ShareLinkActivateResponse)
def activate_share_link(
    trip_id: Identifier,
    link_id: Identifier,
    payload: ShareLinkActivateRequest,
    session: SessionDep,
    subject: SubjectDep,
) -> ShareLinkActivateResponse:
    result = service.activate_share_link(session, subject, trip_id, link_id, payload)
    session.commit()
    return result


@router.post("/share-links/{link_id}/revoke", response_model=ShareLinkResponse)
def revoke_share_link(
    trip_id: Identifier,
    link_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    payload: AuditReasonInput = AuditReasonInput(),
) -> ShareLinkResponse:
    result = service.revoke_share_link(session, subject, trip_id, link_id, payload)
    session.commit()
    return result


@router.post("/share-links/{link_id}/rotate", response_model=ShareLinkActivateResponse)
def rotate_share_link(
    trip_id: Identifier,
    link_id: Identifier,
    payload: ShareLinkActivateRequest,
    session: SessionDep,
    subject: SubjectDep,
) -> ShareLinkActivateResponse:
    result = service.rotate_share_link(session, subject, trip_id, link_id, payload)
    session.commit()
    return result


@router.post("/share-links/{link_id}/feed/{action}", response_model=ShareLinkResponse)
def manage_feed(
    trip_id: Identifier,
    link_id: Identifier,
    action: str,
    session: SessionDep,
    subject: SubjectDep,
    payload: FeedEnableRequest,
) -> ShareLinkResponse:
    result = service.manage_feed(session, subject, trip_id, link_id, action, payload)
    session.commit()
    return result


delivery_router = APIRouter(tags=["sharing-delivery"], dependencies=[Depends(validate_public_path)])


# --- Anonymous delivery -------------------------------------------------------------


@delivery_router.get(
    "/public/trips", response_model=list[PublicTripCard], dependencies=[Depends(public_delivery_limit)]
)
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
    cards = []
    for surface, trip in rows:
        projection = render_projection(trip, surface.scope, "travel/public-trip@1")
        photo = next((item for item in projection["media"] if item["id"] == projection["cover"]), None)
        cover = None
        if photo is not None:
            cover = {
                "url": f"/api/public/trips/{surface.slug}/files/{photo['id']}",
                **{key: photo[key] for key in ("width", "height", "alt_text", "focal_x", "focal_y")},
            }
        cards.append(
            PublicTripCard(
                slug=surface.slug,
                title=projection["title"],
                summary=projection["summary"],
                dates=projection["dates"],
                cover=cover,
            )
        )
    return cards


@delivery_router.get(
    "/public/trips/{slug}", response_model=ProjectionDocument, dependencies=[Depends(public_delivery_limit)]
)
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

    return render_document(session, PublicAudience(surface), trip, surface.scope)


@delivery_router.get(
    "/public/trips/{slug}/navigation/{local_id}",
    status_code=status.HTTP_302_FOUND,
    dependencies=[Depends(public_delivery_limit)],
)
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


@delivery_router.get("/public/trips/{slug}/files/{local_id}", dependencies=[Depends(public_delivery_limit)])
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
    return file_response(trip, surface.scope, local_id, storage, headers, request)


@delivery_router.get(
    "/shared/{token}",
    response_model=ProjectionDocument | CollectionIndexDocument,
    dependencies=[Depends(shared_delivery_limit)],
)
def get_shared_trip(request: Request, token: str, session: SessionDep, response: Response) -> dict | BaseModel:
    # Headers are also attached to each HTTPException below: FastAPI's error
    # path builds its own response and does not carry over `response.headers`
    # mutations, and a not-found/expired/revoked link must be just as
    # uncacheable and unindexable as a valid one.
    not_found = ApiException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Link not found", headers=UNLISTED_HEADERS, code="not_found"
    )
    reject_malformed_token(request, not_found)
    link = session.scalar(select(ShareLink).where(ShareLink.token_verifier == verifier_for(token)))
    if link is None:
        # Not a per-trip link: a collection capability opens an index of its members instead.
        collection = active_collection(session, token)
        persist_lazy_expiry(session)
        if collection is None:
            raise not_found
        for header, value in UNLISTED_HEADERS.items():
            response.headers[header] = value
        return collection_index(session, collection)
    if link.state != LinkState.ACTIVE:
        raise not_found
    if has_expired(link.expires_at):
        expire_link(session, link)
        session.commit()
        raise not_found
    trip = session.scalar(trip_query().where(Trip.id == link.trip_id))
    if trip is None:
        raise not_found
    for header, value in UNLISTED_HEADERS.items():
        response.headers[header] = value

    return render_document(session, LinkAudience(link), trip, link.scope)


@delivery_router.get(
    "/shared/{token}/navigation/{local_id}",
    status_code=status.HTTP_302_FOUND,
    dependencies=[Depends(shared_delivery_limit)],
)
def get_shared_navigation(request: Request, token: str, local_id: str, session: SessionDep) -> RedirectResponse:
    not_found = ApiException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Link not found", headers=UNLISTED_HEADERS, code="not_found"
    )
    reject_malformed_token(request, not_found)
    link = session.scalar(select(ShareLink).where(ShareLink.token_verifier == verifier_for(token)))
    if link is None or link.state != LinkState.ACTIVE:
        raise not_found
    if has_expired(link.expires_at):
        expire_link(session, link)
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


@delivery_router.get("/shared/{token}/files/{local_id}", dependencies=[Depends(shared_delivery_limit)])
def get_shared_file(token: str, local_id: str, session: SessionDep, storage: StorageDep, request: Request) -> Response:
    not_found = ApiException(
        status_code=status.HTTP_404_NOT_FOUND, detail="File not found", headers=UNLISTED_HEADERS, code="not_found"
    )
    reject_malformed_token(request, not_found)
    link = session.scalar(select(ShareLink).where(ShareLink.token_verifier == verifier_for(token)))
    if link is None or link.state != LinkState.ACTIVE:
        raise not_found
    if has_expired(link.expires_at):
        raise not_found
    trip = session.scalar(trip_query().where(Trip.id == link.trip_id))
    if trip is None:
        raise not_found
    return file_response(trip, link.scope, local_id, storage, UNLISTED_HEADERS, request)


@delivery_router.get("/public/trips/{slug}/feed.atom", dependencies=[Depends(public_delivery_limit)])
def public_feed(request: Request, slug: str, session: SessionDep) -> Response:
    try:
        document = get_public_trip(request, slug, session, Response())
    except ApiException as exc:
        exc.headers = {**(exc.headers or {}), **UNLISTED_HEADERS}
        raise
    return Response(
        atom_document(document, f"urn:travel:public:{slug}"),
        media_type="application/atom+xml",
        headers=UNLISTED_HEADERS,
    )


@delivery_router.get("/shared/{token}/feed.atom", dependencies=[Depends(shared_delivery_limit)])
def link_feed(request: Request, token: str, session: SessionDep) -> Response:
    from ..authlimit import failed_authentication

    retry = failed_authentication.retry_after(request)
    if retry is not None:
        raise ApiException(
            429, "Too many requests", headers={**UNLISTED_HEADERS, "Retry-After": str(retry)}, code="rate_limited"
        )
    link = (
        None
        if malformed_path(request, {"token"})
        else session.scalar(select(ShareLink).where(ShareLink.feed_verifier == verifier_for(token)))
    )
    if (
        link is None
        or link.state != LinkState.ACTIVE
        or has_expired(link.expires_at)
        or has_expired(link.feed_expires_at)
    ):
        failed_authentication.record_failure(request)
        raise ApiException(404, "Link not found", headers=UNLISTED_HEADERS, code="not_found")
    trip = session.scalar(trip_query().where(Trip.id == link.trip_id))
    if trip is None:
        raise ApiException(404, "Link not found", headers=UNLISTED_HEADERS, code="not_found")
    document = render_projection(trip, link.scope, "travel/unlisted-trip@1")
    # A token-free, audience-local identity: no page token or canonical trip id.
    return Response(
        atom_document(document, f"urn:travel:feed:{verifier_for(token)}"),
        media_type="application/atom+xml",
        headers=UNLISTED_HEADERS,
    )
