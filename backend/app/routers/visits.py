"""Owner-only visits: the stops of the trip, and when the traveller is at each."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..models import Visit
from ..schemas import Identifier, RouteReference, VisitCreate, VisitResponse, VisitRouteCheck, VisitUpdate
from ..services import visits as service

router = APIRouter(prefix="/trips/{trip_id}", tags=["visits"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


@router.get("/visits", response_model=list[VisitResponse])
def list_visits(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> list[Visit]:
    return service.list_visits(session, subject, trip_id)


@router.post("/visits", response_model=VisitResponse, status_code=status.HTTP_201_CREATED)
def create_visit(trip_id: Identifier, payload: VisitCreate, session: SessionDep, subject: SubjectDep) -> Visit:
    visit_id = service.create_visit(session, subject, trip_id, payload).id
    session.commit()
    return service.visit_by_id(session, subject, trip_id, visit_id)


@router.post("/visits/route-check", response_model=list[RouteReference])
def check_visit_against_routes(
    trip_id: Identifier, payload: VisitRouteCheck, session: SessionDep, subject: SubjectDep
) -> list[dict[str, str]]:
    """Which routes a visit that is not saved yet would restate. Saves nothing and never blocks the save."""
    return service.check_visit_against_routes(session, subject, trip_id, payload)


@router.get("/visits/{visit_id}", response_model=VisitResponse)
def get_visit(trip_id: Identifier, visit_id: Identifier, session: SessionDep, subject: SubjectDep) -> Visit:
    return service.get_visit(session, subject, trip_id, visit_id)


@router.patch("/visits/{visit_id}", response_model=VisitResponse)
def update_visit(
    trip_id: Identifier, visit_id: Identifier, payload: VisitUpdate, session: SessionDep, subject: SubjectDep
) -> Visit:
    service.update_visit(session, subject, trip_id, visit_id, payload)
    session.commit()
    return service.visit_by_id(session, subject, trip_id, visit_id)


@router.delete("/visits/{visit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_visit(trip_id: Identifier, visit_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    service.delete_visit(session, subject, trip_id, visit_id)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
