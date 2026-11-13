"""Owner-wide document library and emergency information.

Both resources are scoped directly to the authenticated owner subject rather than to a trip, so an owner never
needs a dummy trip to hold reusable documents or emergency contacts. Neither resource is ever projected onto a
public/unlisted trip response.

Uploading and removing a stored original follow the object-storage lifecycle (``docs/object-storage.md``), so those
two operations commit inside ``app.library.service``. Every other operation here leaves the commit to the caller.
"""

from typing import BinaryIO

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import RecordNotFound, Refusal, service_error
from ..library.service import LibraryError, delete_owner_document, direct_upload
from ..media.service import read_bounded_upload
from ..models import DocumentKind, EmergencyInfoEntry, OwnerDocument
from ..schemas import (
    EmergencyInfoEntryCreate,
    EmergencyInfoEntryUpdate,
    Identifier,
    OwnerDocumentResponse,
    OwnerDocumentUpdate,
)
from ..storage import ObjectStorage
from .trips import owned_trip


def document_response(document: OwnerDocument) -> OwnerDocumentResponse:
    original = document.original_object
    return OwnerDocumentResponse(
        id=document.id,
        document_kind=document.document_kind,
        title=document.title,
        byte_size=original.byte_size,
        content_type=original.content_type,
        original_filename=document.owner_metadata.get("original_filename"),
        linked_trip_id=document.linked_trip_id,
        created_at=document.created_at,
        deleted_at=document.deleted_at,
        file_url=f"/api/library/documents/{document.id}/original",
    )


def owned_library_document(session: Session, subject: str, document_id: Identifier) -> OwnerDocument:
    document = session.scalar(
        select(OwnerDocument).where(
            OwnerDocument.id == document_id,
            OwnerDocument.owner_subject == subject,
            OwnerDocument.deleted_at.is_(None),
        )
    )
    if document is None:
        raise RecordNotFound("Document not found")
    return document


def owned_emergency_entry(session: Session, subject: str, entry_id: Identifier) -> EmergencyInfoEntry:
    entry = session.scalar(
        select(EmergencyInfoEntry).where(EmergencyInfoEntry.id == entry_id, EmergencyInfoEntry.owner_subject == subject)
    )
    if entry is None:
        raise RecordNotFound("Emergency info entry not found")
    return entry


def upload_library_document(
    session: Session,
    storage: ObjectStorage,
    subject: str,
    *,
    title: str,
    document_kind: DocumentKind,
    filename: str | None,
    content_type: str | None,
    file: BinaryIO,
    linked_trip_id: Identifier | None = None,
) -> tuple[OwnerDocumentResponse, bool]:
    """Store a library document original; the flag says whether the document is new."""
    if linked_trip_id:
        owned_trip(session, linked_trip_id, subject)
    if not content_type:
        raise Refusal("A content type is required", code="a_content_type_is_required")
    try:
        with read_bounded_upload(file, LibraryError) as data:
            document, created = direct_upload(
                session,
                storage,
                owner_subject=subject,
                filename=filename or "upload",
                content_type=content_type,
                data=data,
                document_kind=document_kind,
                title=title,
                linked_trip_id=linked_trip_id,
            )
    except LibraryError as error:
        raise service_error(error) from error
    return document_response(document), created


def list_library_documents(
    session: Session, subject: str, linked_trip_id: Identifier | None = None
) -> list[OwnerDocumentResponse]:
    query = select(OwnerDocument).where(OwnerDocument.owner_subject == subject, OwnerDocument.deleted_at.is_(None))
    if linked_trip_id is not None:
        query = query.where(OwnerDocument.linked_trip_id == linked_trip_id)
    documents = session.scalars(query.order_by(OwnerDocument.created_at.desc()))
    return [document_response(document) for document in documents]


def get_library_document(session: Session, subject: str, document_id: Identifier) -> OwnerDocumentResponse:
    return document_response(owned_library_document(session, subject, document_id))


def update_library_document(
    session: Session, subject: str, document_id: Identifier, payload: OwnerDocumentUpdate
) -> OwnerDocumentResponse:
    document = owned_library_document(session, subject, document_id)
    updates = payload.model_dump(exclude_unset=True)
    if "linked_trip_id" in updates and updates["linked_trip_id"] is not None:
        owned_trip(session, updates["linked_trip_id"], subject)
    for field, value in updates.items():
        setattr(document, field, value)
    session.flush()
    session.refresh(document)
    return document_response(document)


def remove_library_document(session: Session, storage: ObjectStorage, subject: str, document_id: Identifier) -> None:
    delete_owner_document(session, storage, document=owned_library_document(session, subject, document_id))


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
