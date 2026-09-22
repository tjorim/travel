"""Copy-verify-record handling for the owner-wide document library.

Deliberately a separate, trip-independent inventory: :class:`OwnerStoredObject`
mirrors :class:`~app.models.StoredObject`'s dedup/checksum/opaque-key rules,
but keyed by ``owner_subject`` instead of ``trip_id`` so this pipeline never
touches the trip-scoped media/track/document pipeline in ``app.media.service``.
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..media.service import MediaImportError
from ..models import DocumentKind, ObjectState, OwnerDocument, OwnerStoredObject, opaque_id
from ..storage import ObjectStorage, sha256_hex


class LibraryError(MediaImportError):
    """A rejected owner-library upload: oversized, empty, or a storage
    checksum mismatch."""


def _store_owner_bytes(
    session: Session, storage: ObjectStorage, *, owner_subject: str, data: bytes, content_type: str
) -> OwnerStoredObject:
    if not data:
        raise LibraryError("File must not be empty")

    digest = sha256_hex(data)
    existing = session.scalar(
        select(OwnerStoredObject).where(
            OwnerStoredObject.owner_subject == owner_subject, OwnerStoredObject.sha256 == digest
        )
    )
    if existing is not None and existing.state == ObjectState.AVAILABLE:
        return existing

    key = existing.object_key if existing is not None else f"owner/{opaque_id()}"
    storage.put(key, data)
    verified = sha256_hex(storage.get(key)) == digest

    if existing is not None:
        existing.byte_size = len(data)
        existing.content_type = content_type
        existing.state = ObjectState.AVAILABLE if verified else ObjectState.QUARANTINED
        obj = existing
    else:
        obj = OwnerStoredObject(
            owner_subject=owner_subject,
            object_key=key,
            sha256=digest,
            byte_size=len(data),
            content_type=content_type,
            state=ObjectState.AVAILABLE if verified else ObjectState.QUARANTINED,
        )
        session.add(obj)
    session.flush()
    if not verified:
        raise LibraryError("Stored object failed checksum verification after write")
    return obj


def direct_upload(
    session: Session,
    storage: ObjectStorage,
    *,
    owner_subject: str,
    filename: str,
    content_type: str,
    data: bytes,
    document_kind: DocumentKind,
    title: str,
    linked_trip_id: str | None,
) -> tuple[OwnerDocument, bool]:
    """Store an owner-wide document original and create one retry-safe record."""
    stored = _store_owner_bytes(session, storage, owner_subject=owner_subject, data=data, content_type=content_type)
    existing = session.scalar(
        select(OwnerDocument).where(
            OwnerDocument.owner_subject == owner_subject, OwnerDocument.original_object_id == stored.id
        )
    )
    if existing is not None:
        session.commit()
        return existing, False

    document = OwnerDocument(
        owner_subject=owner_subject,
        original_object_id=stored.id,
        document_kind=document_kind,
        title=title,
        owner_metadata={"original_filename": filename},
        linked_trip_id=linked_trip_id,
    )
    session.add(document)
    session.commit()
    return document, True


def delete_owner_document(session: Session, *, document: OwnerDocument) -> None:
    """Soft-delete an owner-wide document original."""
    document.deleted_at = datetime.now(UTC)
    session.commit()
