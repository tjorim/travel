"""Owner-only accommodation records and separately authored broad cards."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..auth import current_subject
from ..database import get_session
from ..models import BroadStayCard, Place, PlaceKind, Stay, Trip
from ..schemas import (
    BroadStayCardCreate,
    BroadStayCardResponse,
    BroadStayCardUpdate,
    StayCreate,
    StayResponse,
    StayUpdate,
)
from .trips import exact_place_from_input, owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["stays"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def _stay_query():
    return select(Stay).options(selectinload(Stay.place))


def _card_query():
    return select(BroadStayCard).options(selectinload(BroadStayCard.place))


def owned_stay(trip: Trip, stay_id: str) -> Stay:
    stay = next((item for item in trip.stays if item.id == stay_id), None)
    if stay is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stay not found")
    return stay


def owned_broad_stay_card(trip: Trip, card_id: str) -> BroadStayCard:
    card = next((item for item in trip.broad_stay_cards if item.id == card_id), None)
    if card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Broad stay card not found")
    return card


def resolve_broad_place_id(session: Session, trip: Trip, broad_place_id: str) -> str:
    place = session.scalar(
        select(Place).where(Place.id == broad_place_id, Place.trip_id == trip.id, Place.kind == PlaceKind.BROAD)
    )
    if place is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Broad place not found on this trip")
    return place.id


def validate_stay_dates(arrives_at: datetime, departs_at: datetime) -> None:
    # SQLite drops timezone information despite DateTime(timezone=True),
    # while PostgreSQL preserves it. Normalize only for the comparison so a
    # partial owner edit is valid on both supported database backends.
    comparable_arrival = arrives_at if arrives_at.tzinfo is not None else arrives_at.replace(tzinfo=UTC)
    comparable_departure = departs_at if departs_at.tzinfo is not None else departs_at.replace(tzinfo=UTC)
    if comparable_departure <= comparable_arrival:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Departure must be after arrival",
        )


@router.get("/stays", response_model=list[StayResponse])
def list_stays(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[Stay]:
    return list(owned_trip(session, trip_id, subject).stays)


@router.post("/stays", response_model=StayResponse, status_code=status.HTTP_201_CREATED)
def create_stay(trip_id: str, payload: StayCreate, session: SessionDep, subject: SubjectDep) -> Stay:
    trip = owned_trip(session, trip_id, subject)
    validate_stay_dates(payload.arrives_at, payload.departs_at)
    stay = Stay(
        trip=trip,
        place=exact_place_from_input(session, trip.id, payload.place),
        **payload.model_dump(exclude={"place"}),
    )
    session.add(stay)
    session.commit()
    return session.scalar(_stay_query().where(Stay.id == stay.id))  # type: ignore[return-value]


@router.get("/stays/{stay_id}", response_model=StayResponse)
def get_stay(trip_id: str, stay_id: str, session: SessionDep, subject: SubjectDep) -> Stay:
    return owned_stay(owned_trip(session, trip_id, subject), stay_id)


@router.patch("/stays/{stay_id}", response_model=StayResponse)
def update_stay(trip_id: str, stay_id: str, payload: StayUpdate, session: SessionDep, subject: SubjectDep) -> Stay:
    trip = owned_trip(session, trip_id, subject)
    stay = owned_stay(trip, stay_id)
    if "place" in payload.model_fields_set:
        if payload.place is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="An exact place is required")
        stay.place = exact_place_from_input(session, trip.id, payload.place)
    values = payload.model_dump(exclude_unset=True, exclude={"place"})
    validate_stay_dates(values.get("arrives_at", stay.arrives_at), values.get("departs_at", stay.departs_at))
    for field, value in values.items():
        setattr(stay, field, value)
    session.commit()
    return session.scalar(_stay_query().where(Stay.id == stay.id))  # type: ignore[return-value]


@router.delete("/stays/{stay_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stay(trip_id: str, stay_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    session.delete(owned_stay(owned_trip(session, trip_id, subject), stay_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/broad-stay-cards", response_model=list[BroadStayCardResponse])
def list_broad_stay_cards(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[BroadStayCard]:
    return list(owned_trip(session, trip_id, subject).broad_stay_cards)


@router.post("/broad-stay-cards", response_model=BroadStayCardResponse, status_code=status.HTTP_201_CREATED)
def create_broad_stay_card(
    trip_id: str, payload: BroadStayCardCreate, session: SessionDep, subject: SubjectDep
) -> BroadStayCard:
    trip = owned_trip(session, trip_id, subject)
    card = BroadStayCard(
        trip=trip,
        broad_place_id=resolve_broad_place_id(session, trip, payload.broad_place_id),
        title=payload.title,
        date_precision=payload.date_precision,
    )
    session.add(card)
    session.commit()
    return session.scalar(_card_query().where(BroadStayCard.id == card.id))  # type: ignore[return-value]


@router.get("/broad-stay-cards/{card_id}", response_model=BroadStayCardResponse)
def get_broad_stay_card(trip_id: str, card_id: str, session: SessionDep, subject: SubjectDep) -> BroadStayCard:
    return owned_broad_stay_card(owned_trip(session, trip_id, subject), card_id)


@router.patch("/broad-stay-cards/{card_id}", response_model=BroadStayCardResponse)
def update_broad_stay_card(
    trip_id: str, card_id: str, payload: BroadStayCardUpdate, session: SessionDep, subject: SubjectDep
) -> BroadStayCard:
    trip = owned_trip(session, trip_id, subject)
    card = owned_broad_stay_card(trip, card_id)
    if "broad_place_id" in payload.model_fields_set:
        if payload.broad_place_id is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A broad place is required")
        card.broad_place_id = resolve_broad_place_id(session, trip, payload.broad_place_id)
    for field, value in payload.model_dump(exclude_unset=True, exclude={"broad_place_id"}).items():
        setattr(card, field, value)
    session.commit()
    return session.scalar(_card_query().where(BroadStayCard.id == card.id))  # type: ignore[return-value]


@router.delete("/broad-stay-cards/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_broad_stay_card(trip_id: str, card_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    session.delete(owned_broad_stay_card(owned_trip(session, trip_id, subject), card_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
