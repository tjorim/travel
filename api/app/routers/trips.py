from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..auth import current_subject
from ..database import get_session
from ..models import Moment, Place, PublicationState, RouteStage, Trip, Visibility, opaque_id
from ..schemas import (
    MomentCreate,
    MomentResponse,
    MomentUpdate,
    PlaceInput,
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
    )


def place_from_input(session: Session, payload: PlaceInput) -> Place:
    place = session.scalar(
        select(Place).where(Place.display_name == payload.display_name, Place.country_code == payload.country_code)
    )
    if place is None:
        place = Place(display_name=payload.display_name, country_code=payload.country_code)
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
    stage = RouteStage(trip=trip, place=place_from_input(session, payload.place), position=payload.position, label=payload.label)
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
    stage = owned_stage(owned_trip(session, trip_id, subject), stage_id)
    if payload.place is not None:
        stage.place = place_from_input(session, payload.place)
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
        place=place_from_input(session, payload.place) if payload.place else None,
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
    moment = owned_moment(owned_trip(session, trip_id, subject), moment_id)
    # A present null is intentional: the traveller may remove an attached
    # place while editing a moment.  Pydantic otherwise represents both an
    # omitted field and null as None.
    if "place" in payload.model_fields_set:
        moment.place = place_from_input(session, payload.place) if payload.place else None
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
