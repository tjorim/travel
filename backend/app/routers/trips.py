from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..auth import current_subject
from ..database import get_session
from ..models import (
    BroadStayCard,
    DocumentDerivative,
    MediaAsset,
    MediaDerivative,
    Moment,
    MomentExcerpt,
    MomentMediaAsset,
    Place,
    PlaceKind,
    PublicationState,
    RouteStage,
    Stay,
    TransportLeg,
    Trip,
    Visibility,
    opaque_id,
)
from ..schemas import (
    BroadPlaceInput,
    ExactPlaceInput,
    MomentCreate,
    MomentExcerptCreate,
    MomentExcerptResponse,
    MomentExcerptUpdate,
    MomentResponse,
    MomentUpdate,
    RouteStageCreate,
    RouteStageResponse,
    RouteStageUpdate,
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
        selectinload(Trip.moments).selectinload(Moment.place),
        selectinload(Trip.moments).selectinload(Moment.media_links),
        selectinload(Trip.moment_excerpts).selectinload(MomentExcerpt.broad_place),
        selectinload(Trip.stays).selectinload(Stay.place),
        selectinload(Trip.broad_stay_cards).selectinload(BroadStayCard.place),
        selectinload(Trip.broad_routes),
        selectinload(Trip.transport_legs).selectinload(TransportLeg.departure_place),
        selectinload(Trip.transport_legs).selectinload(TransportLeg.arrival_place),
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


def exact_place_from_input(session: Session, trip_id: str, payload: ExactPlaceInput) -> Place:
    place = Place(trip_id=trip_id, kind=PlaceKind.EXACT, **payload.model_dump())
    session.add(place)
    session.flush()
    return place


def media_links_from_ids(session: Session, trip_id: str, media_asset_ids: list[str]) -> list[MomentMediaAsset]:
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
    return [MomentMediaAsset(media_asset=by_id[asset_id]) for asset_id in media_asset_ids]


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
    if trip.publication_state == PublicationState.PUBLISHED and trip.visibility == Visibility.PRIVATE:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Private trips cannot be published")
    if trip.publication_state == PublicationState.PUBLISHED and trip.public_id is None:
        trip.public_id = opaque_id()
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


@router.post("/{trip_id}/moments", response_model=MomentResponse, status_code=status.HTTP_201_CREATED)
def create_moment(trip_id: str, payload: MomentCreate, session: SessionDep, subject: SubjectDep) -> Moment:
    trip = owned_trip(session, trip_id, subject)
    values = payload.model_dump(exclude={"place", "photo_urls", "media_asset_ids"})
    moment = Moment(
        trip=trip,
        author_subject=subject,
        place=exact_place_from_input(session, trip.id, payload.place) if payload.place else None,
        photo_urls=[str(url) for url in payload.photo_urls],
        media_links=media_links_from_ids(session, trip.id, payload.media_asset_ids),
        **values,
    )
    session.add(moment)
    session.commit()
    return session.scalar(
        select(Moment).options(selectinload(Moment.place), selectinload(Moment.media_links)).where(Moment.id == moment.id)
    )  # type: ignore[return-value]


def owned_moment(trip: Trip, moment_id: str) -> Moment:
    moment = next((item for item in trip.moments if item.id == moment_id), None)
    if moment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Moment not found")
    return moment


@router.patch("/{trip_id}/moments/{moment_id}", response_model=MomentResponse)
def update_moment(
    trip_id: str, moment_id: str, payload: MomentUpdate, session: SessionDep, subject: SubjectDep
) -> Moment:
    trip = owned_trip(session, trip_id, subject)
    moment = owned_moment(trip, moment_id)
    # A present null is intentional: the traveller may remove an attached
    # place while editing a moment.  Pydantic otherwise represents both an
    # omitted field and null as None.
    if "place" in payload.model_fields_set:
        moment.place = exact_place_from_input(session, trip.id, payload.place) if payload.place else None
    values = payload.model_dump(exclude_unset=True, exclude={"place", "photo_urls", "media_asset_ids"})
    for field, value in values.items():
        setattr(moment, field, value)
    if payload.photo_urls is not None:
        moment.photo_urls = [str(url) for url in payload.photo_urls]
    if "media_asset_ids" in payload.model_fields_set:
        moment.media_links = media_links_from_ids(session, trip.id, payload.media_asset_ids or [])
    session.commit()
    return session.scalar(
        select(Moment).options(selectinload(Moment.place), selectinload(Moment.media_links)).where(Moment.id == moment.id)
    )  # type: ignore[return-value]


@router.delete("/{trip_id}/moments/{moment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_moment(trip_id: str, moment_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    session.delete(owned_moment(owned_trip(session, trip_id, subject), moment_id))
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


def resolve_source_moment_id(trip: Trip, source_moment_id: str | None) -> str | None:
    if source_moment_id is None:
        return None
    if not any(moment.id == source_moment_id for moment in trip.moments):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Source moment not found on this trip"
        )
    return source_moment_id


@router.post(
    "/{trip_id}/moment-excerpts", response_model=MomentExcerptResponse, status_code=status.HTTP_201_CREATED
)
def create_moment_excerpt(
    trip_id: str, payload: MomentExcerptCreate, session: SessionDep, subject: SubjectDep
) -> MomentExcerpt:
    trip = owned_trip(session, trip_id, subject)
    excerpt = MomentExcerpt(
        trip=trip,
        source_moment_id=resolve_source_moment_id(trip, payload.source_moment_id),
        broad_place_id=resolve_broad_place_id(session, trip, payload.broad_place_id),
        date_precision=payload.date_precision,
        story_date=payload.story_date,
        title=payload.title,
        body=payload.body,
    )
    session.add(excerpt)
    session.commit()
    return excerpt


def owned_excerpt(trip: Trip, excerpt_id: str) -> MomentExcerpt:
    excerpt = next((item for item in trip.moment_excerpts if item.id == excerpt_id), None)
    if excerpt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Moment excerpt not found")
    return excerpt


@router.patch("/{trip_id}/moment-excerpts/{excerpt_id}", response_model=MomentExcerptResponse)
def update_moment_excerpt(
    trip_id: str, excerpt_id: str, payload: MomentExcerptUpdate, session: SessionDep, subject: SubjectDep
) -> MomentExcerpt:
    trip = owned_trip(session, trip_id, subject)
    excerpt = owned_excerpt(trip, excerpt_id)
    if "source_moment_id" in payload.model_fields_set:
        excerpt.source_moment_id = resolve_source_moment_id(trip, payload.source_moment_id)
    if "broad_place_id" in payload.model_fields_set:
        excerpt.broad_place_id = resolve_broad_place_id(session, trip, payload.broad_place_id)
    values = payload.model_dump(exclude_unset=True, exclude={"source_moment_id", "broad_place_id"})
    for field, value in values.items():
        setattr(excerpt, field, value)
    session.commit()
    return excerpt


@router.delete("/{trip_id}/moment-excerpts/{excerpt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_moment_excerpt(trip_id: str, excerpt_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    trip = owned_trip(session, trip_id, subject)
    session.delete(owned_excerpt(trip, excerpt_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
