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
    MediaDerivative,
    Moment,
    MomentExcerpt,
    Place,
    PlaceKind,
    PublicationState,
    RouteStage,
    Stay,
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
    PublicTripResponse,
    RouteStageCreate,
    RouteStageResponse,
    RouteStageUpdate,
    TripCreate,
    TripResponse,
    TripUpdate,
)

router = APIRouter(prefix="/trips", tags=["trips"])
public_router = APIRouter(prefix="/published", tags=["published"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def trip_query():
    return select(Trip).options(
        selectinload(Trip.route_stages).selectinload(RouteStage.place),
        selectinload(Trip.moments).selectinload(Moment.place),
        selectinload(Trip.moment_excerpts).selectinload(MomentExcerpt.broad_place),
        selectinload(Trip.stays).selectinload(Stay.place),
        selectinload(Trip.broad_stay_cards).selectinload(BroadStayCard.place),
        selectinload(Trip.broad_routes),
        selectinload(Trip.media_derivatives).selectinload(MediaDerivative.media_asset),
        selectinload(Trip.document_derivatives).selectinload(DocumentDerivative.document_asset),
    )


def broad_place_from_input(session: Session, trip_id: str, payload: BroadPlaceInput) -> Place:
    place = Place(trip_id=trip_id, kind=PlaceKind.BROAD, **payload.model_dump())
    session.add(place)
    session.flush()
    return place


def exact_place_from_input(session: Session, trip_id: str, payload: ExactPlaceInput) -> Place:
    place = Place(trip_id=trip_id, kind=PlaceKind.EXACT, **payload.model_dump())
    session.add(place)
    session.flush()
    return place


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
        place=broad_place_from_input(session, trip.id, payload.place),
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
    if payload.place is not None:
        stage.place = broad_place_from_input(session, trip.id, payload.place)
    for field, value in payload.model_dump(exclude_unset=True, exclude={"place"}).items():
        setattr(stage, field, value)
    commit_or_conflict(session)
    return session.scalar(select(RouteStage).options(selectinload(RouteStage.place)).where(RouteStage.id == stage.id))  # type: ignore[return-value]


@router.delete("/{trip_id}/route-stages/{stage_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_route_stage(trip_id: str, stage_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    session.delete(owned_stage(owned_trip(session, trip_id, subject), stage_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{trip_id}/moments", response_model=MomentResponse, status_code=status.HTTP_201_CREATED)
def create_moment(trip_id: str, payload: MomentCreate, session: SessionDep, subject: SubjectDep) -> Moment:
    trip = owned_trip(session, trip_id, subject)
    values = payload.model_dump(exclude={"place", "photo_urls"})
    moment = Moment(
        trip=trip,
        author_subject=subject,
        place=exact_place_from_input(session, trip.id, payload.place) if payload.place else None,
        photo_urls=[str(url) for url in payload.photo_urls],
        **values,
    )
    session.add(moment)
    session.commit()
    return session.scalar(select(Moment).options(selectinload(Moment.place)).where(Moment.id == moment.id))  # type: ignore[return-value]


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
    values = payload.model_dump(exclude_unset=True, exclude={"place", "photo_urls"})
    for field, value in values.items():
        setattr(moment, field, value)
    if payload.photo_urls is not None:
        moment.photo_urls = [str(url) for url in payload.photo_urls]
    session.commit()
    return session.scalar(select(Moment).options(selectinload(Moment.place)).where(Moment.id == moment.id))  # type: ignore[return-value]


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


@public_router.get("/trips/{public_id}", response_model=PublicTripResponse)
def get_published_trip(public_id: str, session: SessionDep) -> Trip:
    trip = session.scalar(
        trip_query().where(
            Trip.public_id == public_id,
            Trip.publication_state == PublicationState.PUBLISHED,
            Trip.visibility.in_([Visibility.UNLISTED, Visibility.PUBLIC]),
        )
    )
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Published trip not found")
    return trip
