"""Bulk choice: let visits and stays follow each audience's date precision."""

from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..audit import live_audiences, record_audit_event
from ..auth import current_subject
from ..database import get_session
from ..errors import ApiException
from ..models import AuditEventKind, AuditTargetType, Trip
from ..precision import audience_precision, effective_precision, is_finer, own_value
from ..projection import delivered
from ..schemas import (
    FollowAudienceAudience,
    FollowAudiencePrecisionRequest,
    FollowAudiencePrecisionResult,
    Identifier,
    PrecisionCounts,
)
from ..services.trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["publication"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]

PRECISION_WIDENING_CODE = "precision_widening_needs_acknowledgement"
_PLURAL = {"visit": "visits", "stay": "stays"}


def _own_records(trip: Trip, kinds: Sequence[str]) -> dict[str, list]:
    """The selected records that hold their own precision (the only ones this changes)."""
    sources = {"visit": trip.visits, "stay": trip.stays}
    return {kind: [item for item in sources[kind] if own_value(item) is not None] for kind in dict.fromkeys(kinds)}


def _dated(kind: str, record) -> bool:
    return kind != "visit" or record.starts_on is not None


def follow_audience_precision(
    trip_id: Identifier, payload: FollowAudiencePrecisionRequest, session: Session, subject: str
) -> FollowAudiencePrecisionResult:
    """Preview, or with ``confirm`` apply, setting visits' and stays' own date precision to null.

    A record then follows each audience's setting. Where an audience allows finer dates than the
    record's own value did, a live audience starts to read finer dates: the preview counts those
    records per audience, and a confirmed change is refused with 409 until ``confirm_widening``
    accepts them. Following an audience that sets nothing reads by month, so it can also narrow."""
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    selected = _own_records(trip, payload.kinds)
    live = live_audiences(session, trip.id)
    audiences: list[FollowAudienceAudience] = []
    for audience in live:
        received = delivered(trip, audience.scope)
        cap = audience_precision(audience.scope)
        widened, narrowed = PrecisionCounts(), PrecisionCounts()
        for kind, records in selected.items():
            reached = {item.id for item in received[kind]}
            for record in records:
                if record.id not in reached or not _dated(kind, record):
                    continue
                before, after = effective_precision(own_value(record), cap), effective_precision(None, cap)
                for counts, finer in ((widened, is_finer(after, before)), (narrowed, is_finer(before, after))):
                    if finer:
                        setattr(counts, _PLURAL[kind], getattr(counts, _PLURAL[kind]) + 1)
        if any((*widened.model_dump().values(), *narrowed.model_dump().values())):
            audiences.append(
                FollowAudienceAudience(audience=audience.id, label=audience.label, widened=widened, narrowed=narrowed)
            )
    changed = PrecisionCounts(**{_PLURAL[kind]: len(records) for kind, records in selected.items()})
    result = FollowAudiencePrecisionResult(applied=payload.confirm, changed=changed, audiences=audiences)
    if not payload.confirm:
        return result
    if any(item.widened.visits or item.widened.stays for item in audiences) and not payload.confirm_widening:
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": PRECISION_WIDENING_CODE,
                "audiences": [item.model_dump() for item in audiences if item.widened.visits or item.widened.stays],
            },
            code=PRECISION_WIDENING_CODE,
        )
    for records in selected.values():
        for record in records:
            record.share_date_precision = None
    if any(changed.model_dump().values()):
        record_audit_event(
            session,
            trip_id=trip.id,
            actor_subject=subject,
            kind=AuditEventKind.PRECISION_FOLLOW_AUDIENCE,
            target_type=AuditTargetType.RECORD,
            target_id=trip.id,
            details={
                "kinds": sorted(selected),
                "changed": changed.model_dump(),
                # Audience ids and counts only: a link's label is the owner's own text.
                "audiences": [
                    {
                        "audience": item.audience,
                        "widened": item.widened.model_dump(),
                        "narrowed": item.narrowed.model_dump(),
                    }
                    for item in audiences
                ],
            },
        )
    return result


@router.post("/date-precision/follow-audience", response_model=FollowAudiencePrecisionResult)
def follow_audience_precision_endpoint(
    trip_id: Identifier, payload: FollowAudiencePrecisionRequest, session: SessionDep, subject: SubjectDep
) -> FollowAudiencePrecisionResult:
    result = follow_audience_precision(trip_id, payload, session, subject)
    session.commit()
    return result
