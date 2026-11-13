"""Bulk choice: let visits and stays follow each audience's date precision."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..schemas import FollowAudiencePrecisionRequest, FollowAudiencePrecisionResult, Identifier
from ..services import precision as service

router = APIRouter(prefix="/trips/{trip_id}", tags=["publication"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


@router.post("/date-precision/follow-audience", response_model=FollowAudiencePrecisionResult)
def follow_audience_precision_endpoint(
    trip_id: Identifier, payload: FollowAudiencePrecisionRequest, session: SessionDep, subject: SubjectDep
) -> FollowAudiencePrecisionResult:
    result = service.follow_audience_precision(session, subject, trip_id, payload)
    session.commit()
    return result
