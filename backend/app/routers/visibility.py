"""One endpoint sets who receives any shareable record."""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..access import find_record, receivers, set_visibility
from ..audit import delivering_audiences, record_visibility_change
from ..auth import current_subject
from ..database import get_session
from ..errors import ApiException, service_exception
from ..models import Visibility
from ..schemas import Identifier, ShareScopeKind, VisibilityUpdate
from .trips import owned_trip

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
    trip = owned_trip(session, trip_id, subject)
    existing = find_record(trip, kind.value, record_id)
    before = existing.visibility if existing is not None else Visibility.PRIVATE
    before_receivers = (
        receivers(kind.value, existing, delivering_audiences(session, trip.id)) if existing is not None else set()
    )
    try:
        record = set_visibility(trip, kind.value, record_id, payload.visibility)
    except ValueError as error:
        raise service_exception(status.HTTP_422_UNPROCESSABLE_CONTENT, error) from error
    if record is None:
        raise ApiException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found", code="not_found")
    record_visibility_change(
        session,
        trip_id=trip.id,
        actor_subject=subject,
        kind=kind.value,
        record=record,
        before=before,
        before_receivers=before_receivers,
    )
    session.commit()
    return VisibilityUpdate(visibility=record.visibility)
