from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, object_session, selectinload

from ..access import receivers, set_cover, set_visibility
from ..audit import delivering_audiences, record_visibility_change
from ..auth import current_subject
from ..database import get_session
from ..errors import ApiException, ServiceError, service_exception
from ..export import EXPORT_SCHEMA_VERSION, record_export, stream_trip_export
from ..models import (
    Location,
    MediaAsset,
    MediaDerivative,
    ObjectState,
    Route,
    Stay,
    StoredObject,
    TravelUpdate,
    TravelUpdateMediaAsset,
    Trip,
    Visibility,
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
    TripUpdate,
)
from .placement import location_from_input, selected_area

router = APIRouter(prefix="/trips", tags=["trips"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def trip_query():
    return select(Trip).options(
        selectinload(Trip.areas),
        selectinload(Trip.locations),
        selectinload(Trip.travel_updates).selectinload(TravelUpdate.chosen_area),
        selectinload(Trip.travel_updates).selectinload(TravelUpdate.location).selectinload(Location.area),
        selectinload(Trip.travel_updates).selectinload(TravelUpdate.media_links),
        selectinload(Trip.stays).selectinload(Stay.area),
        selectinload(Trip.stays).selectinload(Stay.location).selectinload(Location.area),
        selectinload(Trip.stays).selectinload(Stay.document_links),
        selectinload(Trip.routes).selectinload(Route.departure_area),
        selectinload(Trip.routes).selectinload(Route.arrival_area),
        selectinload(Trip.routes).selectinload(Route.departure_location).selectinload(Location.area),
        selectinload(Trip.routes).selectinload(Route.arrival_location).selectinload(Location.area),
        selectinload(Trip.routes).selectinload(Route.document_links),
        selectinload(Trip.trip_tasks),
        selectinload(Trip.media_derivatives).selectinload(MediaDerivative.media_asset),
    )


def media_links_from_ids(
    session: Session, trip_id: Identifier, media_asset_ids: list[str]
) -> list[TravelUpdateMediaAsset]:
    """Resolve attachments inside the already-authorized trip boundary.

    The association intentionally stores no EXIF, file URL or share state.
    A client can only attach non-deleted assets owned by this trip.
    """
    if not media_asset_ids:
        return []
    assets = list(
        session.scalars(
            select(MediaAsset).where(
                MediaAsset.trip_id == trip_id,
                MediaAsset.id.in_(media_asset_ids),
                MediaAsset.deleted_at.is_(None),
            )
        )
    )
    if len(assets) != len(media_asset_ids):
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="One or more media assets are unavailable for this trip",
            code="one_or_more_media_assets_are_unavailable_for_this_trip",
        )
    by_id = {asset.id: asset for asset in assets}
    return [TravelUpdateMediaAsset(media_asset=by_id[asset_id]) for asset_id in media_asset_ids]


def owned_trip(session: Session, trip_id: Identifier, subject: str, *, load_relations: bool = True) -> Trip:
    statement = trip_query() if load_relations else select(Trip)
    trip = session.scalar(statement.where(Trip.id == trip_id, Trip.owner_subject == subject))
    if trip is None:
        raise ApiException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found", code="not_found")
    return trip


@router.get("", response_model=list[TripResponse])
def list_trips(
    session: SessionDep,
    subject: SubjectDep,
    q: str | None = None,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Trip]:
    statement = trip_query().where(Trip.owner_subject == subject).order_by(Trip.created_at.desc())
    if q or limit is not None or offset:
        statement = statement.order_by(Trip.id)
    if q:
        statement = statement.where(Trip.title.ilike(f"%{q}%"))
    if limit is not None:
        statement = statement.limit(limit)
    return list(session.scalars(statement.offset(offset)))


@router.post("", response_model=TripResponse, status_code=status.HTTP_201_CREATED)
def create_trip(payload: TripCreate, session: SessionDep, subject: SubjectDep) -> Trip:
    trip = Trip(owner_subject=subject, **payload.model_dump())
    session.add(trip)
    session.commit()
    return owned_trip(session, trip.id, subject)


@router.get("/{trip_id}", response_model=TripResponse)
def get_trip(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> Trip:
    return owned_trip(session, trip_id, subject)


def _export_chunks(bind: object, trip_id: str, subject: str) -> Iterator[str]:
    """Stream from one consistent snapshot, re-checking ownership inside it."""
    with Session(bind=bind) as snapshot:  # ty: ignore[invalid-argument-type]
        if snapshot.get_bind().dialect.name == "postgresql":
            snapshot.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        trip = owned_trip(snapshot, trip_id, subject, load_relations=False)
        yield from stream_trip_export(snapshot, trip)


@router.get(
    "/{trip_id}/export",
    response_class=StreamingResponse,
    responses={200: {"content": {"application/json": {}}, "description": f"Schema {EXPORT_SCHEMA_VERSION}"}},
)
def export_trip(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> StreamingResponse:
    """Private, read-only JSON of this trip's canonical records (no files, keys or capabilities)."""
    owned_trip(session, trip_id, subject, load_relations=False)
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


@router.get("/{trip_id}/overview", response_model=TripOverviewResponse)
def get_trip_overview(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> dict:
    """Counts per kind, what each audience receives, and what to review before sharing."""
    return trip_overview(session, owned_trip(session, trip_id, subject))


@router.patch("/{trip_id}", response_model=TripResponse)
def update_trip(trip_id: Identifier, payload: TripUpdate, session: SessionDep, subject: SubjectDep) -> Trip:
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
    return owned_trip(session, trip_id, subject)


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trip(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    trip = owned_trip(session, trip_id, subject)
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


def _loaded(session: Session, update_id: Identifier) -> TravelUpdate:
    return session.execute(
        select(TravelUpdate)
        .options(
            selectinload(TravelUpdate.chosen_area),
            selectinload(TravelUpdate.location),
            selectinload(TravelUpdate.media_links),
        )
        .where(TravelUpdate.id == update_id)
    ).scalar_one()


@router.get("/{trip_id}/travel-updates", response_model=list[TravelUpdateResponse])
def list_travel_updates(
    trip_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    q: str | None = None,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[TravelUpdate]:
    trip = owned_trip(session, trip_id, subject, load_relations=False)
    statement = (
        select(TravelUpdate)
        .options(
            selectinload(TravelUpdate.chosen_area),
            selectinload(TravelUpdate.location).selectinload(Location.area),
            selectinload(TravelUpdate.media_links),
        )
        .where(TravelUpdate.trip_id == trip.id)
        .order_by(TravelUpdate.occurred_at.desc(), TravelUpdate.id)
    )
    if q:
        statement = statement.where(TravelUpdate.title.ilike(f"%{q}%"))
    if limit is not None:
        statement = statement.limit(limit)
    return list(session.scalars(statement.offset(offset)))


@router.post("/{trip_id}/travel-updates", response_model=TravelUpdateResponse, status_code=status.HTTP_201_CREATED)
def create_travel_update(
    trip_id: Identifier, payload: TravelUpdateCreate, session: SessionDep, subject: SubjectDep
) -> TravelUpdate:
    trip = owned_trip(session, trip_id, subject)
    location = location_from_input(session, trip.id, payload.location) if payload.location else None
    if location is not None and payload.area_id is not None:
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="An update with a location gets its area from that location",
            code="an_update_with_a_location_gets_its_area_from_that_location",
        )
    update = TravelUpdate(
        trip=trip,
        area_id=selected_area(session, trip.id, payload.area_id).id
        if location is None and payload.area_id is not None
        else None,
        location=location,
        media_links=media_links_from_ids(session, trip.id, payload.media_asset_ids),
        occurred_at=payload.occurred_at,
        date_precision=payload.date_precision,
        title=payload.title,
        body=payload.body,
        private_notes=payload.private_notes,
    )
    session.add(update)
    session.flush()
    if payload.visibility != Visibility.PRIVATE:
        _choose_visibility(trip, update, payload.visibility, subject)
    session.commit()
    return _loaded(session, update.id)


def owned_update(trip: Trip, update_id: Identifier) -> TravelUpdate:
    update = next((item for item in trip.travel_updates if item.id == update_id), None)
    if update is None:
        raise ApiException(status_code=status.HTTP_404_NOT_FOUND, detail="Travel update not found", code="not_found")
    return update


def _choose_visibility(trip: Trip, update: TravelUpdate, visibility: Visibility, subject: str) -> None:
    session = object_session(trip)
    assert session is not None
    before = update.visibility or Visibility.PRIVATE
    before_receivers = receivers("travel_update", update, delivering_audiences(session, trip.id))
    try:
        set_visibility(trip, "travel_update", update.id, visibility)
    except ValueError as error:
        raise service_exception(status.HTTP_422_UNPROCESSABLE_CONTENT, error) from error
    record_visibility_change(
        session,
        trip_id=trip.id,
        actor_subject=subject,
        kind="travel_update",
        record=update,
        before=before,
        before_receivers=before_receivers,
    )


@router.patch("/{trip_id}/travel-updates/{update_id}", response_model=TravelUpdateResponse)
def update_travel_update(
    trip_id: Identifier, update_id: Identifier, payload: TravelUpdatePatch, session: SessionDep, subject: SubjectDep
) -> TravelUpdate:
    trip = owned_trip(session, trip_id, subject)
    update = owned_update(trip, update_id)
    # A present null is intentional: the owner may remove a location or notes
    # while editing. Pydantic otherwise represents omitted and null alike.
    if "location" in payload.model_fields_set:
        update.location = location_from_input(session, trip.id, payload.location) if payload.location else None
    if update.location is not None:
        if "area_id" in payload.model_fields_set and payload.area_id is not None:
            raise ApiException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="An update with a location gets its area from that location",
                code="an_update_with_a_location_gets_its_area_from_that_location",
            )
        update.area_id = None
    elif "area_id" in payload.model_fields_set:
        update.area_id = selected_area(session, trip.id, payload.area_id).id if payload.area_id is not None else None
    if "media_asset_ids" in payload.model_fields_set:
        update.media_links = media_links_from_ids(session, trip.id, payload.media_asset_ids or [])
    values = payload.model_dump(exclude_unset=True, exclude={"area_id", "location", "media_asset_ids", "visibility"})
    for field, value in values.items():
        if value is None and field in {"occurred_at", "date_precision", "title", "body"}:
            raise ApiException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{field} is required",
                code="missing",
                field=field,
            )
        setattr(update, field, value)
    if payload.visibility is not None:
        _choose_visibility(trip, update, payload.visibility, subject)
    elif update.visibility != Visibility.PRIVATE and not update.body.strip():
        # An update cannot keep reaching visitors once its text is emptied.
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Write the text for visitors before sharing this update",
            code="write_the_text_for_visitors_before_sharing_this_update",
        )
    session.commit()
    return _loaded(session, update.id)


@router.delete("/{trip_id}/travel-updates/{update_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_travel_update(
    trip_id: Identifier, update_id: Identifier, session: SessionDep, subject: SubjectDep
) -> Response:
    trip = owned_trip(session, trip_id, subject)
    session.delete(owned_update(trip, update_id))
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
