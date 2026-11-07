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
from ..schemas import Identifier, StayCreate, StayResponse, StayUpdate
from .placement import selected_area, stay_place
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["stays"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def _stay_query():
    return select(Stay).options(selectinload(Stay.area), selectinload(Stay.location).selectinload(Location.area))


def owned_stay(trip: Trip, stay_id: Identifier) -> Stay:
    stay = next((item for item in trip.stays if item.id == stay_id), None)
    if stay is None:
        raise ApiException(status_code=status.HTTP_404_NOT_FOUND, detail="Stay not found", code="not_found")
    return stay


def validate_stay_nights(check_in_date: date, check_out_date: date) -> None:
    if check_out_date <= check_in_date:
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A stay covers at least one night: check out after the check-in date",
            code="a_stay_covers_at_least_one_night_check_out_after_the_check_in_date",
        )


@router.get("/stays", response_model=list[StayResponse])
def list_stays(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> list[Stay]:
    return list(owned_trip(session, trip_id, subject).stays)


@router.post("/stays", response_model=StayResponse, status_code=status.HTTP_201_CREATED)
def create_stay(trip_id: Identifier, payload: StayCreate, session: SessionDep, subject: SubjectDep) -> Stay:
    trip = owned_trip(session, trip_id, subject)
    validate_stay_nights(payload.check_in_date, payload.check_out_date)
    area, location = stay_place(session, trip.id, payload.area_id, payload.location)
    stay = Stay(
        trip=trip,
        area=area,
        location=location,
        website_url=str(payload.website_url) if payload.website_url is not None else None,
        **payload.model_dump(exclude={"area_id", "location", "website_url"}),
    )
    session.add(stay)
    session.commit()
    return session.scalar(_stay_query().where(Stay.id == stay.id))  # type: ignore[return-value]


@router.get("/stays/{stay_id}", response_model=StayResponse)
def get_stay(trip_id: Identifier, stay_id: Identifier, session: SessionDep, subject: SubjectDep) -> Stay:
    return owned_stay(owned_trip(session, trip_id, subject), stay_id)


def _update_place(session: Session, trip: Trip, stay: Stay, payload: StayUpdate) -> None:
    """Change where a stay is: its accommodation, its area, or both.

    ``location`` null returns the stay to "accommodation not chosen yet" and
    keeps its area; ``area_id`` alone moves the stay to that area and keeps the
    accommodation only when it is already in it."""
    fields = payload.model_fields_set
    if "location" not in fields and "area_id" not in fields:
        return
    if "location" in fields and payload.location is not None:
        area, location = stay_place(session, trip.id, payload.area_id, payload.location)
    elif "area_id" in fields and payload.area_id is not None:
        area, location = selected_area(session, trip.id, payload.area_id), None
        if stay.location is not None and stay.location.area_id == area.id and "location" not in fields:
            location = stay.location  # the same area: keep the accommodation
    elif "location" in fields:  # cleared: keep the area, forget the accommodation
        area, location = stay.area, None
    else:
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A stay needs an area",
            code="a_stay_needs_an_area",
        )
    stay.area = area
    stay.location = location


@router.patch("/stays/{stay_id}", response_model=StayResponse)
def update_stay(
    trip_id: Identifier, stay_id: Identifier, payload: StayUpdate, session: SessionDep, subject: SubjectDep
) -> Stay:
    trip = owned_trip(session, trip_id, subject)
    stay = owned_stay(trip, stay_id)
    _update_place(session, trip, stay, payload)
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
def delete_stay(trip_id: Identifier, stay_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    session.delete(owned_stay(owned_trip(session, trip_id, subject), stay_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
