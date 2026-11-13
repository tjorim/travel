"""What anonymous delivery shares: its privacy headers, path checks and the helpers that answer a request."""

import re

from fastapi import Request, Response, status
from fastapi.responses import JSONResponse

from ..errors import ApiException
from ..media.ranges import media_response
from ..models import Trip
from ..projection import scoped_file, scoped_navigation_url
from ..schemas import SafeText
from ..storage import ObjectStorage

UNLISTED_HEADERS = {
    "Cache-Control": "no-store, private",
    "X-Robots-Tag": "noindex, noarchive",
    "Referrer-Policy": "no-referrer",
}


PATH_PATTERNS = {
    "slug": re.compile(r"[A-Za-z0-9_-]{1,32}"),
    "token": re.compile(r"[A-Za-z0-9_-]{43}"),
    "member_id": re.compile(r"[A-Za-z0-9_-]{1,32}"),
    "local_id": re.compile(r"[A-Za-z0-9_-]{1,80}"),
}


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


def file_response(
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


def preview_navigation(trip: Trip, scope: dict, local_id: SafeText) -> JSONResponse:
    target = scoped_navigation_url(trip, scope, local_id)
    if target is None:
        raise ApiException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Navigation target not found",
            headers=UNLISTED_HEADERS,
            code="not_found",
        )
    return JSONResponse({"url": target}, headers=UNLISTED_HEADERS)
