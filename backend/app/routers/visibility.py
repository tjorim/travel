"""One endpoint sets who receives any shareable record."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..access import set_visibility
from ..auth import current_subject
from ..database import get_session
from ..schemas import ShareScopeKind, VisibilityUpdate
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["visibility"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


@router.put("/visibility/{kind}/{record_id}", response_model=VisibilityUpdate)
def put_visibility(
    trip_id: str, kind: ShareScopeKind, record_id: str, payload: VisibilityUpdate, session: SessionDep, subject: SubjectDep
) -> VisibilityUpdate:
    """Choose private, everyone or custom for one record.

    The same choice for every kind; leaving ``custom`` withdraws the record
    from every scope that listed it.
    """
    trip = owned_trip(session, trip_id, subject)
    try:
        record = set_visibility(trip, kind.value, record_id, payload.visibility)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")
    session.commit()
    return VisibilityUpdate(visibility=record.visibility)
