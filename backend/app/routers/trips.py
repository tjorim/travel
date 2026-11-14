from collections.abc import Iterator
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..export import EXPORT_SCHEMA_VERSION, record_export, stream_trip_export
from ..models import ActivityTransport, OwnerActivityEvent, TravelUpdate
from ..schemas import (
    Identifier,
    TravelUpdateCreate,
    TravelUpdatePatch,
    TravelUpdateResponse,
    TripCreate,
    TripOverviewResponse,
    TripResponse,
    TripSummaryResponse,
    TripUpdate,
)
from ..services import travel_updates
from ..services import trips as service
from ..services.trips import DEFAULT_TRIP_PAGE, owned_trip
from ..storage import ObjectStorage, get_storage
from ..trip_pdf import (
    EphemeralPdfResponse,
    PdfRequest,
    _slots,
    check_budget,
    generate_pdf,
    snapshot_budget,
    temporary_pdf,
)

router = APIRouter(prefix="/trips", tags=["trips"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


@router.get("", response_model=list[TripSummaryResponse])
def list_trips(
    session: SessionDep,
    subject: SubjectDep,
    q: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = DEFAULT_TRIP_PAGE,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[TripSummaryResponse]:
    """The owner's trips, newest first, without any embedded record.

    Read a trip's travel updates from ``/trips/{id}/travel-updates``.
    """
    return service.list_trips(session, subject, q=q, limit=limit, offset=offset)


@router.post("", response_model=TripResponse, status_code=status.HTTP_201_CREATED)
def create_trip(payload: TripCreate, session: SessionDep, subject: SubjectDep) -> TripResponse:
    created = service.create_trip(session, subject, payload)
    session.commit()
    return created


@router.get("/{trip_id}", response_model=TripResponse)
def get_trip(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> TripResponse:
    return service.get_trip(session, subject, trip_id)


def _export_chunks(bind: object, trip_id: str, subject: str) -> Iterator[str]:
    """Stream from one consistent snapshot, re-checking ownership inside it."""
    with Session(bind=bind) as snapshot:  # ty: ignore[invalid-argument-type]
        if snapshot.get_bind().dialect.name == "postgresql":
            snapshot.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        trip = owned_trip(snapshot, trip_id, subject)
        yield from stream_trip_export(snapshot, trip)


@router.get(
    "/{trip_id}/export",
    response_class=StreamingResponse,
    responses={200: {"content": {"application/json": {}}, "description": f"Schema {EXPORT_SCHEMA_VERSION}"}},
)
def export_trip(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> StreamingResponse:
    """Private, read-only JSON of this trip's canonical records (no files, keys or capabilities)."""
    owned_trip(session, trip_id, subject)
    record_export(session, subject=subject, trip_id=trip_id)
    return StreamingResponse(
        _export_chunks(session.get_bind(), trip_id, subject),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="trip-{trip_id}-export.json"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/{trip_id}/export/pdf", response_class=StreamingResponse)
def export_trip_pdf(
    trip_id: Identifier,
    payload: PdfRequest,
    session: SessionDep,
    subject: SubjectDep,
    storage: Annotated[ObjectStorage, Depends(get_storage)],
) -> StreamingResponse:
    owned_trip(session, trip_id, subject)
    temporary = temporary_pdf()
    try:
        with Session(bind=session.get_bind()) as snapshot:
            if snapshot.get_bind().dialect.name == "postgresql":
                snapshot.connection(execution_options={"isolation_level": "REPEATABLE READ"})
            with snapshot_budget(snapshot) as deadline:
                if snapshot.get_bind().dialect.name == "postgresql":
                    snapshot.execute(text("SET LOCAL statement_timeout = '5000ms'"))
                owned_trip(snapshot, trip_id, subject)
                check_budget(snapshot, trip_id)
                trip = owned_trip(snapshot, trip_id, subject)
                output = generate_pdf(snapshot, trip, payload, storage, Path(temporary.name), deadline=deadline)
        session.add(
            OwnerActivityEvent(
                owner_subject=subject,
                transport=ActivityTransport.HTTP,
                action="trip.export_pdf",
                resource_type="trip",
                resource_id=trip_id,
                trip_id=trip_id,
                result="success",
                details={},
            )
        )
        session.commit()
    except BaseException:
        try:
            temporary.cleanup()
        finally:
            _slots.release()
        raise

    closed = False

    def close():
        nonlocal closed
        if not closed:
            closed = True
            try:
                temporary.cleanup()
            finally:
                _slots.release()

    def chunks():
        try:
            with output.open("rb") as source:
                while chunk := source.read(64 * 1024):
                    yield chunk
        finally:
            close()

    return EphemeralPdfResponse(
        chunks(),
        cleanup=close,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="trip-{trip_id}.pdf"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Robots-Tag": "noindex, noarchive",
        },
    )


@router.get("/{trip_id}/overview", response_model=TripOverviewResponse)
def get_trip_overview(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> dict:
    """Counts per kind, what each audience receives, and what to review before sharing."""
    return service.get_trip_overview(session, subject, trip_id)


@router.patch("/{trip_id}", response_model=TripResponse)
def update_trip(trip_id: Identifier, payload: TripUpdate, session: SessionDep, subject: SubjectDep) -> TripResponse:
    updated = service.update_trip(session, subject, trip_id, payload)
    session.commit()
    return updated


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trip(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    service.delete_trip(session, subject, trip_id)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{trip_id}/travel-updates", response_model=list[TravelUpdateResponse])
def list_travel_updates(
    trip_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    q: str | None = None,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    latest: Annotated[
        int | None,
        Query(ge=1, le=100, description="Only the newest N updates, still in chronological order."),
    ] = None,
) -> list[TravelUpdate]:
    """The trip's updates in chronological order (``TRAVEL_UPDATE_ORDER``, the order of every other surface)."""
    return travel_updates.list_travel_updates(session, subject, trip_id, q=q, limit=limit, offset=offset, latest=latest)


@router.post("/{trip_id}/travel-updates", response_model=TravelUpdateResponse, status_code=status.HTTP_201_CREATED)
def create_travel_update(
    trip_id: Identifier, payload: TravelUpdateCreate, session: SessionDep, subject: SubjectDep
) -> TravelUpdate:
    update_id = travel_updates.create_travel_update(session, subject, trip_id, payload).id
    session.commit()
    return travel_updates.travel_update_by_id(session, update_id)


@router.patch("/{trip_id}/travel-updates/{update_id}", response_model=TravelUpdateResponse)
def update_travel_update(
    trip_id: Identifier, update_id: Identifier, payload: TravelUpdatePatch, session: SessionDep, subject: SubjectDep
) -> TravelUpdate:
    travel_updates.update_travel_update(session, subject, trip_id, update_id, payload)
    session.commit()
    return travel_updates.travel_update_by_id(session, update_id)


@router.delete("/{trip_id}/travel-updates/{update_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_travel_update(
    trip_id: Identifier, update_id: Identifier, session: SessionDep, subject: SubjectDep
) -> Response:
    travel_updates.delete_travel_update(session, subject, trip_id, update_id)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{trip_id}/offline-map", status_code=status.HTTP_204_NO_CONTENT)
def revalidate_offline_map(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    """Owner-only revalidation target for an explicitly pinned map snapshot.

    The snapshot itself is assembled in the client from the already owner-scoped
    routes, areas and locations endpoints. This small endpoint deliberately has no public
    counterpart and no cacheable response.
    """
    owned_trip(session, trip_id, subject)
    return Response(status_code=status.HTTP_204_NO_CONTENT, headers={"Cache-Control": "no-store"})
