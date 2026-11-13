"""The HTTP side of delivering what a scope shares: path checks and the responses that carry its files and
navigation targets, with the privacy headers every answer needs.

Used by the routers only. What a scope delivers is decided in ``app.services.delivery``; the MCP tools report
that, never an HTTP response.
"""

from fastapi import Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from .errors import ApiException, RecordNotFound
from .media.ranges import media_response
from .models import Trip
from .schemas import SafeText
from .services.delivery import PATH_PATTERNS, UNLISTED_HEADERS, delivered_file, navigation_target
from .services.sharing import LAZY_EXPIRY
from .storage import ObjectStorage


def malformed_path(request: Request, names: set[str]) -> bool:
    return any(
        PATH_PATTERNS[name].fullmatch(value) is None for name, value in request.path_params.items() if name in names
    )


def validate_public_path(request: Request) -> None:
    # Validate before any lookup. Do not include submitted values in diagnostics:
    # these paths are anonymous. Share-token routes validate inside the handler
    # (see reject_malformed_token) so the rate limiter still counts them.
    if malformed_path(request, {"slug", "local_id"}) and "token" not in request.path_params:
        raise ApiException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not found",
            headers={"Cache-Control": "no-store"},
            code="not_found",
        )


def reject_malformed_token(request: Request, not_found: ApiException) -> None:
    if malformed_path(request, {"token", "local_id", "member_id"}):
        raise not_found


def persist_lazy_expiry(session: Session) -> None:
    """Commit what a read marked expired (a link or collection found past its ``expires_at``); otherwise do nothing.

    The services flush that mark and note it on the session (``LAZY_EXPIRY``) but never commit it."""
    if session.info.pop(LAZY_EXPIRY, False):
        session.commit()


def file_response(
    trip: Trip, scope: dict, local_id: str, storage: ObjectStorage, headers: dict, request: Request
) -> Response:
    try:
        found = delivered_file(trip, scope, local_id)
    except RecordNotFound as error:
        raise ApiException(
            status_code=status.HTTP_404_NOT_FOUND, detail="File not found", headers=headers, code="not_found"
        ) from error
    return media_response(storage, found.stored, request, {**headers, "Content-Disposition": found.disposition})


def preview_navigation(trip: Trip, scope: dict, local_id: SafeText) -> JSONResponse:
    try:
        target = navigation_target(trip, scope, local_id)
    except RecordNotFound as error:
        raise ApiException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Navigation target not found",
            headers=UNLISTED_HEADERS,
            code="not_found",
        ) from error
    return JSONResponse({"url": target}, headers=UNLISTED_HEADERS)
