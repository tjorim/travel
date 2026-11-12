"""Owner-only alternative groups: what the owner is choosing between, and the one choice that settles it.

A group is private planning state of one trip. It holds stays, visits or routes of a single kind and at most
one chosen member. Nothing here is ever delivered to a visitor: projections, share scopes, files, navigation
and collections are built from the records themselves and do not read these tables.

Existing ideas are never grouped automatically. :func:`suggest_groups` only proposes groups from matching or
overlapping dates; the owner confirms one (creates the group) or ignores it.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..audit import record_audit_event
from ..auth import current_subject
from ..database import get_session
from ..errors import ApiException
from ..models import (
    AlternativeGroup,
    AlternativeGroupKind,
    AlternativeGroupMember,
    AuditEvent,
    AuditEventKind,
    AuditTargetType,
    PlanningStatus,
    Route,
    Stay,
    Trip,
    Visibility,
    Visit,
)
from ..schemas import (
    AlternativeChoiceResponse,
    AlternativeChoose,
    AlternativeGroupCreate,
    AlternativeGroupResponse,
    AlternativeGroupUpdate,
    AlternativeMemberResponse,
    AlternativeSuggestion,
    AlternativeUndo,
    Identifier,
    RouteResponse,
    StayResponse,
    VisitResponse,
)
from .trips import owned_trip
from .visibility import choose_visibility

router = APIRouter(prefix="/trips/{trip_id}", tags=["alternatives"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]

Record = Stay | Visit | Route

_COLUMN = {
    AlternativeGroupKind.STAY: "stay_id",
    AlternativeGroupKind.VISIT: "visit_id",
    AlternativeGroupKind.ROUTE: "route_id",
}
_CHOICE_KINDS = (AuditEventKind.ALTERNATIVE_CHOOSE, AuditEventKind.ALTERNATIVE_UNDO_CHOICE)


def records_of(trip: Trip, kind: AlternativeGroupKind) -> dict[str, Record]:
    """The trip's records of one kind by id."""
    source = {
        AlternativeGroupKind.STAY: trip.stays,
        AlternativeGroupKind.VISIT: trip.visits,
        AlternativeGroupKind.ROUTE: trip.routes,
    }[kind]
    return {record.id: record for record in source}


def _not_found(detail: str = "Alternative group not found") -> ApiException:
    return ApiException(status_code=status.HTTP_404_NOT_FOUND, detail=detail, code="not_found")


def owned_group(session: Session, trip: Trip, group_id: str) -> AlternativeGroup:
    group = session.scalar(
        select(AlternativeGroup).where(AlternativeGroup.id == group_id, AlternativeGroup.trip_id == trip.id)
    )
    if group is None:
        raise _not_found()
    return group


def chosen_id(group: AlternativeGroup) -> str | None:
    return next((member.record_id for member in group.members if member.chosen), None)


def resolve_members(
    trip: Trip, kind: AlternativeGroupKind, member_ids: list[str], group: AlternativeGroup | None = None
) -> list[Record]:
    """The records to put in a group: all on this trip, all of its kind and none in another group."""
    records = records_of(trip, kind)
    found: list[Record] = []
    for record_id in dict.fromkeys(member_ids):
        record = records.get(record_id)
        if record is None:
            raise _not_found("Record not found")
        membership = record.alternative_membership
        if membership is not None and (group is None or membership.group_id != group.id):
            raise ApiException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A record is in at most one alternative group",
                code="a_record_is_in_at_most_one_alternative_group",
            )
        found.append(record)
    return found


def add_member(group: AlternativeGroup, record: Record) -> AlternativeGroupMember:
    member = AlternativeGroupMember(**{_COLUMN[group.kind]: record.id})
    group.members.append(member)
    return member


# --- Suggestions ----------------------------------------------------------------------------------


@dataclass(frozen=True)
class Suggestion:
    kind: AlternativeGroupKind
    member_ids: list[str]
    starts_on: date | None
    ends_on: date | None
    reason: str


def _clusters(items: list[tuple[Any, date, date]], *, inclusive: bool) -> list[list[tuple[Any, date, date]]]:
    """Chain items whose spans overlap. A night span ends the morning it checks out (``inclusive`` False); a
    day span includes its last day."""
    clusters: list[list[tuple[Any, date, date]]] = []
    reach: date | None = None
    for item in sorted(items, key=lambda entry: (entry[1], entry[2])):
        overlaps = reach is not None and (item[1] <= reach if inclusive else item[1] < reach)
        if overlaps:
            clusters[-1].append(item)
            reach = max(reach, item[2])
        else:
            clusters.append([item])
            reach = item[2]
    return clusters


def suggest_groups(trip: Trip) -> list[Suggestion]:
    """Groups of ungrouped ideas that look like alternatives. Nothing is stored.

    * Stays: ideas whose nights overlap, even when their dates differ (a chain of overlaps is one group).
    * Visits: ideas that each span several days and share a day. A single-day visit is not suggested, because
      two things on one day are usually both done.
    * Routes: ideas between the same two areas on the same day.
    """
    suggestions: list[Suggestion] = []
    stays = [
        (stay, stay.check_in_date, stay.check_out_date)
        for stay in trip.stays
        if stay.status == PlanningStatus.IDEA and stay.alternative_membership is None
    ]
    for cluster in _clusters(stays, inclusive=False):
        if len(cluster) > 1:
            suggestions.append(
                Suggestion(
                    AlternativeGroupKind.STAY,
                    [item[0].id for item in cluster],
                    min(item[1] for item in cluster),
                    max(item[2] for item in cluster),
                    "overlapping_nights",
                )
            )
    visits = [
        (visit, visit.starts_on, visit.ends_on)
        for visit in trip.visits
        if visit.status == PlanningStatus.IDEA
        and visit.alternative_membership is None
        and visit.starts_on is not None
        and visit.ends_on is not None
        and visit.ends_on > visit.starts_on
    ]
    for cluster in _clusters(visits, inclusive=True):
        if len(cluster) > 1:
            suggestions.append(
                Suggestion(
                    AlternativeGroupKind.VISIT,
                    [item[0].id for item in cluster],
                    min(item[1] for item in cluster),
                    max(item[2] for item in cluster),
                    "overlapping_days",
                )
            )
    journeys: dict[tuple[str, str, date | None], list[Route]] = {}
    for route in trip.routes:
        if route.status == PlanningStatus.IDEA and route.alternative_membership is None:
            journeys.setdefault((route.departure_area_id, route.arrival_area_id, route.departs_on), []).append(route)
    for (_, _, day), routes in journeys.items():
        if len(routes) > 1:
            suggestions.append(
                Suggestion(AlternativeGroupKind.ROUTE, [route.id for route in routes], day, day, "same_journey")
            )
    return suggestions


# --- Choosing -------------------------------------------------------------------------------------


def _remove_records(session: Session, records: list[Record]) -> None:
    """Delete the rejected records."""
    for record in records:
        session.delete(record)
    session.flush()


@dataclass
class Choice:
    group: AlternativeGroup
    event: AuditEvent
    chosen_id: str
    cancelled_ids: list[str]
    removed_ids: list[str]
    undoable: bool


def _snapshot(record: Record) -> dict[str, str]:
    return {"id": record.id, "status": record.status.value, "visibility": record.visibility.value}


def choose(
    session: Session,
    trip: Trip,
    subject: str,
    group: AlternativeGroup,
    member_id: str,
    others: str,
) -> Choice:
    """Choose one member: it becomes planned, the others cancelled or removed, as one operation.

    Runs in the caller's transaction (the caller commits), so the new statuses, the group's chosen member
    and the audit event land together or not at all. The chosen member keeps its status when it is already
    planned or confirmed. A rejected member is also made private, because a cancelled alternative must not
    stay on the audience's page; that choice is recorded like any other audience change.
    """
    kind = group.kind
    by_id = {member.record_id: member for member in group.members}
    target = by_id.get(member_id)
    if target is None:
        raise _not_found("Alternative not found in this group")
    records = records_of(trip, kind)
    members = {record_id: records[record_id] for record_id in by_id if record_id in records}
    before = {record_id: _snapshot(record) for record_id, record in members.items()}
    previous = chosen_id(group)

    for member in group.members:
        member.chosen = False
    session.flush()
    target.chosen = True

    planned = PlanningStatus.PLANNED
    cancelled = PlanningStatus.CANCELLED
    chosen_record = members[member_id]
    if chosen_record.status.value in ("idea", "cancelled"):
        chosen_record.status = planned

    rejected = [record for record_id, record in members.items() if record_id != member_id]
    if others == "remove":
        _remove_records(session, rejected)
        cancelled_ids: list[str] = []
        removed_ids = [record.id for record in rejected]
    else:
        for record in rejected:
            if record.visibility != Visibility.PRIVATE:
                choose_visibility(session, trip, subject, kind.value, record.id, Visibility.PRIVATE)
        for record in rejected:
            record.status = cancelled
        cancelled_ids = [record.id for record in rejected]
        removed_ids = []

    after = {record_id: _snapshot(record) for record_id, record in members.items() if record_id not in removed_ids}
    undoable = others != "remove"
    event = record_audit_event(
        session,
        trip_id=trip.id,
        actor_subject=subject,
        kind=AuditEventKind.ALTERNATIVE_CHOOSE,
        target_type=AuditTargetType.ALTERNATIVE_GROUP,
        target_id=group.id,
        occurred_at=datetime.now(UTC),
        details={
            "record_kind": kind.value,
            "chosen_id": member_id,
            "previous_chosen_id": previous,
            "others": others,
            "undoable": undoable,
            "before": list(before.values()),
            "after": list(after.values()),
            "removed": removed_ids,
        },
    )
    session.expire(group, ["members"])
    return Choice(group, event, member_id, cancelled_ids, removed_ids, undoable)


def latest_choice_event(session: Session, trip_id: str, group_id: str) -> AuditEvent | None:
    return session.scalar(
        select(AuditEvent)
        .where(
            AuditEvent.trip_id == trip_id,
            AuditEvent.target_type == AuditTargetType.ALTERNATIVE_GROUP,
            AuditEvent.target_id == group_id,
            AuditEvent.kind.in_(_CHOICE_KINDS),
        )
        .order_by(AuditEvent.occurred_at.desc(), AuditEvent.id.desc())
        .limit(1)
    )


def _cannot_undo(code: str, detail: str) -> ApiException:
    return ApiException(status_code=status.HTTP_409_CONFLICT, detail=detail, code=code)


def undo_choice(
    session: Session,
    trip: Trip,
    subject: str,
    group: AlternativeGroup,
    event_id: str | None,
) -> AuditEvent:
    """Put the group back as it was before its latest choice.

    Only the latest choice can be undone, and only while its members still have the statuses the choice gave
    them: an edit made since is never overwritten. A choice that removed records cannot be undone. The caller
    commits."""
    event = latest_choice_event(session, trip.id, group.id)
    if event is None or event.kind != AuditEventKind.ALTERNATIVE_CHOOSE:
        raise _cannot_undo("there_is_no_alternative_choice_to_undo", "There is no choice to undo")
    if event_id is not None and event_id != event.id:
        raise _cannot_undo("a_newer_alternative_choice_replaced_this_one", "A newer choice replaced this one")
    details = event.details
    if not details.get("undoable"):
        raise _cannot_undo(
            "removed_alternatives_cannot_be_restored", "The alternatives were removed, so the choice cannot be undone"
        )
    kind = group.kind
    records = records_of(trip, kind)
    by_id = {member.record_id: member for member in group.members}
    for entry in details["after"]:
        record = records.get(entry["id"])
        if (
            record is None
            or entry["id"] not in by_id
            or record.status.value != entry["status"]
            or record.visibility.value != entry["visibility"]
        ):
            raise _cannot_undo(
                "the_alternatives_changed_since_this_choice", "The alternatives were edited after this choice"
            )
    for entry in details["before"]:
        record = records[entry["id"]]
        record.status = PlanningStatus(entry["status"])
        if record.visibility.value != entry["visibility"]:
            choose_visibility(session, trip, subject, kind.value, record.id, Visibility(entry["visibility"]))
    for member in group.members:
        member.chosen = False
    session.flush()
    if details.get("previous_chosen_id") in by_id:
        by_id[details["previous_chosen_id"]].chosen = True
    undo = record_audit_event(
        session,
        trip_id=trip.id,
        actor_subject=subject,
        kind=AuditEventKind.ALTERNATIVE_UNDO_CHOICE,
        target_type=AuditTargetType.ALTERNATIVE_GROUP,
        target_id=group.id,
        occurred_at=datetime.now(UTC),
        details={"record_kind": kind.value, "undoes": event.id},
    )
    session.expire(group, ["members"])
    return undo


# --- Endpoints ------------------------------------------------------------------------------------


def _group_query(trip_id: str):
    return (
        select(AlternativeGroup)
        .where(AlternativeGroup.trip_id == trip_id)
        .options(selectinload(AlternativeGroup.members))
        .order_by(AlternativeGroup.created_at, AlternativeGroup.id)
    )


def group_response(group: AlternativeGroup) -> AlternativeGroupResponse:
    """The group with its member records, for the owner only."""
    members = [
        AlternativeMemberResponse(
            record_id=member.record_id,
            chosen=member.chosen,
            stay=StayResponse.model_validate(member.stay) if member.stay else None,
            visit=VisitResponse.model_validate(member.visit) if member.visit else None,
            route=RouteResponse.model_validate(member.route) if member.route else None,
        )
        for member in group.members
    ]
    return AlternativeGroupResponse(
        id=group.id,
        kind=group.kind,
        label=group.label,
        chosen_id=chosen_id(group),
        members=members,
        created_at=group.created_at,
        updated_at=group.updated_at,
    )


def _commit_or_conflict(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A record is in at most one alternative group",
            code="a_record_is_in_at_most_one_alternative_group",
        ) from error


@router.get("/alternative-groups", response_model=list[AlternativeGroupResponse])
def list_alternative_groups(
    trip_id: Identifier, session: SessionDep, subject: SubjectDep
) -> list[AlternativeGroupResponse]:
    trip = owned_trip(session, trip_id, subject)
    return [group_response(group) for group in session.scalars(_group_query(trip.id))]


@router.get("/alternative-groups/suggestions", response_model=list[AlternativeSuggestion])
def suggest_alternative_groups(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> list[Suggestion]:
    """Ungrouped ideas over matching or overlapping dates. Stores nothing: confirm one by creating the group."""
    return suggest_groups(owned_trip(session, trip_id, subject, load_relations=True))


@router.post("/alternative-groups", response_model=AlternativeGroupResponse, status_code=status.HTTP_201_CREATED)
def create_alternative_group(
    trip_id: Identifier, payload: AlternativeGroupCreate, session: SessionDep, subject: SubjectDep
) -> AlternativeGroupResponse:
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    records = resolve_members(trip, payload.kind, payload.member_ids)
    if len(records) < 2:
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Alternatives need at least two different records",
            code="alternatives_need_at_least_two_different_records",
        )
    group = AlternativeGroup(trip=trip, kind=payload.kind, label=payload.label)
    session.add(group)
    for record in records:
        add_member(group, record)
    _commit_or_conflict(session)
    return group_response(session.scalars(_group_query(trip.id).where(AlternativeGroup.id == group.id)).one())


@router.get("/alternative-groups/{group_id}", response_model=AlternativeGroupResponse)
def get_alternative_group(
    trip_id: Identifier, group_id: Identifier, session: SessionDep, subject: SubjectDep
) -> AlternativeGroupResponse:
    return group_response(owned_group(session, owned_trip(session, trip_id, subject), group_id))


@router.patch("/alternative-groups/{group_id}", response_model=AlternativeGroupResponse)
def update_alternative_group(
    trip_id: Identifier,
    group_id: Identifier,
    payload: AlternativeGroupUpdate,
    session: SessionDep,
    subject: SubjectDep,
) -> AlternativeGroupResponse:
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    group = owned_group(session, trip, group_id)
    if "label" in payload.model_fields_set:
        group.label = payload.label
    by_id = {member.record_id: member for member in group.members}
    for record_id in payload.remove_member_ids or []:
        member = by_id.get(record_id)
        if member is None:
            raise _not_found("Alternative not found in this group")
        group.members.remove(member)
    joining = [record_id for record_id in payload.add_member_ids or [] if record_id not in by_id]
    for record in resolve_members(trip, group.kind, joining, group):
        add_member(group, record)
    _commit_or_conflict(session)
    return group_response(session.scalars(_group_query(trip.id).where(AlternativeGroup.id == group.id)).one())


@router.delete("/alternative-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_alternative_group(
    trip_id: Identifier, group_id: Identifier, session: SessionDep, subject: SubjectDep
) -> Response:
    """Dissolve a group. Its records and their statuses are untouched."""
    session.delete(owned_group(session, owned_trip(session, trip_id, subject), group_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/alternative-groups/{group_id}/choose", response_model=AlternativeChoiceResponse)
def choose_alternative(
    trip_id: Identifier, group_id: Identifier, payload: AlternativeChoose, session: SessionDep, subject: SubjectDep
) -> AlternativeChoiceResponse:
    """Choose this one: it becomes planned and the others are cancelled or removed, in one transaction.

    The audit event it returns can be undone with ``undo-choice`` unless the others were removed."""
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    group = owned_group(session, trip, group_id)
    outcome = choose(session, trip, subject, group, payload.member_id, payload.others)
    session.commit()
    session.refresh(group)
    return AlternativeChoiceResponse(
        group=group_response(group),
        event_id=outcome.event.id,
        chosen_id=outcome.chosen_id,
        cancelled_ids=outcome.cancelled_ids,
        removed_ids=outcome.removed_ids,
        undoable=outcome.undoable,
    )


@router.post("/alternative-groups/{group_id}/undo-choice", response_model=AlternativeGroupResponse)
def undo_alternative_choice(
    trip_id: Identifier,
    group_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    payload: AlternativeUndo | None = None,
) -> AlternativeGroupResponse:
    """Undo the group's latest choice while its members are as that choice left them."""
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    group = owned_group(session, trip, group_id)
    undo_choice(session, trip, subject, group, payload.event_id if payload else None)
    session.commit()
    session.refresh(group)
    return group_response(group)
