"""One endpoint sets who receives any shareable record."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import current_subject
from app.db.session import get_session

from ..schemas import Identifier, ShareScopeKind, VisibilityUpdate
from ..services import visibility

router = APIRouter(prefix="/trips/{trip_id}", tags=["visibility"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


@router.put("/visibility/{kind}/{record_id}", response_model=VisibilityUpdate)
def put_visibility(
    trip_id: Identifier,
    kind: ShareScopeKind,
    record_id: Identifier,
    payload: VisibilityUpdate,
    session: SessionDep,
    subject: SubjectDep,
) -> VisibilityUpdate:
    """Choose private, everyone or custom for one record.

    The same choice for every kind; leaving ``custom`` withdraws the record
    from every scope that listed it.
    """
    chosen = visibility.put_visibility(session, subject, trip_id, kind.value, record_id, payload.visibility)
    session.commit()
    return VisibilityUpdate(visibility=chosen)
