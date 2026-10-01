"""Owner-only accommodation records; sharing one shows only its area and nights."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..auth import current_subject
from ..database import get_session
from ..errors import ApiException
from ..models import Location, Stay, StayStatus, Trip, Visibility
from ..schemas import LocationInput, StayCreate, StayResponse, StayUpdate
from .placement import area_location, location_from_input, selected_area
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["stays"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def _stay_query():
    return select(Stay).options(selectinload(Stay.location).selectinload(Location.area))


def owned_stay(trip: Trip, stay_id: str) -> Stay:
    stay = next((item for item in trip.stays if item.id == stay_id), None)
    if stay is None:
        raise ApiException(status_code=status.HTTP_404_NOT_FOUND, detail="Stay not found", code="not_found")
    return stay


def stay_location(session: Session, trip_id: str, area_id: str | None, location: LocationInput | None) -> Location:
    """The location a stay points at: the one given, or its area's city-level location.

    A location that names nothing but its area is the same thing as the area,
    so it too reuses the city-level location rather than adding another."""
    if location is not None and location.model_fields_set - {"area_id"}:
        return location_from_input(session, trip_id, location)
    area_id = location.area_id if location is not None else area_id
    if area_id is None:
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Say where this stay is",
            code="say_where_this_stay_is",
        )
    return area_location(session, trip_id, selected_area(session, trip_id, area_id))


def validate_stay_nights(check_in_date: date, check_out_date: date) -> None:
    if check_out_date <= check_in_date:
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A stay covers at least one night: check out after the check-in date",
            code="a_stay_covers_at_least_one_night_check_out_after_the_check_in_date",
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
        location=stay_location(session, trip.id, payload.area_id, payload.location),
        website_url=str(payload.website_url) if payload.website_url is not None else None,
        **payload.model_dump(exclude={"area_id", "location", "website_url"}),
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
    fields = payload.model_fields_set
    if "location" in fields and payload.location is not None:
        if payload.area_id is not None:
            raise ApiException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Give an area or a location, not both; a location names its own area",
                code="give_an_area_or_a_location_not_both_a_location_names_its_own_area",
            )
        stay.location = stay_location(session, trip.id, None, payload.location)
    elif "area_id" in fields and payload.area_id is not None:
        if stay.location.area_id != payload.area_id:
            stay.location = stay_location(session, trip.id, payload.area_id, None)
    elif "location" in fields:  # cleared: keep the area, forget the accommodation
        stay.location = area_location(session, trip.id, stay.location.area)
    elif "area_id" in fields:
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A stay needs an area",
            code="a_stay_needs_an_area",
        )
    values = payload.model_dump(exclude_unset=True, exclude={"area_id", "location"})
    for required in ("check_in_date", "check_out_date", "status"):
        if required in values and values[required] is None:
            raise ApiException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{required} is required",
                code="missing",
                field=required,
            )
    if "website_url" in values and values["website_url"] is not None:
        values["website_url"] = str(values["website_url"])
    validate_stay_nights(
        values.get("check_in_date", stay.check_in_date), values.get("check_out_date", stay.check_out_date)
    )
    for field, value in values.items():
        setattr(stay, field, value)
    if stay.status == StayStatus.IDEA:
        # A candidate is never offered to an audience, so going back to an idea also takes it off any.
        stay.visibility = Visibility.PRIVATE
    session.commit()
    return session.scalar(_stay_query().where(Stay.id == stay.id))  # type: ignore[return-value]


@router.delete("/stays/{stay_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stay(trip_id: str, stay_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    session.delete(owned_stay(owned_trip(session, trip_id, subject), stay_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
