from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..access import set_visibility
from ..auth import current_subject
from ..database import get_session
from ..models import (
    DocumentDerivative,
    MediaAsset,
    MediaDerivative,
    Place,
    PlaceKind,
    RouteStage,
    Stay,
    TransportLeg,
    TravelUpdate,
    TravelUpdateMediaAsset,
    Trip,
    Visibility,
)
from ..schemas import (
    BroadPlaceInput,
    ExactPlaceInput,
    RouteStageCreate,
    RouteStageResponse,
    RouteStageUpdate,
    TravelUpdateCreate,
    TravelUpdatePatch,
    TravelUpdateResponse,
    TripCreate,
    TripResponse,
    TripUpdate,
)

router = APIRouter(prefix="/trips", tags=["trips"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def trip_query():
    return select(Trip).options(
        selectinload(Trip.route_stages).selectinload(RouteStage.place),
        selectinload(Trip.places),
        selectinload(Trip.travel_updates).selectinload(TravelUpdate.broad_place),
        selectinload(Trip.travel_updates).selectinload(TravelUpdate.place).selectinload(Place.area),
        selectinload(Trip.travel_updates).selectinload(TravelUpdate.media_links),
        selectinload(Trip.stays).selectinload(Stay.place).selectinload(Place.area),
        selectinload(Trip.stays).selectinload(Stay.broad_place),
        selectinload(Trip.broad_routes),
        selectinload(Trip.transport_legs).selectinload(TransportLeg.departure_place).selectinload(Place.area),
        selectinload(Trip.transport_legs).selectinload(TransportLeg.arrival_place).selectinload(Place.area),
        selectinload(Trip.transport_legs).selectinload(TransportLeg.document_links),
        selectinload(Trip.itinerary_entries),
        selectinload(Trip.trip_tasks),
        selectinload(Trip.media_derivatives).selectinload(MediaDerivative.media_asset),
        selectinload(Trip.document_derivatives).selectinload(DocumentDerivative.document_asset),
    )


def broad_place_from_input(session: Session, trip_id: str, payload: BroadPlaceInput) -> Place:
    place = Place(trip_id=trip_id, kind=PlaceKind.BROAD, **payload.model_dump())
    session.add(place)
    session.flush()
    return place


def selected_broad_place(session: Session, trip_id: str, place_id: str) -> Place:
    place = session.scalar(
        select(Place).where(Place.id == place_id, Place.trip_id == trip_id, Place.kind == PlaceKind.BROAD)
    )
    if place is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Broad place is unavailable for this trip")
    return place


def broad_place_for_stage(session: Session, trip_id: str, payload: RouteStageCreate | RouteStageUpdate) -> Place:
    if payload.broad_place_id is not None:
        return selected_broad_place(session, trip_id, payload.broad_place_id)
    if payload.place is not None:
        return broad_place_from_input(session, trip_id, payload.place)
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A broad place is required")


def area_for_spot(session: Session, trip_id: str, spot: Place) -> Place:
    """The area a new spot belongs to, found or made from the spot's own city.

    An existing area with the same name (and a compatible country) is reused, so
    every hotel and airport in Taipei ends up in one "Taipei". A spot without
    city data is still filed, temporarily, under one private "Unassigned"
    area for its trip. This preserves the one non-negotiable relationship:
    every spot has an area, while making those incomplete records easy to find
    and rename in the owner UI."""
    name = (spot.locality or spot.admin_area or "").strip()
    fallback = not name
    if fallback:
        name = "Unassigned"
    for area in session.scalars(
        select(Place).where(Place.trip_id == trip_id, Place.kind == PlaceKind.BROAD, func.lower(Place.label) == name.lower())
    ):
        if not area.country_code or not spot.country_code or area.country_code == spot.country_code:
            return area
    area = Place(
        trip_id=trip_id, kind=PlaceKind.BROAD, label=name[:120], country_code=spot.country_code,
        region=spot.admin_area if spot.locality and not fallback else None,
    )
    session.add(area)
    session.flush()
    return area


def exact_place_from_input(session: Session, trip_id: str, payload: ExactPlaceInput) -> Place:
    """Create a spot in its area, or return the spot the trip already has."""
    if payload.existing_place_id is not None:
        existing = session.scalar(
            select(Place).where(
                Place.id == payload.existing_place_id, Place.trip_id == trip_id, Place.kind == PlaceKind.EXACT
            )
        )
        if existing is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Place not found on this trip")
        return existing
    place = Place(trip_id=trip_id, kind=PlaceKind.EXACT, **payload.model_dump(exclude={"existing_place_id", "area_id"}))
    if payload.area_id is not None:
        place.area = selected_broad_place(session, trip_id, payload.area_id)
    else:
        place.area = area_for_spot(session, trip_id, place)
    session.add(place)
    session.flush()
    return place


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


def commit_or_conflict(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Conflicting route-stage position") from error


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


@router.post("/{trip_id}/route-stages", response_model=RouteStageResponse, status_code=status.HTTP_201_CREATED)
def create_route_stage(trip_id: str, payload: RouteStageCreate, session: SessionDep, subject: SubjectDep) -> RouteStage:
    trip = owned_trip(session, trip_id, subject)
    stage = RouteStage(
        trip=trip,
        place=broad_place_for_stage(session, trip.id, payload),
        position=payload.position,
        label=payload.label,
        summary=payload.summary,
    )
    session.add(stage)
    commit_or_conflict(session)
    return session.scalar(select(RouteStage).options(selectinload(RouteStage.place)).where(RouteStage.id == stage.id))  # type: ignore[return-value]


def owned_stage(trip: Trip, stage_id: str) -> RouteStage:
    stage = next((item for item in trip.route_stages if item.id == stage_id), None)
    if stage is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Route stage not found")
    return stage


@router.patch("/{trip_id}/route-stages/{stage_id}", response_model=RouteStageResponse)
def update_route_stage(
    trip_id: str, stage_id: str, payload: RouteStageUpdate, session: SessionDep, subject: SubjectDep
) -> RouteStage:
    trip = owned_trip(session, trip_id, subject)
    stage = owned_stage(trip, stage_id)
    if payload.place is not None or payload.broad_place_id is not None:
        stage.place = broad_place_for_stage(session, trip.id, payload)
    if payload.position is not None and payload.position != stage.position:
        ordered = sorted(trip.route_stages, key=lambda item: item.position)
        ordered.remove(stage)
        ordered.insert(min(payload.position, len(ordered)), stage)
        # The unique trip/position constraint makes an ordinary swap fail.
        # Move every row out of its current range before compacting it again.
        offset = max((item.position for item in trip.route_stages), default=0) + len(ordered) + 1
        for item in trip.route_stages:
            item.position += offset
        session.flush()
        for position, item in enumerate(ordered):
            item.position = position
    for field, value in payload.model_dump(exclude_unset=True, exclude={"place", "broad_place_id", "position"}).items():
        setattr(stage, field, value)
    commit_or_conflict(session)
    return session.scalar(select(RouteStage).options(selectinload(RouteStage.place)).where(RouteStage.id == stage.id))  # type: ignore[return-value]


@router.delete("/{trip_id}/route-stages/{stage_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_route_stage(trip_id: str, stage_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    trip = owned_trip(session, trip_id, subject)
    session.delete(owned_stage(trip, stage_id))
    session.flush()
    remaining = list(
        session.scalars(select(RouteStage).where(RouteStage.trip_id == trip.id).order_by(RouteStage.position))
    )
    # Compact positions after a removal so the next add can use the end of
    # the visible ordered list without colliding with a stale gap.
    offset = max((item.position for item in remaining), default=0) + len(remaining) + 1
    for item in remaining:
        item.position += offset
    session.flush()
    for position, item in enumerate(remaining):
        item.position = position
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def resolve_broad_place_id(session: Session, trip: Trip, broad_place_id: str | None) -> str | None:
    if broad_place_id is None:
        return None
    place = session.scalar(
        select(Place).where(Place.id == broad_place_id, Place.trip_id == trip.id, Place.kind == PlaceKind.BROAD)
    )
    if place is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Broad place not found on this trip")
    return place.id


def _loaded(session: Session, update_id: str) -> TravelUpdate:
    return session.scalar(
        select(TravelUpdate)
        .options(selectinload(TravelUpdate.broad_place), selectinload(TravelUpdate.place), selectinload(TravelUpdate.media_links))
        .where(TravelUpdate.id == update_id)
    )  # type: ignore[return-value]


@router.post("/{trip_id}/travel-updates", response_model=TravelUpdateResponse, status_code=status.HTTP_201_CREATED)
def create_travel_update(
    trip_id: str, payload: TravelUpdateCreate, session: SessionDep, subject: SubjectDep
) -> TravelUpdate:
    trip = owned_trip(session, trip_id, subject)
    spot = exact_place_from_input(session, trip.id, payload.place) if payload.place else None
    if spot is not None and payload.broad_place_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="An update with a spot gets its area from that spot",
        )
    update = TravelUpdate(
        trip=trip,
        broad_place_id=resolve_broad_place_id(session, trip, payload.broad_place_id) if spot is None else None,
        place=spot,
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
    # A present null is intentional: the owner may remove a place or notes
    # while editing. Pydantic otherwise represents omitted and null alike.
    if "place" in payload.model_fields_set:
        update.place = exact_place_from_input(session, trip.id, payload.place) if payload.place else None
    if update.place is not None:
        if "broad_place_id" in payload.model_fields_set and payload.broad_place_id is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="An update with a spot gets its area from that spot",
            )
        update.broad_place_id = None
    elif "broad_place_id" in payload.model_fields_set:
        update.broad_place_id = resolve_broad_place_id(session, trip, payload.broad_place_id)
    if "media_asset_ids" in payload.model_fields_set:
        update.media_links = media_links_from_ids(session, trip.id, payload.media_asset_ids or [])
    values = payload.model_dump(
        exclude_unset=True, exclude={"broad_place_id", "place", "media_asset_ids", "visibility"}
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
