"""Who receives a shareable record: one choice for every kind of record."""

from collections.abc import Iterable
from typing import Any

from sqlalchemy.orm import Session

from ..access import find_record, receivers, set_visibility
from ..audit import delivering_audiences, record_visibility_change
from ..errors import RecordNotFound, service_error
from ..models import Trip, Visibility
from ..schemas import Identifier
from .trips import owned_trip


def choose_visibility(
    session: Session, trip: Trip, subject: str, kind: str, record_id: str, visibility: Visibility
) -> Any | None:
    """Apply the choice and record the change in the sharing history, or return ``None`` for an unknown record.

    The caller commits. Merging locations or areas uses it to make a moved record
    private first, so that choice is audited and withdraws the record from every
    scope exactly like choosing it through the visibility endpoint."""
    existing = find_record(trip, kind, record_id)
    before = existing.visibility if existing is not None else Visibility.PRIVATE
    before_receivers = (
        receivers(kind, existing, delivering_audiences(session, trip.id)) if existing is not None else set()
    )
    try:
        record = set_visibility(trip, kind, record_id, visibility)
    except ValueError as error:
        raise service_error(error) from error
    if record is not None:
        record_visibility_change(
            session,
            trip_id=trip.id,
            actor_subject=subject,
            kind=kind,
            record=record,
            before=before,
            before_receivers=before_receivers,
        )
    return record


def make_private(session: Session, trip: Trip, subject: str, chosen: Iterable[tuple[str, str]]) -> None:
    """Make each ``(kind, id)`` record private through ``choose_visibility``; the caller commits."""
    for kind, record_id in chosen:
        choose_visibility(session, trip, subject, kind, record_id, Visibility.PRIVATE)


def put_visibility(
    session: Session, subject: str, trip_id: Identifier, kind: str, record_id: Identifier, visibility: Visibility
) -> Visibility:
    """Choose private, everyone or custom for one record of the owner's trip.

    The same choice for every kind; leaving ``custom`` withdraws the record from every scope that listed it."""
    trip = owned_trip(session, trip_id, subject)
    record = choose_visibility(session, trip, subject, kind, record_id, visibility)
    if record is None:
        raise RecordNotFound("Record not found")
    return record.visibility
