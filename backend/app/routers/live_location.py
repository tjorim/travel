"""Opt-in retained tracks. Visitor delivery calls only current_for_audience."""

import hashlib
import json
from datetime import timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..auth import current_subject
from ..database import get_session
from ..errors import ApiException
from ..models import LivePoint, LiveSession, ShareLink, Trip
from ..request_limits import RequestRateLimiter
from ..schemas import CurrentLocation, Identifier
from ..services import live_location as live_service
from ..services.live_location import aware, current_for_audience
from ..services.trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}/live-location", tags=["live-location"])
SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
ingestion_limiter = RequestRateLimiter("120/minute")
Precision = Literal["exact", "1km", "10km"]


class LiveSessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    source: str = Field(pattern=r"^(person|device_tracker)\.[a-z0-9_]{1,100}$")


class LiveSessionConfigure(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    enabled: bool
    audiences: dict[str, Precision] = Field(default_factory=dict, max_length=100)
    delays: dict[str, Literal[0, 900, 1800, 3600, 7200, 86400]] | None = Field(default=None, max_length=100)


class LivePositionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    observed_at: AwareDatetime
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)


class LivePointResponse(BaseModel):
    id: str
    observed_at: AwareDatetime
    latitude: float
    longitude: float


class LiveSessionResponse(BaseModel):
    id: str
    source: str
    enabled: bool
    audiences: dict[str, Precision]
    delays: dict[str, int]
    previews: dict[str, list[CurrentLocation]] = Field(
        description="What each enabled audience receives right now, at its delivered precision and delay."
    )
    current: LivePointResponse | None
    stale: bool = Field(description="The newest point is more than an hour old.")


class LivePositionAccepted(BaseModel):
    accepted: bool = Field(description="False when the same position was already stored (a retry).")


class LiveTrackPage(BaseModel):
    points: list[LivePointResponse]
    next: str | None = Field(description="Pass as `after` for the next page; null on the last one.")


def owned(session: Session, trip_id: str, session_id: str, subject: str, *, lock: bool = False) -> LiveSession:
    owned_trip(session, trip_id, subject)
    query = select(LiveSession).where(LiveSession.id == session_id, LiveSession.trip_id == trip_id)
    result = session.scalar(query.with_for_update() if lock else query)
    if result is None:
        raise ApiException(404, "Session not found", code="not_found")
    return result


def point_data(point: LivePoint) -> dict:
    return {
        "id": point.id,
        "observed_at": aware(point.observed_at),
        "latitude": point.latitude,
        "longitude": point.longitude,
    }


def session_data(session: Session, row: LiveSession) -> dict:
    point = session.get(LivePoint, row.current_id) if row.current_id else None
    return {
        "id": row.id,
        "source": row.source,
        "enabled": row.enabled,
        "audiences": row.audiences,
        "delays": row.delays,
        "previews": {
            audience: current_for_audience(session, row.trip_id, audience, rows=[row]) for audience in row.audiences
        },
        "current": point_data(point) if point else None,
        "stale": bool(point and live_service.now() - aware(point.observed_at) > timedelta(hours=1)),
    }


@router.get("", response_model=list[LiveSessionResponse])
def list_sessions(trip_id: Identifier, session: SessionDep, subject: SubjectDep, response: Response) -> list[dict]:
    owned_trip(session, trip_id, subject)
    response.headers["Cache-Control"] = "no-store, private"
    return [
        session_data(session, row) for row in session.scalars(select(LiveSession).where(LiveSession.trip_id == trip_id))
    ]


@router.post("", status_code=201, response_model=LiveSessionResponse)
def create_session(trip_id: Identifier, data: LiveSessionCreate, session: SessionDep, subject: SubjectDep) -> dict:
    owned_trip(session, trip_id, subject)
    session.execute(select(Trip.id).where(Trip.id == trip_id).with_for_update())
    # Bound per-trip configuration, without a global in-memory owner registry.
    if len(list(session.scalars(select(LiveSession.id).where(LiveSession.trip_id == trip_id).limit(20)))) >= 20:
        raise ApiException(409, "Session limit reached", code="live_session_limit")
    row = LiveSession(trip_id=trip_id, source=data.source)
    session.add(row)
    session.commit()
    return session_data(session, row)


@router.put("/{session_id}", response_model=LiveSessionResponse)
def configure(
    trip_id: Identifier, session_id: Identifier, data: LiveSessionConfigure, session: SessionDep, subject: SubjectDep
) -> dict:
    row = owned(session, trip_id, session_id, subject, lock=True)
    if data.delays is not None and data.delays.keys() - data.audiences.keys():
        raise ApiException(422, "Invalid delay audience", code="invalid_input")
    for audience in data.audiences:
        if (
            audience != "public"
            and session.scalar(select(ShareLink.id).where(ShareLink.id == audience, ShareLink.trip_id == trip_id))
            is None
        ):
            raise ApiException(422, "Invalid audience", code="invalid_input")
    if row.enabled != data.enabled:
        row.current_id = None
    row.enabled = data.enabled
    row.audiences = data.audiences
    if data.delays is not None:
        row.delays = {**(row.delays or {}), **data.delays}
    session.commit()
    return session_data(session, row)


@router.post("/{session_id}/positions", response_model=LivePositionAccepted)
async def ingest(
    trip_id: Identifier, session_id: Identifier, request: Request, session: SessionDep, subject: SubjectDep
) -> dict:
    ingestion_limiter.check(request, scope="live:" + hashlib.sha256(subject.encode()).hexdigest())
    # Do not hold a row lock while awaiting a client body.
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 4096:
            raise ApiException(413, "Position too large", code="request_too_large")
    from pydantic import ValidationError

    try:
        data = LivePositionInput.model_validate_json(body)
    except ValidationError:
        # Never echo JSON fragments, coordinates, unknown keys or source state.
        raise ApiException(422, "Invalid position", code="invalid_input") from None
    return await run_in_threadpool(accept_position, trip_id, session_id, data, session, subject)


def accept_position(trip_id: str, session_id: str, data: LivePositionInput, session: Session, subject: str) -> dict:
    row = owned(session, trip_id, session_id, subject, lock=True)
    if not row.enabled:
        raise ApiException(409, "Session disabled", code="live_disabled")
    timestamp = aware(data.observed_at)
    clock = live_service.now()
    if not clock - timedelta(minutes=5) <= timestamp <= clock + timedelta(seconds=30):
        raise ApiException(422, "Position outside freshness window", code="live_timestamp")
    if row.watermark is not None and timestamp <= aware(row.watermark):
        point = session.get(LivePoint, row.current_id) if row.current_id else None
        if (
            point
            and timestamp == aware(point.observed_at)
            and (data.latitude, data.longitude) == (point.latitude, point.longitude)
        ):
            return {"accepted": False}
        raise ApiException(409, "Position already superseded", code="live_order")
    if row.accepted_at and clock - aware(row.accepted_at) < timedelta(seconds=30):
        raise ApiException(429, "Update too frequent", code="live_rate_limit", headers={"Retry-After": "30"})
    point = LivePoint(session_id=row.id, observed_at=timestamp, latitude=data.latitude, longitude=data.longitude)
    session.add(point)
    session.flush()
    row.current_id, row.watermark, row.accepted_at = point.id, timestamp, clock
    session.commit()
    return {"accepted": True}


@router.get("/{session_id}/tracks", response_model=LiveTrackPage)
def tracks(
    trip_id: Identifier,
    session_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    response: Response,
    after: Annotated[str, Query(max_length=32, pattern=r"^[0-9a-f]*$")] = "",
    limit: Annotated[int, Query(ge=1, le=1000)] = 200,
) -> dict:
    row = owned(session, trip_id, session_id, subject)
    points = list(
        session.scalars(
            select(LivePoint)
            .where(LivePoint.session_id == row.id, LivePoint.id > after)
            .order_by(LivePoint.id)
            .limit(limit + 1)
        )
    )
    response.headers["Cache-Control"] = "no-store, private"
    return {
        "points": [point_data(p) for p in points[:limit]],
        "next": points[limit - 1].id if len(points) > limit else None,
    }


@router.get("/{session_id}/export")
def export_tracks(
    trip_id: Identifier, session_id: Identifier, session: SessionDep, subject: SubjectDep
) -> StreamingResponse:
    row = owned(session, trip_id, session_id, subject)

    # Explicit private portability; never a story export or visitor projection.
    def lines():
        for point in session.scalars(
            select(LivePoint)
            .where(LivePoint.session_id == row.id)
            .order_by(LivePoint.id)
            .execution_options(yield_per=500)
        ):
            data = point_data(point)
            data["observed_at"] = data["observed_at"].isoformat()
            yield json.dumps(data, allow_nan=False) + "\n"

    return StreamingResponse(
        lines(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-store, private",
            "Content-Disposition": 'attachment; filename="private-tracks.jsonl"',
        },
    )


@router.delete("/{session_id}/tracks", status_code=204)
def delete_tracks(trip_id: Identifier, session_id: Identifier, session: SessionDep, subject: SubjectDep) -> None:
    row = owned(session, trip_id, session_id, subject, lock=True)
    row.current_id = None
    session.execute(delete(LivePoint).where(LivePoint.session_id == row.id))
    session.commit()


@router.delete("/{session_id}", status_code=204)
def delete_session(trip_id: Identifier, session_id: Identifier, session: SessionDep, subject: SubjectDep) -> None:
    row = owned(session, trip_id, session_id, subject, lock=True)
    session.delete(row)
    session.commit()
