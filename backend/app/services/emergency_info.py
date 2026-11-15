"""Owner-wide emergency information.

Scoped directly to the authenticated owner subject rather than to a trip, so an owner never needs a dummy trip to
hold emergency contacts. Never projected onto a public/unlisted trip response. Like every service this never commits.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import RecordNotFound
from ..models import EmergencyInfoEntry
from ..schemas import EmergencyInfoEntryCreate, EmergencyInfoEntryUpdate, Identifier


def owned_emergency_entry(session: Session, subject: str, entry_id: Identifier) -> EmergencyInfoEntry:
    entry = session.scalar(
        select(EmergencyInfoEntry).where(EmergencyInfoEntry.id == entry_id, EmergencyInfoEntry.owner_subject == subject)
    )
    if entry is None:
        raise RecordNotFound("Emergency info entry not found")
    return entry


def list_emergency_info(session: Session, subject: str) -> list[EmergencyInfoEntry]:
    return list(
        session.scalars(
            select(EmergencyInfoEntry)
            .where(EmergencyInfoEntry.owner_subject == subject)
            .order_by(EmergencyInfoEntry.created_at)
        )
    )


def create_emergency_info(session: Session, subject: str, payload: EmergencyInfoEntryCreate) -> EmergencyInfoEntry:
    entry = EmergencyInfoEntry(owner_subject=subject, **payload.model_dump())
    session.add(entry)
    session.flush()
    session.refresh(entry)
    return entry


def get_emergency_info_entry(session: Session, subject: str, entry_id: Identifier) -> EmergencyInfoEntry:
    return owned_emergency_entry(session, subject, entry_id)


def update_emergency_info(
    session: Session, subject: str, entry_id: Identifier, payload: EmergencyInfoEntryUpdate
) -> EmergencyInfoEntry:
    entry = owned_emergency_entry(session, subject, entry_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    session.flush()
    session.refresh(entry)
    return entry


def delete_emergency_info(session: Session, subject: str, entry_id: Identifier) -> None:
    session.delete(owned_emergency_entry(session, subject, entry_id))
    session.flush()
