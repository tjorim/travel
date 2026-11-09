"""Bounded, ephemeral PDF generation. Audience data comes only from projection.py."""

import json
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable
from contextlib import contextmanager
from pathlib import Path
from threading import BoundedSemaphore
from typing import Any, Literal

import anyio
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import String, cast, event, func, select
from sqlalchemy.orm import Session

from .access import sharing_blocker
from .export import ROUTE, STAY, TRAVEL_UPDATE, VISIT, _default, _record
from .models import Base, Collection, CollectionMember, MediaKind, PublicSurface, ShareLink, Trip
from .projection import local_id, render_projection, scoped_file
from .storage import ObjectStorage

MAX_ROWS = 1500
MAX_TEXT = 500_000
MAX_PHOTOS = 60
MAX_PHOTO_BYTES = 10 * 1024 * 1024
MAX_OUTPUT = 64 * 1024 * 1024
TIMEOUT = 30
_slots = BoundedSemaphore(2)


class EphemeralPdfResponse(StreamingResponse):
    """Always release temporary files, including a failed ASGI send/disconnect."""

    def __init__(self, *args, cleanup: Callable[[], None], **kwargs):
        self.cleanup = cleanup
        super().__init__(*args, **kwargs)

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            with anyio.CancelScope(shield=True):
                await anyio.to_thread.run_sync(self.cleanup)


class PdfRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: Literal["story", "itinerary", "both"]
    view: Literal["audience", "private"]
    locale: Literal["nl", "en"]
    audience: str | None = Field(default=None, max_length=43)
    confirm_private: bool = False

    @model_validator(mode="after")
    def explicit_view(self):
        if self.view == "private" and (not self.confirm_private or self.audience is not None):
            raise ValueError("Private output requires acknowledgement and no audience")
        if self.view == "audience" and (not self.audience or self.confirm_private):
            raise ValueError("Choose an audience")
        return self


@contextmanager
def snapshot_budget(session: Session):
    """Stop issuing queries at the shared deadline; PostgreSQL bounds an in-flight one."""
    deadline = time.monotonic() + TIMEOUT
    connection = session.connection()

    def check(*args):
        if time.monotonic() > deadline:
            raise HTTPException(422, "PDF preparation time limit exceeded")

    event.listen(connection, "before_cursor_execute", check)
    try:
        yield deadline
    finally:
        event.remove(connection, "before_cursor_execute", check)


def check_budget(session: Session, trip_id: str) -> None:
    """Aggregate before loading relationships, including JSON/geometry/metadata columns.

    This deliberately caps the whole trip, even sections the PDF does not use.
    PostgreSQL runs this within the caller's repeatable-read snapshot.
    """
    rows = chars = 0
    for table in Base.metadata.sorted_tables:
        if "trip_id" not in table.c:
            continue
        lengths = [func.coalesce(func.length(cast(column, String)), 0) for column in table.c]
        count, size = session.execute(
            select(func.count(), func.coalesce(func.sum(sum(lengths)), 0)).where(table.c.trip_id == trip_id)
        ).one()
        rows += count
        chars += size
        if rows > MAX_ROWS or chars > MAX_TEXT:
            raise HTTPException(413, "PDF input limit exceeded")
    trip_size = session.scalar(
        select(func.length(Trip.title) + func.coalesce(func.length(Trip.summary), 0)).where(Trip.id == trip_id)
    )
    if (trip_size or 0) + chars > MAX_TEXT:
        raise HTTPException(413, "PDF input limit exceeded")


def pdf_data(session: Session, trip: Trip, request: PdfRequest) -> tuple[dict, dict]:
    """Return display data and approved object handles, never URLs or originals."""
    photos = {}
    data: dict[str, Any]
    if request.view == "audience":
        if request.audience == "public":
            surface = session.get(PublicSurface, trip.id)
            if surface is None:
                raise HTTPException(404, "Audience not found")
            scope = surface.scope
        elif request.audience and request.audience.startswith("collection:"):
            member = session.scalar(
                select(CollectionMember)
                .join(Collection)
                .where(
                    CollectionMember.id == request.audience.removeprefix("collection:"),
                    CollectionMember.trip_id == trip.id,
                    Collection.owner_subject == trip.owner_subject,
                )
            )
            if member is None:
                raise HTTPException(404, "Audience not found")
            scope = member.scope
        else:
            link = session.get(ShareLink, request.audience)
            if link is None or link.trip_id != trip.id:
                raise HTTPException(404, "Audience not found")
            scope = link.scope
        data = render_projection(
            trip, scope, "travel/public-trip@1" if request.audience == "public" else "travel/unlisted-trip@1"
        )
        for media in data["media"]:
            if "image" in media:
                resolved = scoped_file(trip, scope, media["image"]["id"])
                if resolved:
                    photos[media["id"]] = resolved[1]
    else:
        data = {
            "title": trip.title,
            "summary": trip.summary,
            "dates": {"starts_on": trip.starts_on, "ends_on": trip.ends_on},
            "updates": [
                _record(row, TRAVEL_UPDATE) for row in sorted(trip.travel_updates, key=lambda row: row.occurred_at)
            ],
            "visits": [_record(row, VISIT) for row in trip.visits],
            "stays": [_record(row, STAY) for row in trip.stays],
            "routes": [_record(row, ROUTE) for row in trip.routes],
            "places": [
                {
                    "label": row.label,
                    "notes": row.notes,
                    "address_line1": row.address_line1,
                    "address_line2": row.address_line2,
                    "postal_code": row.postal_code,
                    "locality": row.locality,
                    "admin_area": row.admin_area,
                    "country_code": row.country_code,
                    "latitude": row.latitude,
                    "longitude": row.longitude,
                }
                for row in trip.locations
            ],
            "media": [],
        }
        for item in trip.media_derivatives:
            if item.media_asset.media_kind == MediaKind.PHOTO and sharing_blocker("media_derivative", item) is None:
                identifier = local_id("media_derivative", item)
                data["media"].append({"id": identifier, "caption": item.caption, "alt_text": item.alt_text})
                photos[identifier] = item.object
    if request.view == "private":
        areas = {area.id: area.label for area in trip.areas}
        locations = {location.id: location.label for location in trip.locations}
        for section in ("updates", "visits", "stays", "routes"):
            for row in data[section]:
                for key, target in (
                    ("area_id", "place"),
                    ("location_id", "location"),
                    ("departure_area_id", "departure"),
                    ("arrival_area_id", "arrival"),
                ):
                    label = (locations if key == "location_id" else areas).get(row.get(key))
                    if label:
                        row[target] = {"label": label}
                for key, target in (
                    ("departure_location_id", "departure_location"),
                    ("arrival_location_id", "arrival_location"),
                ):
                    if label := locations.get(row.get(key)):
                        row[target] = {"label": label}
    # No file is opened for an itinerary-only export.
    if request.content == "itinerary":
        photos = {}
        data["updates"] = []
        data["media"] = []
    if request.content == "story":
        for section in ("visits", "stays", "routes", "places"):
            data[section] = []
    if len(photos) > MAX_PHOTOS:
        raise HTTPException(413, "PDF photo limit exceeded")
    return data, photos


def generate_pdf(
    session: Session,
    trip: Trip,
    request: PdfRequest,
    storage: ObjectStorage,
    directory: Path,
    *,
    deadline: float | None = None,
) -> Path:
    deadline = deadline if deadline is not None else time.monotonic() + TIMEOUT
    data, photos = pdf_data(session, trip, request)
    paths = {}
    total = 0
    for identifier, stored in photos.items():
        if stored is None or stored.state.value != "available" or stored.byte_size > MAX_PHOTO_BYTES:
            raise HTTPException(413, "PDF photo unavailable or too large")
        path = directory / f"photo-{len(paths)}"
        with storage.open(stored.object_key) as source, path.open("wb") as target:
            size = 0
            while chunk := source.read(64 * 1024):
                if time.monotonic() > deadline:
                    raise HTTPException(422, "PDF preparation time limit exceeded")
                size += len(chunk)
                total += len(chunk)
                if size > MAX_PHOTO_BYTES or total > MAX_OUTPUT:
                    raise HTTPException(413, "PDF photo limit exceeded")
                target.write(chunk)
        paths[identifier] = str(path)
    source = directory / "input.json"
    source.write_text(
        json.dumps({"data": data, "photos": paths, "request": request.model_dump()}, default=_default), encoding="utf-8"
    )
    output = directory / "trip.pdf"
    try:
        subprocess.run(
            [sys.executable, "-m", "app.pdf_renderer", str(source), str(output)],
            timeout=max(0.01, deadline - time.monotonic()),
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as error:
        raise HTTPException(422, "PDF could not be generated within limits") from error
    if output.stat().st_size > MAX_OUTPUT:
        raise HTTPException(413, "PDF output limit exceeded")
    return output


def temporary_pdf():
    """Admission includes rendering and delivery; disk files are removed on every exit."""
    if not _slots.acquire(blocking=False):
        raise HTTPException(503, "PDF capacity exhausted", headers={"Retry-After": "5"})
    try:
        return tempfile.TemporaryDirectory(prefix="travel-pdf-")
    except BaseException:
        _slots.release()
        raise
