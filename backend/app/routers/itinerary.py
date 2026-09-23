"""Owner-only day-plan entries that point at, but never copy, other resources."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..models import DocumentAsset, ItineraryEntry, ItineraryLinkKind, PlaceKind, Trip
from ..schemas import ItineraryEntryCreate, ItineraryEntryResponse, ItineraryEntryUpdate
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["itinerary"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def owned_entry(trip: Trip, entry_id: str) -> ItineraryEntry:
    entry = next((item for item in trip.itinerary_entries if item.id == entry_id), None)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Itinerary entry not found")
    return entry


def validate_itinerary_link(session: Session, trip: Trip, kind: ItineraryLinkKind | None, linked_id: str | None) -> None:
    """Ensure a link points at a resource that already belongs to this trip.

    This is a soft reference, not a database foreign key -- the target table
    varies by kind -- so existence is checked here against the
    already-authorized trip boundary, the same way a transport leg validates
    its document attachments.
    """
    if kind is None:
        return
    exists = False
    if kind == ItineraryLinkKind.STAY:
        exists = any(item.id == linked_id for item in trip.stays)
    elif kind == ItineraryLinkKind.TRANSPORT_LEG:
        exists = any(item.id == linked_id for item in trip.transport_legs)
    elif kind == ItineraryLinkKind.ROUTE_STAGE:
        exists = any(item.id == linked_id for item in trip.route_stages)
    elif kind == ItineraryLinkKind.MOMENT:
        exists = any(item.id == linked_id for item in trip.moments)
    elif kind == ItineraryLinkKind.PLACE:
        exists = any(item.id == linked_id and item.kind == PlaceKind.EXACT for item in trip.places)
    elif kind == ItineraryLinkKind.DOCUMENT:
        exists = (
            session.scalar(
                select(DocumentAsset).where(
                    DocumentAsset.id == linked_id,
                    DocumentAsset.trip_id == trip.id,
                    DocumentAsset.deleted_at.is_(None),
                )
            )
            is not None
        )
    if not exists:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="The linked resource is unavailable for this trip",
        )


def commit_or_conflict(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Conflicting itinerary entry position") from error


@router.get("/itinerary-entries", response_model=list[ItineraryEntryResponse])
def list_itinerary_entries(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[ItineraryEntry]:
    return list(owned_trip(session, trip_id, subject).itinerary_entries)


@router.post("/itinerary-entries", response_model=ItineraryEntryResponse, status_code=status.HTTP_201_CREATED)
def create_itinerary_entry(
    trip_id: str, payload: ItineraryEntryCreate, session: SessionDep, subject: SubjectDep
) -> ItineraryEntry:
    trip = owned_trip(session, trip_id, subject)
    validate_itinerary_link(session, trip, payload.linked_kind, payload.linked_id)
    entry = ItineraryEntry(trip=trip, **payload.model_dump())
    session.add(entry)
    commit_or_conflict(session)
    session.refresh(entry)
    return entry


@router.get("/itinerary-entries/{entry_id}", response_model=ItineraryEntryResponse)
def get_itinerary_entry(trip_id: str, entry_id: str, session: SessionDep, subject: SubjectDep) -> ItineraryEntry:
    return owned_entry(owned_trip(session, trip_id, subject), entry_id)


@router.patch("/itinerary-entries/{entry_id}", response_model=ItineraryEntryResponse)
def update_itinerary_entry(
    trip_id: str, entry_id: str, payload: ItineraryEntryUpdate, session: SessionDep, subject: SubjectDep
) -> ItineraryEntry:
    trip = owned_trip(session, trip_id, subject)
    entry = owned_entry(trip, entry_id)
    if "linked_kind" in payload.model_fields_set or "linked_id" in payload.model_fields_set:
        validate_itinerary_link(session, trip, payload.linked_kind, payload.linked_id)
    if payload.position is not None and payload.position != entry.position:
        ordered = sorted(trip.itinerary_entries, key=lambda item: item.position)
        ordered.remove(entry)
        ordered.insert(min(payload.position, len(ordered)), entry)
        # The unique trip/position constraint makes an ordinary swap fail.
        # Move every row out of its current range before compacting it again.
        offset = max((item.position for item in trip.itinerary_entries), default=0) + len(ordered) + 1
        for item in trip.itinerary_entries:
            item.position += offset
        session.flush()
        for position, item in enumerate(ordered):
            item.position = position
    values = payload.model_dump(exclude_unset=True, exclude={"position"})
    if "tentative" in values and values["tentative"] is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="tentative is required")
    day_date = values.get("day_date", entry.day_date)
    end_date = values.get("end_date", entry.end_date)
    if end_date is not None and (day_date is None or end_date < day_date):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="The last day needs a first day and cannot precede it",
        )
    for field, value in values.items():
        setattr(entry, field, value)
    commit_or_conflict(session)
    session.refresh(entry)
    return entry


@router.delete("/itinerary-entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_itinerary_entry(trip_id: str, entry_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    trip = owned_trip(session, trip_id, subject)
    session.delete(owned_entry(trip, entry_id))
    session.flush()
    remaining = list(
        session.scalars(select(ItineraryEntry).where(ItineraryEntry.trip_id == trip.id).order_by(ItineraryEntry.position))
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
