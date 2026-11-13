"""Owner-only routes: how the traveller gets from one area to another.

A route always runs between two areas. The departure day, the exact locations,
the schedule, the booking details and a hand-drawn line are all optional. A day
comes first and a time is an optional second step: a route can be "on 5
December" before a train is chosen, and keeps that day when it gets its times.
Finished-file imports only produce a transient approximate draft; there is no
location session or append-points endpoint.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..errors import ApiException
from ..models import Route
from ..request_limits import RequestRateLimiter
from ..schemas import GeoJsonLineString, Identifier, RouteCreate, RouteResponse, RouteUpdate
from ..services import routes as service
from ..services.trips import owned_trip
from ..track_import import MAX_BYTES, approximate_line

router = APIRouter(prefix="/trips/{trip_id}", tags=["routes"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


@router.get("/routes", response_model=list[RouteResponse])
def list_routes(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> list[Route]:
    return service.list_routes(session, subject, trip_id)


@router.post("/routes", response_model=RouteResponse, status_code=status.HTTP_201_CREATED)
def create_route(trip_id: Identifier, payload: RouteCreate, session: SessionDep, subject: SubjectDep) -> Route:
    route_id = service.create_route(session, subject, trip_id, payload).id
    session.commit()
    return service.route_by_id(session, route_id)


@router.get("/routes/{route_id}", response_model=RouteResponse)
def get_route(trip_id: Identifier, route_id: Identifier, session: SessionDep, subject: SubjectDep) -> Route:
    return service.get_route(session, subject, trip_id, route_id)


@router.patch("/routes/{route_id}", response_model=RouteResponse)
def update_route(
    trip_id: Identifier, route_id: Identifier, payload: RouteUpdate, session: SessionDep, subject: SubjectDep
) -> Route:
    service.update_route(session, subject, trip_id, route_id, payload)
    session.commit()
    return service.route_by_id(session, route_id)


@router.delete("/routes/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_route(trip_id: Identifier, route_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    service.delete_route(session, subject, trip_id, route_id)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


track_import_limiter = RequestRateLimiter("6/minute; 30/hour")


@router.post("/route-line-import", response_model=GeoJsonLineString)
async def import_route_line(
    trip_id: Identifier,
    request: Request,
    response: Response,
    session: SessionDep,
    subject: SubjectDep,
    start: int = 0,
    end: int = 100,
) -> GeoJsonLineString:
    owned_trip(session, trip_id, subject)
    track_import_limiter.check(request, scope="finished-track-import")
    response.headers["Cache-Control"] = "no-store"
    # No UploadFile/Form dependency: multipart can spool sensitive bytes before admission.
    if request.headers.get("content-type") != "application/octet-stream":
        raise ApiException(
            415, "Use a binary file body", code="track_import_invalid", headers={"Cache-Control": "no-store"}
        )
    data = bytearray()
    try:
        async for chunk in request.stream():
            if len(data) + len(chunk) > MAX_BYTES:
                raise ApiException(
                    413, "File too large", code="track_import_invalid", headers={"Cache-Control": "no-store"}
                )
            data.extend(chunk)
        try:
            return approximate_line(data, start, end)
        except SyntaxError, ValueError, OverflowError, TypeError, KeyError, IndexError, AttributeError, RecursionError:
            pass
        # Raise outside the parser exception context: even traceback diagnostics contain no parser fragment.
        raise ApiException(
            422, "Cannot import this file", code="track_import_invalid", headers={"Cache-Control": "no-store"}
        )
    finally:
        data.clear()
