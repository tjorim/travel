"""Owner-only booked flight and transport itinerary records."""

from datetime import UTC, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..auth import current_subject
from ..database import get_session
from ..models import DocumentAsset, Place, TransportLeg, TransportLegDocumentAsset, Trip
from ..schemas import TransportLegCreate, TransportLegResponse, TransportLegUpdate
from .trips import exact_place_from_input, owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["transport"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def _leg_query():
    return select(TransportLeg).options(
        selectinload(TransportLeg.departure_place).selectinload(Place.area),
        selectinload(TransportLeg.arrival_place).selectinload(Place.area),
        selectinload(TransportLeg.document_links),
    )


def owned_leg(trip: Trip, leg_id: str) -> TransportLeg:
    leg = next((item for item in trip.transport_legs if item.id == leg_id), None)
    if leg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transport leg not found")
    return leg


def validate_leg_times(departs_at: datetime, arrives_at: datetime) -> None:
    # SQLite drops timezone information despite DateTime(timezone=True),
    # while PostgreSQL preserves it. Normalize only for the comparison so a
    # partial owner edit is valid on both supported database backends.
    comparable_departure = departs_at if departs_at.tzinfo is not None else departs_at.replace(tzinfo=UTC)
    comparable_arrival = arrives_at if arrives_at.tzinfo is not None else arrives_at.replace(tzinfo=UTC)
    if comparable_arrival <= comparable_departure:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Arrival must be after departure",
        )


def endpoint_instant(value: datetime, zone: str | None) -> datetime:
    """Resolve a leg time to a UTC instant.

    A time with an offset is already an instant. A time without one is the
    local wall-clock time at the endpoint, so it needs that endpoint's zone;
    this keeps "AMS 10:40 -> TPE 06:25 the next day" exact regardless of the
    owner's browser time zone.
    """
    if value.tzinfo is None:
        if zone is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A time without an offset needs the endpoint's time zone",
            )
        value = value.replace(tzinfo=ZoneInfo(zone))
    return value.astimezone(UTC)


def document_links_from_ids(session: Session, trip_id: str, document_asset_ids: list[str]) -> list[TransportLegDocumentAsset]:
    """Resolve attachments inside the already-authorized trip boundary.

    A client can only attach non-deleted documents owned by this trip.
    """
    if not document_asset_ids:
        return []
    assets = list(
        session.scalars(
            select(DocumentAsset).where(
                DocumentAsset.trip_id == trip_id,
                DocumentAsset.id.in_(document_asset_ids),
                DocumentAsset.deleted_at.is_(None),
            )
        )
    )
    if len(assets) != len(document_asset_ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="One or more documents are unavailable for this trip",
        )
    by_id = {asset.id: asset for asset in assets}
    return [TransportLegDocumentAsset(document_asset=by_id[asset_id]) for asset_id in document_asset_ids]


@router.get("/transport-legs", response_model=list[TransportLegResponse])
def list_transport_legs(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[TransportLeg]:
    return list(owned_trip(session, trip_id, subject).transport_legs)


@router.post("/transport-legs", response_model=TransportLegResponse, status_code=status.HTTP_201_CREATED)
def create_transport_leg(
    trip_id: str, payload: TransportLegCreate, session: SessionDep, subject: SubjectDep
) -> TransportLeg:
    trip = owned_trip(session, trip_id, subject)
    departs_at = endpoint_instant(payload.departs_at, payload.departure_timezone)
    arrives_at = endpoint_instant(payload.arrives_at, payload.arrival_timezone)
    validate_leg_times(departs_at, arrives_at)
    leg = TransportLeg(
        trip=trip,
        departure_place=exact_place_from_input(session, trip.id, payload.departure_place),
        arrival_place=exact_place_from_input(session, trip.id, payload.arrival_place),
        document_links=document_links_from_ids(session, trip.id, payload.document_asset_ids),
        departs_at=departs_at,
        arrives_at=arrives_at,
        **payload.model_dump(
            exclude={"departure_place", "arrival_place", "document_asset_ids", "departs_at", "arrives_at"}
        ),
    )
    session.add(leg)
    session.commit()
    return session.scalar(_leg_query().where(TransportLeg.id == leg.id))  # type: ignore[return-value]


@router.get("/transport-legs/{leg_id}", response_model=TransportLegResponse)
def get_transport_leg(trip_id: str, leg_id: str, session: SessionDep, subject: SubjectDep) -> TransportLeg:
    return owned_leg(owned_trip(session, trip_id, subject), leg_id)


@router.patch("/transport-legs/{leg_id}", response_model=TransportLegResponse)
def update_transport_leg(
    trip_id: str, leg_id: str, payload: TransportLegUpdate, session: SessionDep, subject: SubjectDep
) -> TransportLeg:
    trip = owned_trip(session, trip_id, subject)
    leg = owned_leg(trip, leg_id)
    if "departure_place" in payload.model_fields_set:
        if payload.departure_place is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A departure place is required"
            )
        leg.departure_place = exact_place_from_input(session, trip.id, payload.departure_place)
    if "arrival_place" in payload.model_fields_set:
        if payload.arrival_place is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="An arrival place is required"
            )
        leg.arrival_place = exact_place_from_input(session, trip.id, payload.arrival_place)
    if "document_asset_ids" in payload.model_fields_set:
        leg.document_links = document_links_from_ids(session, trip.id, payload.document_asset_ids or [])
    values = payload.model_dump(
        exclude_unset=True, exclude={"departure_place", "arrival_place", "document_asset_ids"}
    )
    for required in ("kind", "status", "departs_at", "arrives_at"):
        if required in values and values[required] is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{required} is required")
    if values.get("departs_at") is not None:
        values["departs_at"] = endpoint_instant(
            values["departs_at"], values.get("departure_timezone", leg.departure_timezone)
        )
    if values.get("arrives_at") is not None:
        values["arrives_at"] = endpoint_instant(values["arrives_at"], values.get("arrival_timezone", leg.arrival_timezone))
    validate_leg_times(values.get("departs_at", leg.departs_at), values.get("arrives_at", leg.arrives_at))
    for field, value in values.items():
        setattr(leg, field, value)
    session.commit()
    return session.scalar(_leg_query().where(TransportLeg.id == leg.id))  # type: ignore[return-value]


@router.delete("/transport-legs/{leg_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transport_leg(trip_id: str, leg_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    session.delete(owned_leg(owned_trip(session, trip_id, subject), leg_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
