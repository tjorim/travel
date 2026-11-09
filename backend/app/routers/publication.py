import re
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..atom import atom_document
from ..audit import SYSTEM_ACTOR, record_audit_event, scope_fingerprint
from ..auth import current_subject
from ..capability import generate_token, verifier_for
from ..database import get_session
from ..errors import ApiException, service_exception
from ..exclusion_review import exclusion_changes, exclusion_review, scope_exclusions, widening
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
from ..overview import future_counts
from ..projection import (
    ScopeError,
    prepare_scope,
    render_projection,
    scoped_file,
    scoped_navigation_url,
)
from ..ratelimit import public_delivery_limit, retry_after_seconds, shared_delivery_limit
from ..request_limits import RateLimitExceeded
from ..schemas import (
    AuditEventResponse,
    AuditReasonInput,
    CollectionIndexDocument,
    ExclusionReview,
    ExclusionReviewRequest,
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
from ..sharing_presets import apply_preset, exceptions_of
from ..storage import ObjectStorage, get_storage
from .trips import owned_trip, trip_query

router = APIRouter(prefix="/trips/{trip_id}", tags=["publication"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
StorageDep = Annotated[ObjectStorage, Depends(get_storage)]


def _aware_utc(value: datetime) -> datetime:
    # SQLite (used in tests) drops tzinfo on round-trip even for a
    # DateTime(timezone=True) column; Postgres (production) preserves it.
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


aware_utc = _aware_utc


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


def _apply_scope(
    session: Session,
    trip_id: Identifier,
    subject: str,
    scope: ShareScopeInput,
    stored: dict | None = None,
    *,
    public: bool = False,
) -> dict:
    """Validate a submitted scope and return it as stored.

    ``stored`` is the audience's current scope; a new audience passes ``None`` and so starts with the
    conservative default date precision (see ``ShareScopeInput.document``). The public view is the
    baseline every other audience subtracts from, so it cannot exclude records (``public=True``)."""
    trip = owned_trip(session, trip_id, subject)
    scope_dict = scope.document(stored)
    try:
        return prepare_scope(trip, scope_dict, stored, allow_exclusions=not public)
    except ScopeError as error:
        raise service_exception(status.HTTP_422_UNPROCESSABLE_CONTENT, error) from error


def _preview_scope(
    session: Session,
    trip_id: Identifier,
    subject: str,
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
    return _apply_scope(session, trip_id, subject, candidate, saved, public=public)


def _get_or_create_surface(session: Session, trip_id: Identifier) -> PublicSurface:
    surface = session.get(PublicSurface, trip_id)
    if surface is None:
        try:
            with session.begin_nested():
                # A new public view reads dates by month until the owner chooses otherwise.
                surface = PublicSurface(trip_id=trip_id, scope={"defaults": {"date_precision": "month"}})
                session.add(surface)
                session.flush()
        except IntegrityError:
            # Another owner session may have created the initial surface first.
            surface = session.get(PublicSurface, trip_id)
            if surface is None:
                raise
    return surface


def _claim_revision(session: Session, record: PublicSurface | ShareLink, expected: str | None) -> None:
    """Atomically advance the revision, including for legacy unconditional clients."""
    model = type(record)
    key = PublicSurface.trip_id if isinstance(record, PublicSurface) else ShareLink.id
    identity = record.trip_id if isinstance(record, PublicSurface) else record.id
    statement = update(model).where(key == identity)
    if expected is not None:
        if not re.fullmatch(r'"[0-9]+"', expected):
            raise ApiException(status_code=400, detail="Invalid revision", code="invalid_revision")
        statement = statement.where(model.revision == int(expected[1:-1]))
    result = session.execute(
        statement.values(revision=model.revision + 1)
        .returning(model.revision)
        .execution_options(synchronize_session=False)
    )
    if result.scalar_one_or_none() is None:
        session.rollback()
        session.refresh(record)
        trip = session.scalar(trip_query().where(Trip.id == record.trip_id))
        current = (
            _public_status(record, trip)
            if isinstance(record, PublicSurface)
            else (link_response(record, trip) if trip is not None else ShareLinkResponse.model_validate(record))
        )
        raise ApiException(
            code="scope_revision_conflict",
            status_code=412,
            detail={"code": "scope_revision_conflict", "current": current.model_dump(mode="json")},
        )
    session.refresh(record)


# --- Owner: public follower view -------------------------------------------------
#
# `state` is the only gate: it controls whether this trip is served publicly
# at all. While published (or before first publishing), `scope` is a live
# field — editing it takes effect immediately, and delivery always renders
# current trip content filtered to it. There is no frozen snapshot to
# republish: widening scope is a live edit, same as narrowing it.


@router.put("/public-projection", response_model=PublicProjectionStatusResponse)
def set_public_projection_scope(
    trip_id: Identifier,
    payload: ShareScopeInput,
    session: SessionDep,
    subject: SubjectDep,
    if_match: Annotated[str | None, Header()] = None,
) -> PublicProjectionStatusResponse:
    surface = _get_or_create_surface(session, trip_id)
    scope = _apply_scope(session, trip_id, subject, payload, surface.scope, public=True)
    _claim_revision(session, surface, if_match)
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
    session.commit()
    return public_status(session, surface)


@router.post("/public-projection/preview", response_model=ProjectionDocument)
def preview_public_projection(
    trip_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    response: Response,
    payload: ShareScopeInput | None = None,
) -> dict:
    trip = owned_trip(session, trip_id, subject)
    surface = session.get(PublicSurface, trip_id)
    scope = _preview_scope(session, trip_id, subject, payload, surface.scope if surface else None, public=True)
    response.headers["Cache-Control"] = "no-store"
    from .live_location import current_for_audience

    document = render_projection(trip, scope, "travel/public-trip@1")
    if positions := current_for_audience(session, trip_id, "public"):
        document["current_locations"] = positions
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
    trip = owned_trip(session, trip_id, subject)
    surface = session.get(PublicSurface, trip_id)
    return _file_response(trip, surface.scope if surface else {}, local_id, storage, UNLISTED_HEADERS, request)


@router.post("/public-projection/future-disclosure", response_model=FutureDisclosure)
def review_public_future(
    trip_id: Identifier, session: SessionDep, subject: SubjectDep, payload: ShareScopeInput | None = None
) -> FutureDisclosure:
    """What the candidate public view would show of a trip that has not started yet: transport and day dates.

    The same scope the preview renders, counted from the same document, so the preview's review and the
    delivered fields cannot disagree. Stores nothing and records no audit event."""
    trip = owned_trip(session, trip_id, subject)
    surface = session.get(PublicSurface, trip_id)
    scope = _preview_scope(session, trip_id, subject, payload, surface.scope if surface else None, public=True)
    return _future_disclosure(trip, scope)


@router.post("/share-links/{link_id}/future-disclosure", response_model=FutureDisclosure)
def review_link_future(
    trip_id: Identifier,
    link_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    payload: ShareScopeInput | None = None,
) -> FutureDisclosure:
    """The same review as the public one, for a hidden link's candidate scope. Stores nothing."""
    trip = owned_trip(session, trip_id, subject)
    link = owned_link(session, trip_id, subject, link_id)
    return _future_disclosure(trip, _preview_scope(session, trip_id, subject, payload, link.scope))


def _future_disclosure(trip: Trip, scope: dict) -> FutureDisclosure:
    document = render_projection(trip, scope, "travel/unlisted-trip@1")
    return FutureDisclosure(**future_counts(trip, document, datetime.now(UTC).date()))


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
    trip = owned_trip(session, trip_id, subject)
    surface = session.get(PublicSurface, trip_id)
    scope = _preview_scope(session, trip_id, subject, payload, surface.scope if surface else None, public=True)
    return _file_response(trip, scope, local_id, storage, UNLISTED_HEADERS, request)


@router.post("/public-projection/preview/navigation/{local_id}")
def preview_public_candidate_navigation(
    trip_id: Identifier,
    local_id: SafeText,
    session: SessionDep,
    subject: SubjectDep,
    payload: ShareScopeInput | None = None,
) -> JSONResponse:
    trip = owned_trip(session, trip_id, subject)
    surface = session.get(PublicSurface, trip_id)
    scope = _preview_scope(session, trip_id, subject, payload, surface.scope if surface else None, public=True)
    return _preview_navigation(trip, scope, local_id)


@router.get("/public-projection/preview/navigation/{local_id}")
def preview_public_navigation(
    trip_id: Identifier, local_id: SafeText, session: SessionDep, subject: SubjectDep
) -> JSONResponse:
    trip = owned_trip(session, trip_id, subject)
    surface = session.get(PublicSurface, trip_id)
    return _preview_navigation(trip, surface.scope if surface else {}, local_id)


@router.post("/public-projection/publish", response_model=PublicProjectionStatusResponse)
def publish_public_projection(
    trip_id: Identifier, session: SessionDep, subject: SubjectDep
) -> PublicProjectionStatusResponse:
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
    return public_status(session, surface)


@router.post("/public-projection/unpublish", response_model=PublicProjectionStatusResponse)
def unpublish_public_projection(
    trip_id: Identifier, session: SessionDep, subject: SubjectDep, payload: AuditReasonInput = AuditReasonInput()
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
    return public_status(session, surface)


@router.get("/public-projection", response_model=PublicProjectionStatusResponse)
def get_public_projection_status(
    trip_id: Identifier, session: SessionDep, subject: SubjectDep
) -> PublicProjectionStatusResponse:
    owned_trip(session, trip_id, subject)
    surface = _get_or_create_surface(session, trip_id)
    session.commit()
    return public_status(session, surface)


def _public_status(surface: PublicSurface, trip: Trip | None = None) -> PublicProjectionStatusResponse:
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
    return _public_status(surface, trip)


# --- Owner: named unlisted share links --------------------------------------------
#
# `state` gates whether the token works at all. While `active`, `scope` is
# likewise live: editing it takes effect immediately for anyone already
# holding the token. `activate` is the only step that mints the URL; `rotate`
# remains useful on its own (a fresh URL for a suspected-leaked one) since
# scope changes no longer need it.

EDITABLE_LINK_STATES = (LinkState.DRAFT, LinkState.ACTIVE)
EXCLUSION_WIDENING_CODE = "exclusion_widening_needs_acknowledgement"


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


def refuse_unacknowledged_widening(trip: Trip, before: dict, after: dict, *, live: bool, confirmed: bool) -> None:
    """Refuse (409, nothing changes) a live audience's scope edit that removes exclusions without the owner's say-so.

    Removing an exclusion shows the audience records it did not receive, so it is a widening like the ones in
    decisions 27 and 36: the refusal lists them, and ``confirm_widening`` accepts them. A draft delivers nothing,
    and narrowing never needs a confirmation."""
    if not live or confirmed:
        return
    revealed = widening(trip, before, after)
    if revealed.revealed:
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": EXCLUSION_WIDENING_CODE, **revealed.model_dump(mode="json")},
            code=EXCLUSION_WIDENING_CODE,
        )


def scope_change_details(trip: Trip, before: dict, after: dict) -> dict:
    """The audit entry of a live scope edit: fingerprints and, when exclusions changed, their ids and counts only."""
    details: dict = {"scope_version_before": scope_fingerprint(before), "scope_version_after": scope_fingerprint(after)}
    if changes := exclusion_changes(before, after):
        details["exclusions"] = {**changes, "widened": widening(trip, before, after).counts}
    return details


def _expire_link(session: Session, link: ShareLink) -> None:
    """Persist the active -> expired transition, stamping the audit event with
    the real expiry time rather than the time someone noticed."""
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
    session.commit()


def _settle_expired(session: Session, links: list[ShareLink]) -> None:
    """Lazy write for owner reads: an active link past `expires_at` is stored as
    expired the first time the owner (or a visitor) sees it. No sweep job runs."""
    now = datetime.now(UTC)
    for link in links:
        if link.state == LinkState.ACTIVE and link.expires_at is not None and _aware_utc(link.expires_at) <= now:
            _expire_link(session, link)


def owned_link(session: Session, trip_id: Identifier, subject: str, link_id: Identifier) -> ShareLink:
    owned_trip(session, trip_id, subject)
    link = session.scalar(select(ShareLink).where(ShareLink.id == link_id, ShareLink.trip_id == trip_id))
    if link is None:
        raise ApiException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found", code="not_found")
    _settle_expired(session, [link])
    return link


@router.post("/share-links", response_model=ShareLinkResponse, status_code=status.HTTP_201_CREATED)
def create_share_link(
    trip_id: Identifier, payload: ShareLinkCreate, session: SessionDep, subject: SubjectDep
) -> ShareLinkResponse:
    scope = _apply_scope(session, trip_id, subject, payload.scope, None)
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
    trip = owned_trip(session, trip_id, subject)
    if payload.preset is not None:
        # In the same transaction, through the same code as the apply route: a new link has received nothing yet.
        apply_preset(
            session, trip, subject, link, payload.preset, fingerprint=None, confirm_widening=False, claim=None, new=True
        )
    session.commit()
    return link_response(link, trip)


@router.get("/audit-events", response_model=list[AuditEventResponse])
def list_audit_events(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> list[AuditEvent]:
    owned_trip(session, trip_id, subject)
    return list(
        session.scalars(select(AuditEvent).where(AuditEvent.trip_id == trip_id).order_by(AuditEvent.occurred_at.desc()))
    )


@router.get("/share-links", response_model=list[ShareLinkResponse])
def list_share_links(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> list[ShareLinkResponse]:
    trip = owned_trip(session, trip_id, subject)
    links = list(
        session.scalars(select(ShareLink).where(ShareLink.trip_id == trip_id).order_by(ShareLink.created_at.desc()))
    )
    _settle_expired(session, links)
    return [link_response(link, trip) for link in links]


@router.get("/share-links/{link_id}", response_model=ShareLinkResponse)
def get_share_link(
    trip_id: Identifier, link_id: Identifier, session: SessionDep, subject: SubjectDep
) -> ShareLinkResponse:
    link = owned_link(session, trip_id, subject, link_id)
    return link_response(link, owned_trip(session, trip_id, subject))


@router.patch("/share-links/{link_id}", response_model=ShareLinkResponse)
def update_share_link(
    trip_id: Identifier,
    link_id: Identifier,
    payload: ShareLinkUpdate,
    session: SessionDep,
    subject: SubjectDep,
    if_match: Annotated[str | None, Header()] = None,
) -> ShareLinkResponse:
    link = owned_link(session, trip_id, subject, link_id)
    if link.state not in EDITABLE_LINK_STATES:
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A revoked or expired link cannot be edited",
            code="a_revoked_or_expired_link_cannot_be_edited",
        )
    trip = owned_trip(session, trip_id, subject)
    new_scope = (
        _apply_scope(session, trip_id, subject, payload.scope, link.scope) if payload.scope is not None else None
    )
    if new_scope is not None:
        # Before the revision is claimed: a refused widening changes nothing, not even the revision.
        refuse_unacknowledged_widening(
            trip, link.scope, new_scope, live=link.state == LinkState.ACTIVE, confirmed=payload.confirm_widening
        )
    _claim_revision(session, link, if_match)
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
    session.commit()
    return link_response(link, trip)


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
    trip = owned_trip(session, trip_id, subject)
    scope = {
        "items": [item.model_dump(mode="json") for item in payload.items],
        "exclude": [item.model_dump(mode="json") for item in payload.exclude],
    }
    return exclusion_review(trip, scope)


@router.post("/share-links/{link_id}/preview", response_model=ProjectionDocument)
def preview_share_link(
    trip_id: Identifier,
    link_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    response: Response,
    payload: ShareScopeInput | None = None,
) -> dict:
    trip = owned_trip(session, trip_id, subject)
    link = owned_link(session, trip_id, subject, link_id)
    scope = _preview_scope(session, trip_id, subject, payload, link.scope)
    response.headers["Cache-Control"] = "no-store"
    from .live_location import current_for_audience

    document = render_projection(trip, scope, "travel/unlisted-trip@1")
    if positions := current_for_audience(session, trip_id, link_id):
        document["current_locations"] = positions
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
    trip = owned_trip(session, trip_id, subject)
    link = owned_link(session, trip_id, subject, link_id)
    return _file_response(trip, link.scope, local_id, storage, UNLISTED_HEADERS, request)


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
    trip = owned_trip(session, trip_id, subject)
    link = owned_link(session, trip_id, subject, link_id)
    scope = _preview_scope(session, trip_id, subject, payload, link.scope)
    return _file_response(trip, scope, local_id, storage, UNLISTED_HEADERS, request)


@router.post("/share-links/{link_id}/preview/navigation/{local_id}")
def preview_share_candidate_navigation(
    trip_id: Identifier,
    link_id: Identifier,
    local_id: SafeText,
    session: SessionDep,
    subject: SubjectDep,
    payload: ShareScopeInput | None = None,
) -> JSONResponse:
    trip = owned_trip(session, trip_id, subject)
    link = owned_link(session, trip_id, subject, link_id)
    scope = _preview_scope(session, trip_id, subject, payload, link.scope)
    return _preview_navigation(trip, scope, local_id)


@router.get("/share-links/{link_id}/preview/navigation/{local_id}")
def preview_share_navigation(
    trip_id: Identifier, link_id: Identifier, local_id: SafeText, session: SessionDep, subject: SubjectDep
) -> JSONResponse:
    trip = owned_trip(session, trip_id, subject)
    link = owned_link(session, trip_id, subject, link_id)
    return _preview_navigation(trip, link.scope, local_id)


def _preview_navigation(trip: Trip, scope: dict, local_id: SafeText) -> JSONResponse:
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
    trip_id: Identifier,
    link_id: Identifier,
    payload: ShareLinkActivateRequest,
    session: SessionDep,
    subject: SubjectDep,
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
    return activation_response(link, owned_trip(session, trip_id, subject))


@router.post("/share-links/{link_id}/revoke", response_model=ShareLinkResponse)
def revoke_share_link(
    trip_id: Identifier,
    link_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    payload: AuditReasonInput = AuditReasonInput(),
) -> ShareLinkResponse:
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
    return link_response(link, owned_trip(session, trip_id, subject))


@router.post("/share-links/{link_id}/rotate", response_model=ShareLinkActivateResponse)
def rotate_share_link(
    trip_id: Identifier,
    link_id: Identifier,
    payload: ShareLinkActivateRequest,
    session: SessionDep,
    subject: SubjectDep,
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
    session.commit()
    return activation_response(new_link, owned_trip(session, trip_id, subject))


_PATH_PATTERNS = {
    "slug": re.compile(r"[A-Za-z0-9_-]{1,32}"),
    "token": re.compile(r"[A-Za-z0-9_-]{43}"),
    "member_id": re.compile(r"[A-Za-z0-9_-]{1,32}"),
    "local_id": re.compile(r"[A-Za-z0-9_-]{1,80}"),
}


def _malformed_path(request: Request, names: set[str]) -> bool:
    return any(
        _PATH_PATTERNS[name].fullmatch(value) is None for name, value in request.path_params.items() if name in names
    )


def _validate_public_path(request: Request) -> None:
    # Validate before any lookup. Do not include submitted values in diagnostics:
    # these paths are anonymous. Share-token routes validate inside the handler
    # (see _reject_malformed_token) so the rate limiter still counts them.
    if _malformed_path(request, {"slug", "local_id"}) and "token" not in request.path_params:
        raise ApiException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not found",
            headers={"Cache-Control": "no-store"},
            code="not_found",
        )


def _reject_malformed_token(request: Request, not_found: ApiException) -> None:
    if _malformed_path(request, {"token", "local_id", "member_id"}):
        raise not_found


delivery_router = APIRouter(tags=["sharing-delivery"], dependencies=[Depends(_validate_public_path)])


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
    from .live_location import current_for_audience

    document = render_projection(trip, surface.scope, "travel/public-trip@1")
    if positions := current_for_audience(session, trip.id, "public"):
        document["current_locations"] = positions
    return document


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
    return _file_response(trip, surface.scope, local_id, storage, headers, request)


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
    _reject_malformed_token(request, not_found)
    link = session.scalar(select(ShareLink).where(ShareLink.token_verifier == verifier_for(token)))
    if link is None:
        # Not a per-trip link: a collection capability opens an index of its members instead.
        from .collections import active_collection, collection_index

        collection = active_collection(session, token)
        if collection is None:
            raise not_found
        for header, value in UNLISTED_HEADERS.items():
            response.headers[header] = value
        return collection_index(session, collection)
    if link.state != LinkState.ACTIVE:
        raise not_found
    if link.expires_at is not None and _aware_utc(link.expires_at) <= datetime.now(UTC):
        _expire_link(session, link)
        raise not_found
    trip = session.scalar(trip_query().where(Trip.id == link.trip_id))
    if trip is None:
        raise not_found
    for header, value in UNLISTED_HEADERS.items():
        response.headers[header] = value
    from .live_location import current_for_audience

    document = render_projection(trip, link.scope, "travel/unlisted-trip@1")
    if positions := current_for_audience(session, trip.id, link.id):
        document["current_locations"] = positions
    return document


@delivery_router.get(
    "/shared/{token}/navigation/{local_id}",
    status_code=status.HTTP_302_FOUND,
    dependencies=[Depends(shared_delivery_limit)],
)
def get_shared_navigation(request: Request, token: str, local_id: str, session: SessionDep) -> RedirectResponse:
    not_found = ApiException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Link not found", headers=UNLISTED_HEADERS, code="not_found"
    )
    _reject_malformed_token(request, not_found)
    link = session.scalar(select(ShareLink).where(ShareLink.token_verifier == verifier_for(token)))
    if link is None or link.state != LinkState.ACTIVE:
        raise not_found
    if link.expires_at is not None and _aware_utc(link.expires_at) <= datetime.now(UTC):
        _expire_link(session, link)
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
    _reject_malformed_token(request, not_found)
    link = session.scalar(select(ShareLink).where(ShareLink.token_verifier == verifier_for(token)))
    if link is None or link.state != LinkState.ACTIVE:
        raise not_found
    if link.expires_at is not None and _aware_utc(link.expires_at) <= datetime.now(UTC):
        raise not_found
    trip = session.scalar(trip_query().where(Trip.id == link.trip_id))
    if trip is None:
        raise not_found
    return _file_response(trip, link.scope, local_id, storage, UNLISTED_HEADERS, request)


@router.post("/share-links/{link_id}/feed/{action}", response_model=ShareLinkResponse)
def manage_feed(
    trip_id: Identifier,
    link_id: Identifier,
    action: str,
    session: SessionDep,
    subject: SubjectDep,
    payload: FeedEnableRequest,
) -> ShareLinkResponse:
    link = owned_link(session, trip_id, subject, link_id)
    session.refresh(link, with_for_update=True)
    if action not in {"enable", "rotate", "revoke"}:
        raise ApiException(404, "Not found", code="not_found")
    if action != "revoke" and (
        link.state != LinkState.ACTIVE or (link.expires_at and aware_utc(link.expires_at) <= datetime.now(UTC))
    ):
        raise ApiException(409, "Link is not active", code="invalid_state")
    if (action == "enable" and link.feed_token) or (action != "enable" and not link.feed_token):
        raise ApiException(409, "Feed state conflict", code="invalid_state")
    if action != "revoke" and not payload.acknowledge_copies:
        raise ApiException(422, "Acknowledgement required", code="invalid_input")
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
    session.commit()
    return link_response(link, owned_trip(session, trip_id, subject))


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
        if _malformed_path(request, {"token"})
        else session.scalar(select(ShareLink).where(ShareLink.feed_verifier == verifier_for(token)))
    )
    now = datetime.now(UTC)
    if (
        link is None
        or link.state != LinkState.ACTIVE
        or (link.expires_at is not None and aware_utc(link.expires_at) <= now)
        or (link.feed_expires_at is not None and aware_utc(link.feed_expires_at) <= now)
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
