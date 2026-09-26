from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..access import set_visibility
from ..auth import current_subject
from ..database import get_session
from ..models import (
    Location,
    MediaAsset,
    MediaDerivative,
    Route,
    Stay,
    TravelUpdate,
    TravelUpdateMediaAsset,
    Trip,
    Visibility,
)
from ..overview import trip_overview
from ..schemas import (
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
        selectinload(Trip.stays).selectinload(Stay.location).selectinload(Location.area),
        selectinload(Trip.routes).selectinload(Route.departure_area),
        selectinload(Trip.routes).selectinload(Route.arrival_area),
        selectinload(Trip.routes).selectinload(Route.departure_location).selectinload(Location.area),
        selectinload(Trip.routes).selectinload(Route.arrival_location).selectinload(Location.area),
        selectinload(Trip.routes).selectinload(Route.document_links),
        selectinload(Trip.trip_tasks),
        selectinload(Trip.media_derivatives).selectinload(MediaDerivative.media_asset),
    )


def media_links_from_ids(session: Session, trip_id: str, media_asset_ids: list[str]) -> list[TravelUpdateMediaAsset]:
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
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="One or more media assets are unavailable for this trip",
        )
    by_id = {asset.id: asset for asset in assets}
    return [TravelUpdateMediaAsset(media_asset=by_id[asset_id]) for asset_id in media_asset_ids]


def owned_trip(session: Session, trip_id: str, subject: str) -> Trip:
    trip = session.scalar(trip_query().where(Trip.id == trip_id, Trip.owner_subject == subject))
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    return trip


@router.get("", response_model=list[TripResponse])
def list_trips(session: SessionDep, subject: SubjectDep) -> list[Trip]:
    return list(session.scalars(trip_query().where(Trip.owner_subject == subject).order_by(Trip.created_at.desc())))


@router.post("", response_model=TripResponse, status_code=status.HTTP_201_CREATED)
def create_trip(payload: TripCreate, session: SessionDep, subject: SubjectDep) -> Trip:
    trip = Trip(owner_subject=subject, **payload.model_dump())
    session.add(trip)
    session.commit()
    return owned_trip(session, trip.id, subject)


@router.get("/{trip_id}", response_model=TripResponse)
def get_trip(trip_id: str, session: SessionDep, subject: SubjectDep) -> Trip:
    return owned_trip(session, trip_id, subject)


@router.get("/{trip_id}/overview", response_model=TripOverviewResponse)
def get_trip_overview(trip_id: str, session: SessionDep, subject: SubjectDep) -> dict:
    """Counts per kind, what each audience receives, and what to review before sharing."""
    return trip_overview(session, owned_trip(session, trip_id, subject))


@router.patch("/{trip_id}", response_model=TripResponse)
def update_trip(trip_id: str, payload: TripUpdate, session: SessionDep, subject: SubjectDep) -> Trip:
    trip = owned_trip(session, trip_id, subject)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(trip, field, value)
    if trip.starts_on is not None and trip.ends_on is not None and trip.ends_on < trip.starts_on:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="The trip cannot end before it starts")
    session.commit()
    return owned_trip(session, trip_id, subject)


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trip(trip_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    session.delete(owned_trip(session, trip_id, subject))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _loaded(session: Session, update_id: str) -> TravelUpdate:
    return session.scalar(
        select(TravelUpdate)
        .options(selectinload(TravelUpdate.chosen_area), selectinload(TravelUpdate.location), selectinload(TravelUpdate.media_links))
        .where(TravelUpdate.id == update_id)
    )  # type: ignore[return-value]


@router.post("/{trip_id}/travel-updates", response_model=TravelUpdateResponse, status_code=status.HTTP_201_CREATED)
def create_travel_update(
    trip_id: str, payload: TravelUpdateCreate, session: SessionDep, subject: SubjectDep
) -> TravelUpdate:
    trip = owned_trip(session, trip_id, subject)
    location = location_from_input(session, trip.id, payload.location) if payload.location else None
    if location is not None and payload.area_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="An update with a location gets its area from that location",
        )
    update = TravelUpdate(
        trip=trip,
        area_id=selected_area(session, trip.id, payload.area_id).id if location is None and payload.area_id is not None else None,
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
        _choose_visibility(trip, update, payload.visibility)
    session.commit()
    return _loaded(session, update.id)


def owned_update(trip: Trip, update_id: str) -> TravelUpdate:
    update = next((item for item in trip.travel_updates if item.id == update_id), None)
    if update is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Travel update not found")
    return update


def _choose_visibility(trip: Trip, update: TravelUpdate, visibility: Visibility) -> None:
    try:
        set_visibility(trip, "travel_update", update.id, visibility)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error


@router.patch("/{trip_id}/travel-updates/{update_id}", response_model=TravelUpdateResponse)
def update_travel_update(
    trip_id: str, update_id: str, payload: TravelUpdatePatch, session: SessionDep, subject: SubjectDep
) -> TravelUpdate:
    trip = owned_trip(session, trip_id, subject)
    update = owned_update(trip, update_id)
    # A present null is intentional: the owner may remove a location or notes
    # while editing. Pydantic otherwise represents omitted and null alike.
    if "location" in payload.model_fields_set:
        update.location = location_from_input(session, trip.id, payload.location) if payload.location else None
    if update.location is not None:
        if "area_id" in payload.model_fields_set and payload.area_id is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="An update with a location gets its area from that location",
            )
        update.area_id = None
    elif "area_id" in payload.model_fields_set:
        update.area_id = selected_area(session, trip.id, payload.area_id).id if payload.area_id is not None else None
    if "media_asset_ids" in payload.model_fields_set:
        update.media_links = media_links_from_ids(session, trip.id, payload.media_asset_ids or [])
    values = payload.model_dump(
        exclude_unset=True, exclude={"area_id", "location", "media_asset_ids", "visibility"}
    )
    for field, value in values.items():
        if value is None and field in {"occurred_at", "date_precision", "title", "body"}:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{field} is required")
        setattr(update, field, value)
    if payload.visibility is not None:
        _choose_visibility(trip, update, payload.visibility)
    elif update.visibility != Visibility.PRIVATE and not update.body.strip():
        # An update cannot keep reaching visitors once its text is emptied.
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Write the text for visitors before sharing this update")
    session.commit()
    return _loaded(session, update.id)


@router.delete("/{trip_id}/travel-updates/{update_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_travel_update(trip_id: str, update_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    trip = owned_trip(session, trip_id, subject)
    session.delete(owned_update(trip, update_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{trip_id}/offline-map", status_code=status.HTTP_204_NO_CONTENT)
def revalidate_offline_map(trip_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    """Owner-only revalidation target for an explicitly pinned map snapshot.

    The snapshot itself is assembled in the client from the already owner-scoped
    routes, areas and locations endpoints. This small endpoint deliberately has no public
    counterpart and no cacheable response.
    """
    owned_trip(session, trip_id, subject)
    return Response(status_code=status.HTTP_204_NO_CONTENT, headers={"Cache-Control": "no-store"})
