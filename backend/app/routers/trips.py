from collections.abc import Iterator
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ..access import set_cover
from ..auth import current_subject
from ..database import get_session
from ..errors import ApiException, ServiceError, service_exception
from ..export import EXPORT_SCHEMA_VERSION, record_export, stream_trip_export
from ..models import (
    McpAuditEvent,
    MediaDerivative,
    ObjectState,
    StoredObject,
    TravelUpdate,
    Trip,
    cover_file_route,
)
from ..overview import trip_overview
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
from ..services.trips import owned_trip
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


DEFAULT_TRIP_PAGE = 100


def _covers(session: Session, trip_ids: list[str]) -> dict[str, MediaDerivative]:
    """The chosen cover copy of each trip, in one query that reads no other copy of the trip."""
    return {
        cover.trip_id: cover
        for cover in session.scalars(
            select(MediaDerivative).where(MediaDerivative.trip_id.in_(trip_ids), MediaDerivative.is_cover.is_(True))
        )
    }


def _trip_fields(trip: Trip, cover: MediaDerivative | None) -> dict:
    return {
        "id": trip.id,
        "owner_subject": trip.owner_subject,
        "title": trip.title,
        "summary": trip.summary,
        "starts_on": trip.starts_on,
        "ends_on": trip.ends_on,
        "cover_derivative_id": cover.id if cover else None,
        "cover_url": cover_file_route(trip.id, cover) if cover else None,
    }


def trip_response(session: Session, trip: Trip) -> TripResponse:
    """The trip's own fields and cover: two small queries, whatever the trip holds."""
    return TripResponse(**_trip_fields(trip, _covers(session, [trip.id]).get(trip.id)))


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
    statement = select(Trip).where(Trip.owner_subject == subject).order_by(Trip.created_at.desc(), Trip.id)
    if q:
        statement = statement.where(Trip.title.ilike(f"%{q}%"))
    found = list(session.scalars(statement.limit(limit).offset(offset)))
    ids = [trip.id for trip in found]
    covers = _covers(session, ids)
    updates = {
        trip_id: (count, last)
        for trip_id, count, last in session.execute(
            select(TravelUpdate.trip_id, func.count(), func.max(TravelUpdate.occurred_at))
            .where(TravelUpdate.trip_id.in_(ids))
            .group_by(TravelUpdate.trip_id)
        )
    }
    summaries = []
    for trip in found:
        update_count, last_update_at = updates.get(trip.id, (0, None))
        summaries.append(
            TripSummaryResponse(
                **_trip_fields(trip, covers.get(trip.id)),
                travel_update_count=update_count,
                last_update_at=last_update_at,
            )
        )
    return summaries


@router.post("", response_model=TripResponse, status_code=status.HTTP_201_CREATED)
def create_trip(payload: TripCreate, session: SessionDep, subject: SubjectDep) -> TripResponse:
    trip = Trip(owner_subject=subject, **payload.model_dump())
    session.add(trip)
    session.commit()
    return trip_response(session, trip)


@router.get("/{trip_id}", response_model=TripResponse)
def get_trip(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> TripResponse:
    return trip_response(session, owned_trip(session, trip_id, subject))


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
            McpAuditEvent(
                owner_subject=subject,
                action="trip.export_pdf",
                resource_type="trip",
                resource_id=trip_id,
                trip_id=trip_id,
                result="success",
                details={"transport": "http"},
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
    return trip_overview(session, owned_trip(session, trip_id, subject, load_relations=True))


@router.patch("/{trip_id}", response_model=TripResponse)
def update_trip(trip_id: Identifier, payload: TripUpdate, session: SessionDep, subject: SubjectDep) -> TripResponse:
    trip = owned_trip(session, trip_id, subject)
    changes = payload.model_dump(exclude_unset=True)
    if "cover_derivative_id" in changes:
        try:
            set_cover(trip, changes.pop("cover_derivative_id"))
        except ServiceError as error:
            raise service_exception(status.HTTP_422_UNPROCESSABLE_CONTENT, error) from error
    for field, value in changes.items():
        setattr(trip, field, value)
    if trip.starts_on is not None and trip.ends_on is not None and trip.ends_on < trip.starts_on:
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="The trip cannot end before it starts",
            code="the_trip_cannot_end_before_it_starts",
        )
    session.commit()
    return trip_response(session, trip)


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trip(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    # The delete cascades through the records and their links, so read them together instead of one by one.
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    # Serialize with result attachment before taking the final object inventory.
    # Worker jobs survive derivative deletion with a null link; dispatch retries
    # cancellation/ACK without making any provider call inside this transaction.
    list(session.scalars(select(MediaDerivative).where(MediaDerivative.trip_id == trip_id).with_for_update()))
    for stored in session.scalars(select(StoredObject).where(StoredObject.trip_id == trip_id).with_for_update()):
        stored.state = ObjectState.PURGE_PENDING
        stored.trip_id = None
    session.flush()
    session.delete(trip)
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
