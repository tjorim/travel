"""Accommodation records; sharing one shows only its area and nights."""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..document.service import trip_documents
from ..errors import RecordNotFound, Refusal, service_error
from ..models import STAY_ORDER, Location, PlanningStatus, Stay, StayDocumentAsset, Trip, Visibility
from ..schemas import Identifier, StayCreate, StayUpdate, require_stay_nights
from .placement import selected_area, stay_place
from .trips import owned_trip


def _stay_query():
    return select(Stay).options(
        selectinload(Stay.area),
        selectinload(Stay.location).selectinload(Location.area),
        selectinload(Stay.document_links),
    )


def owned_stay(session: Session, trip: Trip, stay_id: Identifier) -> Stay:
    stay = session.scalar(_stay_query().where(Stay.id == stay_id, Stay.trip_id == trip.id))
    if stay is None:
        raise RecordNotFound("Stay not found")
    return stay


def stay_by_id(session: Session, stay_id: Identifier) -> Stay:
    """A stay just written, read afresh with its places and documents (after a commit expired it)."""
    return session.scalar(_stay_query().where(Stay.id == stay_id))  # type: ignore[return-value]


def document_links_from_ids(
    session: Session, trip_id: Identifier, document_asset_ids: list[str]
) -> list[StayDocumentAsset]:
    """Resolve attachments inside the already-authorized trip boundary, exactly as a route does."""
    return [StayDocumentAsset(document_asset=asset) for asset in trip_documents(session, trip_id, document_asset_ids)]


def validate_stay_nights(check_in_date: date, check_out_date: date) -> None:
    try:
        require_stay_nights(check_in_date, check_out_date)
    except ValueError as error:
        raise service_error(error) from error


def list_stays(session: Session, subject: str, trip_id: Identifier) -> list[Stay]:
    trip = owned_trip(session, trip_id, subject)
    return list(session.scalars(_stay_query().where(Stay.trip_id == trip.id).order_by(*STAY_ORDER)))


def get_stay(session: Session, subject: str, trip_id: Identifier, stay_id: Identifier) -> Stay:
    return owned_stay(session, owned_trip(session, trip_id, subject), stay_id)


def create_stay(session: Session, subject: str, trip_id: Identifier, payload: StayCreate) -> Stay:
    trip = owned_trip(session, trip_id, subject)
    area, location = stay_place(session, trip.id, payload.area_id, payload.location)
    stay = Stay(
        trip_id=trip.id,
        area=area,
        location=location,
        document_links=document_links_from_ids(session, trip.id, payload.document_asset_ids),
        website_url=str(payload.website_url) if payload.website_url is not None else None,
        **payload.model_dump(exclude={"area_id", "location", "website_url", "document_asset_ids"}),
    )
    session.add(stay)
    session.flush()
    return stay


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
        raise Refusal("A stay needs an area", code="a_stay_needs_an_area")
    stay.area = area
    stay.location = location


def update_stay(session: Session, subject: str, trip_id: Identifier, stay_id: Identifier, payload: StayUpdate) -> Stay:
    trip = owned_trip(session, trip_id, subject)
    stay = owned_stay(session, trip, stay_id)
    _update_place(session, trip, stay, payload)
    if "document_asset_ids" in payload.model_fields_set:
        stay.document_links = document_links_from_ids(session, trip.id, payload.document_asset_ids or [])
    values = payload.model_dump(exclude_unset=True, exclude={"area_id", "location", "document_asset_ids"})
    for required in ("check_in_date", "check_out_date", "status"):
        if required in values and values[required] is None:
            raise Refusal(f"{required} is required", code="missing", field=required)
    if "website_url" in values and values["website_url"] is not None:
        values["website_url"] = str(values["website_url"])
    validate_stay_nights(
        values.get("check_in_date", stay.check_in_date), values.get("check_out_date", stay.check_out_date)
    )
    for field, value in values.items():
        setattr(stay, field, value)
    if stay.status == PlanningStatus.IDEA:
        # A candidate is never offered to an audience, so going back to an idea also takes it off any.
        stay.visibility = Visibility.PRIVATE
    session.flush()
    return stay


def delete_stay(session: Session, subject: str, trip_id: Identifier, stay_id: Identifier) -> None:
    session.delete(owned_stay(session, owned_trip(session, trip_id, subject), stay_id))
    session.flush()
