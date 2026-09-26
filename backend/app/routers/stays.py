"""Owner-only accommodation records; sharing one shows only its area and nights."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..auth import current_subject
from ..database import get_session
from ..models import Location, Stay, Trip
from ..schemas import StayCreate, StayResponse, StayUpdate
from .placement import location_from_input
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["stays"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def _stay_query():
    return select(Stay).options(selectinload(Stay.location).selectinload(Location.area))


def owned_stay(trip: Trip, stay_id: str) -> Stay:
    stay = next((item for item in trip.stays if item.id == stay_id), None)
    if stay is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stay not found")
    return stay


def validate_stay_nights(check_in_date: date, check_out_date: date) -> None:
    if check_out_date <= check_in_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A stay covers at least one night: check out after the check-in date",
        )


@router.get("/stays", response_model=list[StayResponse])
def list_stays(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[Stay]:
    return list(owned_trip(session, trip_id, subject).stays)


@router.post("/stays", response_model=StayResponse, status_code=status.HTTP_201_CREATED)
def create_stay(trip_id: str, payload: StayCreate, session: SessionDep, subject: SubjectDep) -> Stay:
    trip = owned_trip(session, trip_id, subject)
    validate_stay_nights(payload.check_in_date, payload.check_out_date)
    stay = Stay(
        trip=trip,
        location=location_from_input(session, trip.id, payload.location),
        website_url=str(payload.website_url) if payload.website_url is not None else None,
        **payload.model_dump(exclude={"location", "website_url"}),
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
    if "location" in payload.model_fields_set:
        if payload.location is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A stay needs a location")
        stay.location = location_from_input(session, trip.id, payload.location)
    values = payload.model_dump(exclude_unset=True, exclude={"location"})
    for required in ("check_in_date", "check_out_date", "status"):
        if required in values and values[required] is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{required} is required")
    if "website_url" in values and values["website_url"] is not None:
        values["website_url"] = str(values["website_url"])
    validate_stay_nights(
        values.get("check_in_date", stay.check_in_date), values.get("check_out_date", stay.check_out_date)
    )
    for field, value in values.items():
        setattr(stay, field, value)
    session.commit()
    return session.scalar(_stay_query().where(Stay.id == stay.id))  # type: ignore[return-value]


@router.delete("/stays/{stay_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stay(trip_id: str, stay_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    session.delete(owned_stay(owned_trip(session, trip_id, subject), stay_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
