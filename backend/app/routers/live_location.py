"""Opt-in retained tracks. Visitor delivery calls only ``current_for_audience`` (``services.live_location``)."""

import hashlib
import json
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..auth import current_subject
from ..database import get_session
from ..errors import ApiException
from ..request_limits import RequestRateLimiter
from ..schemas import (
    Identifier,
    LivePositionAccepted,
    LivePositionInput,
    LiveSessionConfigure,
    LiveSessionCreate,
    LiveSessionResponse,
    LiveTrackPage,
)
from ..services import live_location as service

router = APIRouter(prefix="/trips/{trip_id}/live-location", tags=["live-location"])
SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
ingestion_limiter = RequestRateLimiter("120/minute")
# What a position needs is a few dozen bytes; anything past this is refused before it is parsed.
MAX_POSITION_BYTES = 4096
NO_STORE = "no-store, private"


@router.get("", response_model=list[LiveSessionResponse])
def list_sessions(
    trip_id: Identifier, session: SessionDep, subject: SubjectDep, response: Response
) -> list[LiveSessionResponse]:
    response.headers["Cache-Control"] = NO_STORE
    return service.list_sessions(session, subject, trip_id)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=LiveSessionResponse)
def create_session(
    trip_id: Identifier, data: LiveSessionCreate, session: SessionDep, subject: SubjectDep
) -> LiveSessionResponse:
    created = service.create_session(session, subject, trip_id, data)
    session.commit()
    return created


@router.put("/{session_id}", response_model=LiveSessionResponse)
def configure(
    trip_id: Identifier, session_id: Identifier, data: LiveSessionConfigure, session: SessionDep, subject: SubjectDep
) -> LiveSessionResponse:
    configured = service.configure_session(session, subject, trip_id, session_id, data)
    session.commit()
    return configured


@router.post(
    "/{session_id}/positions",
    response_model=LivePositionAccepted,
    # The body is read raw to cap its size before parsing, so its schema is declared here.
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": LivePositionInput.model_json_schema()}},
        }
    },
)
async def ingest(
    trip_id: Identifier, session_id: Identifier, request: Request, session: SessionDep, subject: SubjectDep
) -> LivePositionAccepted:
    ingestion_limiter.check(request, scope="live:" + hashlib.sha256(subject.encode()).hexdigest())
    # Do not hold a row lock while awaiting a client body.
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_POSITION_BYTES:
            raise ApiException(status.HTTP_413_CONTENT_TOO_LARGE, "Position too large", code="live_position_too_large")
    try:
        data = LivePositionInput.model_validate_json(body)
    except ValidationError:
        # Never echo JSON fragments, coordinates, unknown keys or source state.
        raise ApiException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Invalid position", code="live_invalid_position"
        ) from None
    return await run_in_threadpool(store_position, session, subject, trip_id, session_id, data)


def store_position(
    session: Session, subject: str, trip_id: str, session_id: str, data: LivePositionInput
) -> LivePositionAccepted:
    accepted = service.accept_position(session, subject, trip_id, session_id, data)
    session.commit()
    return accepted


@router.get("/{session_id}/tracks", response_model=LiveTrackPage)
def tracks(
    trip_id: Identifier,
    session_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    response: Response,
    after: Annotated[str, Query(max_length=32, pattern=r"^[0-9a-f]*$")] = "",
    limit: Annotated[int, Query(ge=1, le=1000)] = 200,
) -> LiveTrackPage:
    page = service.track_page(session, subject, trip_id, session_id, after=after, limit=limit)
    response.headers["Cache-Control"] = NO_STORE
    return page


@router.get(
    "/{session_id}/export",
    response_class=StreamingResponse,
    responses={
        status.HTTP_200_OK: {
            "description": "One JSON point per line: `id`, `observed_at`, `latitude` and `longitude`.",
            "content": {"application/x-ndjson": {"schema": {"type": "string"}}},
        }
    },
)
def export_tracks(
    trip_id: Identifier, session_id: Identifier, session: SessionDep, subject: SubjectDep
) -> StreamingResponse:
    points = service.track_points(session, subject, trip_id, session_id)

    # Explicit private portability; never a story export or visitor projection.
    def lines():
        for point in points:
            yield json.dumps(point.model_dump(mode="json"), allow_nan=False) + "\n"

    return StreamingResponse(
        lines(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": NO_STORE,
            "Content-Disposition": 'attachment; filename="private-tracks.jsonl"',
        },
    )


@router.delete("/{session_id}/tracks", status_code=status.HTTP_204_NO_CONTENT)
def delete_tracks(trip_id: Identifier, session_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    service.delete_tracks(session, subject, trip_id, session_id)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(trip_id: Identifier, session_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    service.delete_session(session, subject, trip_id, session_id)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
