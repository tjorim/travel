"""Owner-authored trip highlights for visitor pages."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..models import Trip, TripHighlight
from ..schemas import TripHighlightCreate, TripHighlightResponse, TripHighlightUpdate
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["highlights"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def owned_highlight(trip: Trip, highlight_id: str) -> TripHighlight:
    highlight = next((item for item in trip.highlights if item.id == highlight_id), None)
    if highlight is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Highlight not found")
    return highlight


def place_in_order(trip: Trip, highlight: TripHighlight, position: int | None) -> None:
    """Insert or move ``highlight`` and renumber the trip's list densely."""
    ordered = sorted((item for item in trip.highlights if item is not highlight), key=lambda item: item.position)
    ordered.insert(len(ordered) if position is None else min(position, len(ordered)), highlight)
    for index, item in enumerate(ordered):
        item.position = index


@router.get("/highlights", response_model=list[TripHighlightResponse])
def list_highlights(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[TripHighlight]:
    return list(owned_trip(session, trip_id, subject).highlights)


@router.post("/highlights", response_model=TripHighlightResponse, status_code=status.HTTP_201_CREATED)
def create_highlight(
    trip_id: str, payload: TripHighlightCreate, session: SessionDep, subject: SubjectDep
) -> TripHighlight:
    trip = owned_trip(session, trip_id, subject)
    highlight = TripHighlight(trip=trip, title=payload.title, summary=payload.summary, position=0)
    place_in_order(trip, highlight, payload.position)
    session.add(highlight)
    session.commit()
    session.refresh(highlight)
    return highlight


@router.patch("/highlights/{highlight_id}", response_model=TripHighlightResponse)
def update_highlight(
    trip_id: str, highlight_id: str, payload: TripHighlightUpdate, session: SessionDep, subject: SubjectDep
) -> TripHighlight:
    trip = owned_trip(session, trip_id, subject)
    highlight = owned_highlight(trip, highlight_id)
    if payload.position is not None:
        place_in_order(trip, highlight, payload.position)
    for field, value in payload.model_dump(exclude_unset=True, exclude={"position"}).items():
        setattr(highlight, field, value)
    session.commit()
    session.refresh(highlight)
    return highlight


@router.delete("/highlights/{highlight_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_highlight(trip_id: str, highlight_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    trip = owned_trip(session, trip_id, subject)
    highlight = owned_highlight(trip, highlight_id)
    trip.highlights.remove(highlight)
    for index, item in enumerate(sorted(trip.highlights, key=lambda value: value.position)):
        item.position = index
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
