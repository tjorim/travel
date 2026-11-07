"""The public trip shell with trip-specific link-preview metadata (#245)."""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_session
from ..errors import ApiException
from ..link_preview import DESCRIPTION_LIMIT, TITLE_LIMIT, Preview, clean, render_shell
from ..models import PublicSurface, SurfaceState, Trip
from ..projection import render_projection
from ..ratelimit import public_delivery_limit
from .publication import _PATH_PATTERNS
from .trips import trip_query

router = APIRouter(tags=["sharing-delivery"])
SessionDep = Annotated[Session, Depends(get_session)]

# Every response, generic or trip-specific, carries these. The shell body depends
# on live publication state, so no cache (browser or shared) may reuse it without
# asking the API again: that is what makes an unpublish or scope change take
# effect on the next fetch, exactly like ``GET /api/public/trips/{slug}``.
SHELL_HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}


def _read_shell() -> str:
    directory = settings.visitor_shell_dir
    try:
        if directory:
            return (Path(directory) / "public.html").read_text(encoding="utf-8")
    except OSError:
        pass
    raise ApiException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="The visitor shell is not available",
        headers=SHELL_HEADERS,
        code="shell_unavailable",
    )


def _public_origin() -> str:
    return str(settings.public_app_url).rstrip("/")


def public_preview(slug: str, session: Session) -> Preview:
    """The preview a published ``slug`` may show; an empty one for anything else.

    It is built from the rendered public projection, so a field the scope does not
    share is already ``None`` there, and the cover is set only when the public
    audience already receives that photo (``projection._cover``).
    """
    if _PATH_PATTERNS["slug"].fullmatch(slug) is None:
        return Preview()
    surface = session.scalar(select(PublicSurface).where(PublicSurface.slug == slug))
    if surface is None or surface.state != SurfaceState.PUBLISHED:
        return Preview()
    trip = session.scalar(trip_query().where(Trip.id == surface.trip_id))
    if trip is None:
        return Preview()
    document = render_projection(trip, surface.scope, "travel/public-trip@1")
    origin = _public_origin()
    cover = next((item for item in document["media"] if item["id"] == document["cover"]), None)
    title = clean(document["title"], TITLE_LIMIT)
    return Preview(
        title=title,
        description=clean(document["summary_text"], DESCRIPTION_LIMIT),
        url=f"{origin}/trips/{slug}",
        image_url=f"{origin}/api/public/trips/{slug}/files/{cover['id']}" if cover is not None else None,
        image_alt=clean(cover["alt_text"], DESCRIPTION_LIMIT) if cover is not None else None,
        image_width=cover["width"] if cover is not None else None,
        image_height=cover["height"] if cover is not None else None,
    )


@router.get("/public/trip-shell/{slug}", response_class=HTMLResponse, dependencies=[Depends(public_delivery_limit)])
def get_public_trip_shell(slug: str, session: SessionDep) -> HTMLResponse:
    shell = _read_shell()
    return HTMLResponse(render_shell(shell, public_preview(slug, session)), headers=SHELL_HEADERS)
