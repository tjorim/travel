"""Private finished-track uploads and separately authored broad routes.

There is deliberately no location session, append-points endpoint or public
track delivery route here. A raw recording arrives once, with both temporal
bounds, and can be read only by the trip owner. A broad route is authored as
its own reviewed GeoJSON line; it has no relationship that could cause its
geometry to be derived from raw data at request time.
"""

import json
from datetime import UTC, datetime
from typing import Annotated
from xml.etree import ElementTree

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..media.service import MediaImportError, store_uploaded_object
from ..models import BroadRoute, RecordedTrack, TrackKind
from ..schemas import BroadRouteCreate, BroadRouteResponse, BroadRouteUpdate, RecordedTrackResponse
from ..storage import ObjectStorage, get_storage
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["tracks"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
StorageDep = Annotated[ObjectStorage, Depends(get_storage)]

_GPX_CONTENT_TYPES = {"application/gpx+xml", "application/xml", "text/xml"}
_POINT_ARRAY_CONTENT_TYPES = {"application/json", "application/geo+json"}


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("Track timestamps must include a UTC offset")
    return value.astimezone(UTC)


def _parse_track_time(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("Each track point must include a timestamp")
    try:
        return _utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except ValueError as error:
        raise ValueError("Track point timestamps must be ISO-8601 instants") from error


def _valid_coordinate(latitude: object, longitude: object) -> None:
    try:
        lat = float(latitude)
        lon = float(longitude)
    except (TypeError, ValueError) as error:
        raise ValueError("Each track point must have latitude and longitude") from error
    if not -90 <= lat <= 90 or not -180 <= lon <= 180:
        raise ValueError("Track points must have valid latitude and longitude")


def _local_name(element: ElementTree.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _gpx_point_times(data: bytes) -> list[datetime]:
    try:
        root = ElementTree.fromstring(data)
    except ElementTree.ParseError as error:
        raise ValueError("Track file is not valid GPX XML") from error
    if _local_name(root) != "gpx":
        raise ValueError("Track file must be a GPX document")
    times: list[datetime] = []
    for point in root.iter():
        if _local_name(point) != "trkpt":
            continue
        _valid_coordinate(point.attrib.get("lat"), point.attrib.get("lon"))
        time = next((child.text for child in point if _local_name(child) == "time"), None)
        times.append(_parse_track_time(time))
    return times


def _point_array_times(data: bytes) -> list[datetime]:
    try:
        decoded = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Track file is not valid JSON") from error
    points = decoded.get("points") if isinstance(decoded, dict) else decoded
    if not isinstance(points, list):
        raise ValueError("Point-array tracks must be a list or an object with a points list")
    times: list[datetime] = []
    for point in points:
        if not isinstance(point, dict):
            raise ValueError("Each point-array item must be an object")
        _valid_coordinate(point.get("latitude", point.get("lat")), point.get("longitude", point.get("lon")))
        times.append(_parse_track_time(point.get("recorded_at", point.get("time"))))
    return times


def validate_finished_track(data: bytes, kind: TrackKind, content_type: str, started_at: datetime, ended_at: datetime) -> None:
    """Require a complete, bounded recording before storing any raw bytes."""
    try:
        start = _utc(started_at)
        end = _utc(ended_at)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Track start and end times must include UTC offsets",
        ) from error
    if end <= start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Track end time must be after its start time",
        )
    normalized_content_type = content_type.split(";", 1)[0].strip().lower()
    if kind == TrackKind.GPX:
        if normalized_content_type not in _GPX_CONTENT_TYPES:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="GPX requires an XML content type")
        point_times = _gpx_point_times(data)
    else:
        if normalized_content_type not in _POINT_ARRAY_CONTENT_TYPES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Point-array tracks require a JSON content type",
            )
        point_times = _point_array_times(data)
    if len(point_times) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A finished track must contain at least two timestamped points",
        )
    if any(point_time < start or point_time > end for point_time in point_times):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Track point timestamps must fall within the supplied start and end times",
        )


def _track_response(track: RecordedTrack, trip_id: str) -> RecordedTrackResponse:
    source = track.source_object
    return RecordedTrackResponse(
        id=track.id,
        source_object_id=track.source_object_id,
        started_at=track.started_at,
        ended_at=track.ended_at,
        kind=track.kind,
        byte_size=source.byte_size,
        content_type=source.content_type,
        source_file_url=f"/api/trips/{trip_id}/recorded-tracks/{track.id}/source",
    )


def owned_track(session: Session, trip_id: str, subject: str, track_id: str) -> RecordedTrack:
    owned_trip(session, trip_id, subject)
    track = session.scalar(
        select(RecordedTrack).where(RecordedTrack.id == track_id, RecordedTrack.trip_id == trip_id)
    )
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recorded track not found")
    return track


@router.post("/recorded-tracks/uploads", response_model=RecordedTrackResponse, status_code=status.HTTP_201_CREATED)
def upload_finished_track(
    trip_id: str,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    response: Response,
    started_at: Annotated[datetime, Form()],
    ended_at: Annotated[datetime, Form()],
    kind: Annotated[TrackKind, Form()],
    file: Annotated[UploadFile, File()],
) -> RecordedTrackResponse:
    """Upload a whole, completed raw track as one owner action.

    No route in this module creates an upload session or accepts point
    appends, which rules out accidental live-tracking semantics.
    """
    owned_trip(session, trip_id, subject)
    data = file.file.read()
    if not file.content_type:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A content type is required")
    try:
        validate_finished_track(data, kind, file.content_type, started_at, ended_at)
        source = store_uploaded_object(session, storage, trip_id=trip_id, data=data, content_type=file.content_type)
    except (MediaImportError, ValueError) as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error

    existing = session.scalar(
        select(RecordedTrack).where(RecordedTrack.trip_id == trip_id, RecordedTrack.source_object_id == source.id)
    )
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return _track_response(existing, trip_id)

    track = RecordedTrack(
        trip_id=trip_id,
        source_object_id=source.id,
        started_at=started_at,
        ended_at=ended_at,
        kind=kind,
    )
    session.add(track)
    session.commit()
    session.refresh(track)
    return _track_response(track, trip_id)


@router.get("/recorded-tracks", response_model=list[RecordedTrackResponse])
def list_recorded_tracks(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[RecordedTrackResponse]:
    owned_trip(session, trip_id, subject)
    tracks = session.scalars(
        select(RecordedTrack).where(RecordedTrack.trip_id == trip_id).order_by(RecordedTrack.started_at)
    )
    return [_track_response(track, trip_id) for track in tracks]


@router.get("/recorded-tracks/{track_id}", response_model=RecordedTrackResponse)
def get_recorded_track(trip_id: str, track_id: str, session: SessionDep, subject: SubjectDep) -> RecordedTrackResponse:
    return _track_response(owned_track(session, trip_id, subject, track_id), trip_id)


@router.get("/recorded-tracks/{track_id}/source")
def get_recorded_track_source(
    trip_id: str, track_id: str, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> StreamingResponse:
    track = owned_track(session, trip_id, subject, track_id)
    data = storage.get(track.source_object.object_key)
    return StreamingResponse(iter([data]), media_type=track.source_object.content_type, headers={"Cache-Control": "no-store"})


@router.get("/offline-map", status_code=status.HTTP_204_NO_CONTENT)
def revalidate_offline_map(trip_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    """Owner-only revalidation target for an explicitly pinned map snapshot.

    The snapshot itself is assembled in the client from the already owner-scoped
    routes, tracks and places endpoints.  This small endpoint deliberately has
    no public counterpart and no cacheable response.
    """
    owned_trip(session, trip_id, subject)
    return Response(status_code=status.HTTP_204_NO_CONTENT, headers={"Cache-Control": "no-store"})


def owned_broad_route(session: Session, trip_id: str, subject: str, route_id: str) -> BroadRoute:
    owned_trip(session, trip_id, subject)
    route = session.scalar(select(BroadRoute).where(BroadRoute.id == route_id, BroadRoute.trip_id == trip_id))
    if route is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Broad route not found")
    return route


@router.get("/broad-routes", response_model=list[BroadRouteResponse])
def list_broad_routes(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[BroadRoute]:
    owned_trip(session, trip_id, subject)
    return list(session.scalars(select(BroadRoute).where(BroadRoute.trip_id == trip_id).order_by(BroadRoute.created_at)))


@router.post("/broad-routes", response_model=BroadRouteResponse, status_code=status.HTTP_201_CREATED)
def create_broad_route(trip_id: str, payload: BroadRouteCreate, session: SessionDep, subject: SubjectDep) -> BroadRoute:
    owned_trip(session, trip_id, subject)
    route = BroadRoute(trip_id=trip_id, **payload.model_dump())
    session.add(route)
    session.commit()
    session.refresh(route)
    return route


@router.get("/broad-routes/{route_id}", response_model=BroadRouteResponse)
def get_broad_route(trip_id: str, route_id: str, session: SessionDep, subject: SubjectDep) -> BroadRoute:
    return owned_broad_route(session, trip_id, subject, route_id)


@router.patch("/broad-routes/{route_id}", response_model=BroadRouteResponse)
def update_broad_route(
    trip_id: str, route_id: str, payload: BroadRouteUpdate, session: SessionDep, subject: SubjectDep
) -> BroadRoute:
    route = owned_broad_route(session, trip_id, subject, route_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(route, field, value)
    session.commit()
    session.refresh(route)
    return route


@router.delete("/broad-routes/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_broad_route(trip_id: str, route_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    session.delete(owned_broad_route(session, trip_id, subject, route_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
