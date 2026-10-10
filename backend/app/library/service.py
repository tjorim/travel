"""Copy-verify-record handling for the owner-wide document library.

Deliberately a separate, trip-independent inventory: :class:`OwnerStoredObject`
mirrors :class:`~app.models.StoredObject`'s dedup/checksum/opaque-key rules,
but keyed by ``owner_subject`` instead of ``trip_id`` so this pipeline never
touches the trip-scoped media/document pipeline in ``app.media.service``.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..media.service import MediaImportError, upload_too_large_error
from ..models import DocumentKind, ObjectState, OwnerDocument, OwnerStoredObject, opaque_id
from ..storage import ObjectStorage, sha256_hex


class LibraryError(MediaImportError):
    """A rejected owner-library upload: oversized, empty, or a storage
    checksum mismatch."""


def _store_owner_bytes(
    session: Session, storage: ObjectStorage, *, owner_subject: str, data: bytes, content_type: str
) -> OwnerStoredObject:
    if not data:
        raise LibraryError("Het bestand is leeg.", code="file_empty")
    if len(data) > settings.media_max_upload_bytes:
        raise upload_too_large_error(LibraryError)

    digest = sha256_hex(data)
    existing = session.scalar(
        select(OwnerStoredObject)
        .where(OwnerStoredObject.owner_subject == owner_subject, OwnerStoredObject.sha256 == digest)
        .with_for_update()
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
        raise LibraryError(
            "Stored object failed checksum verification after write",
            code="stored_object_failed_checksum_verification_after_write",
        )
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


def purge_owner_objects(session: Session, storage: ObjectStorage, *, object_ids: list[str] | None = None) -> int:
    """Retry physical removal of unreferenced owner-library objects."""
    if object_ids is None:
        object_ids = list(
            session.scalars(select(OwnerStoredObject.id).where(OwnerStoredObject.state == ObjectState.PURGE_PENDING))
        )
    purged = 0
    for object_id in object_ids:
        stored = session.scalar(select(OwnerStoredObject).where(OwnerStoredObject.id == object_id).with_for_update())
        if stored is None or stored.state != ObjectState.PURGE_PENDING:
            session.rollback()
            continue
        if session.scalar(select(OwnerDocument.id).where(OwnerDocument.original_object_id == stored.id)) is not None:
            stored.state = ObjectState.AVAILABLE
            session.commit()
            continue
        storage.delete(stored.object_key)
        session.delete(stored)
        session.commit()
        purged += 1
    return purged


def delete_owner_document(session: Session, storage: ObjectStorage, *, document: OwnerDocument) -> None:
    """Remove an owner-wide document and purge its stored original."""
    object_id = document.original_object_id
    session.delete(document)
    session.flush()
    stored = session.get_one(OwnerStoredObject, object_id)
    if session.scalar(select(OwnerDocument.id).where(OwnerDocument.original_object_id == object_id)) is None:
        stored.state = ObjectState.PURGE_PENDING
    session.commit()
    purge_owner_objects(session, storage, object_ids=[object_id])
