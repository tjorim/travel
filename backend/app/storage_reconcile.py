"""Find and remove stored files that no database row references.

An object is written before its row commits, so a crash in between leaves an
unreferenced file, and a backup taken while Travel keeps running may archive
objects written after its database snapshot (apps#245).  The purge works from
rows and never sees those files.  Only files older than a grace period are
considered, so an upload between its write and its commit is never touched.
See docs/object-storage.md.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import OwnerStoredObject, StoredObject
from .storage import ObjectStorage


def unreferenced_objects(
    session: Session, storage: ObjectStorage, *, older_than: timedelta, now: datetime | None = None
) -> list[str]:
    """Keys of stored files older than *older_than* that no object row names, in any state."""
    referenced = set(session.scalars(select(StoredObject.object_key)))
    referenced.update(session.scalars(select(OwnerStoredObject.object_key)))
    cutoff = ((now or datetime.now(UTC)) - older_than).timestamp()
    return sorted(key for key, modified in storage.objects() if modified < cutoff and key not in referenced)


def remove_unreferenced_objects(
    session: Session, storage: ObjectStorage, *, older_than: timedelta, now: datetime | None = None
) -> int:
    keys = unreferenced_objects(session, storage, older_than=older_than, now=now)
    for key in keys:
        storage.delete(key)
    return len(keys)
