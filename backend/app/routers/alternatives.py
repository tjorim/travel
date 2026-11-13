"""Owner-only alternative groups: what the owner is choosing between, and the one choice that settles it.

The rules live in ``app.services.alternatives``; these endpoints own the transaction.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..schemas import (
    AlternativeChoiceResponse,
    AlternativeChoose,
    AlternativeGroupCreate,
    AlternativeGroupResponse,
    AlternativeGroupUpdate,
    AlternativeSuggestion,
    AlternativeUndo,
    Identifier,
)
from ..services import alternatives as service
from ..services.alternatives import Suggestion

router = APIRouter(prefix="/trips/{trip_id}", tags=["alternatives"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


@router.get("/alternative-groups", response_model=list[AlternativeGroupResponse])
def list_alternative_groups(
    trip_id: Identifier, session: SessionDep, subject: SubjectDep
) -> list[AlternativeGroupResponse]:
    return service.list_alternative_groups(session, subject, trip_id)


@router.get("/alternative-groups/suggestions", response_model=list[AlternativeSuggestion])
def suggest_alternative_groups(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> list[Suggestion]:
    """Ungrouped ideas over matching or overlapping dates. Stores nothing: confirm one by creating the group."""
    return service.suggest_alternative_groups(session, subject, trip_id)


@router.post("/alternative-groups", response_model=AlternativeGroupResponse, status_code=status.HTTP_201_CREATED)
def create_alternative_group(
    trip_id: Identifier, payload: AlternativeGroupCreate, session: SessionDep, subject: SubjectDep
) -> AlternativeGroupResponse:
    created = service.create_alternative_group(session, subject, trip_id, payload)
    session.commit()
    return created


@router.get("/alternative-groups/{group_id}", response_model=AlternativeGroupResponse)
def get_alternative_group(
    trip_id: Identifier, group_id: Identifier, session: SessionDep, subject: SubjectDep
) -> AlternativeGroupResponse:
    return service.get_alternative_group(session, subject, trip_id, group_id)


@router.patch("/alternative-groups/{group_id}", response_model=AlternativeGroupResponse)
def update_alternative_group(
    trip_id: Identifier,
    group_id: Identifier,
    payload: AlternativeGroupUpdate,
    session: SessionDep,
    subject: SubjectDep,
) -> AlternativeGroupResponse:
    updated = service.update_alternative_group(session, subject, trip_id, group_id, payload)
    session.commit()
    return updated


@router.delete("/alternative-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_alternative_group(
    trip_id: Identifier, group_id: Identifier, session: SessionDep, subject: SubjectDep
) -> Response:
    """Dissolve a group. Its records and their statuses are untouched."""
    service.delete_alternative_group(session, subject, trip_id, group_id)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/alternative-groups/{group_id}/choose", response_model=AlternativeChoiceResponse)
def choose_alternative(
    trip_id: Identifier, group_id: Identifier, payload: AlternativeChoose, session: SessionDep, subject: SubjectDep
) -> AlternativeChoiceResponse:
    """Choose this one: it becomes planned and the others are cancelled or removed, in one transaction.

    The audit event it returns can be undone with ``undo-choice`` unless the others were removed."""
    chosen = service.choose_alternative(session, subject, trip_id, group_id, payload)
    session.commit()
    return chosen


@router.post("/alternative-groups/{group_id}/undo-choice", response_model=AlternativeGroupResponse)
def undo_alternative_choice(
    trip_id: Identifier,
    group_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    payload: AlternativeUndo | None = None,
) -> AlternativeGroupResponse:
    """Undo the group's latest choice while its members are as that choice left them."""
    undone = service.undo_alternative_choice(session, subject, trip_id, group_id, payload.event_id if payload else None)
    session.commit()
    return undone
