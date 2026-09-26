"""Owner-wide document library and emergency information.

Both resources are scoped directly to the authenticated owner subject rather
than to a trip, so an owner never needs a dummy trip to hold reusable
documents or emergency contacts. Neither resource is ever projected onto a
public/unlisted trip response.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..library.service import LibraryError, delete_owner_document, direct_upload
from ..models import DocumentKind, EmergencyInfoEntry, OwnerDocument
from ..schemas import (
    EmergencyInfoEntryCreate,
    EmergencyInfoEntryResponse,
    EmergencyInfoEntryUpdate,
    OwnerDocumentResponse,
    OwnerDocumentUpdate,
)
from ..storage import ObjectStorage, get_storage
from .trips import owned_trip

router = APIRouter(prefix="/library", tags=["library"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
StorageDep = Annotated[ObjectStorage, Depends(get_storage)]


def _document_response(document: OwnerDocument) -> OwnerDocumentResponse:
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


def owned_library_document(session: Session, subject: str, document_id: str) -> OwnerDocument:
    document = session.scalar(
        select(OwnerDocument).where(
            OwnerDocument.id == document_id,
            OwnerDocument.owner_subject == subject,
            OwnerDocument.deleted_at.is_(None),
        )
    )
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return document


def owned_emergency_entry(session: Session, subject: str, entry_id: str) -> EmergencyInfoEntry:
    entry = session.scalar(
        select(EmergencyInfoEntry).where(EmergencyInfoEntry.id == entry_id, EmergencyInfoEntry.owner_subject == subject)
    )
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Emergency info entry not found")
    return entry


@router.post("/documents/uploads", response_model=OwnerDocumentResponse)
def upload_library_document(
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    response: Response,
    title: Annotated[str, Form(min_length=1, max_length=160)],
    document_kind: Annotated[DocumentKind, Form()],
    file: Annotated[UploadFile, File()],
    linked_trip_id: Annotated[str | None, Form()] = None,
) -> OwnerDocumentResponse:
    if linked_trip_id:
        owned_trip(session, linked_trip_id, subject)
    if not file.content_type:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A content type is required")
    try:
        document, created = direct_upload(
            session,
            storage,
            owner_subject=subject,
            filename=file.filename or "upload",
            content_type=file.content_type,
            data=file.file.read(),
            document_kind=document_kind,
            title=title,
            linked_trip_id=linked_trip_id,
        )
    except LibraryError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return _document_response(document)


@router.get("/documents", response_model=list[OwnerDocumentResponse])
def list_library_documents(
    session: SessionDep, subject: SubjectDep, linked_trip_id: str | None = None
) -> list[OwnerDocumentResponse]:
    query = select(OwnerDocument).where(OwnerDocument.owner_subject == subject, OwnerDocument.deleted_at.is_(None))
    if linked_trip_id is not None:
        query = query.where(OwnerDocument.linked_trip_id == linked_trip_id)
    documents = session.scalars(query.order_by(OwnerDocument.created_at.desc()))
    return [_document_response(document) for document in documents]


@router.get("/documents/{document_id}", response_model=OwnerDocumentResponse)
def get_library_document(document_id: str, session: SessionDep, subject: SubjectDep) -> OwnerDocumentResponse:
    return _document_response(owned_library_document(session, subject, document_id))


@router.patch("/documents/{document_id}", response_model=OwnerDocumentResponse)
def update_library_document(
    document_id: str, payload: OwnerDocumentUpdate, session: SessionDep, subject: SubjectDep
) -> OwnerDocumentResponse:
    document = owned_library_document(session, subject, document_id)
    updates = payload.model_dump(exclude_unset=True)
    if "linked_trip_id" in updates and updates["linked_trip_id"] is not None:
        owned_trip(session, updates["linked_trip_id"], subject)
    for field, value in updates.items():
        setattr(document, field, value)
    session.commit()
    session.refresh(document)
    return _document_response(document)


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_library_document(
    document_id: str, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> Response:
    delete_owner_document(session, storage, document=owned_library_document(session, subject, document_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/documents/{document_id}/original")
def get_library_document_original(
    document_id: str, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> StreamingResponse:
    original = owned_library_document(session, subject, document_id).original_object
    return StreamingResponse(
        iter([storage.get(original.object_key)]),
        media_type=original.content_type,
        headers={"Cache-Control": "no-store"},
    )


@router.get("/emergency-info", response_model=list[EmergencyInfoEntryResponse])
def list_emergency_info(session: SessionDep, subject: SubjectDep) -> list[EmergencyInfoEntry]:
    return list(
        session.scalars(
            select(EmergencyInfoEntry)
            .where(EmergencyInfoEntry.owner_subject == subject)
            .order_by(EmergencyInfoEntry.created_at)
        )
    )


@router.post("/emergency-info", response_model=EmergencyInfoEntryResponse, status_code=status.HTTP_201_CREATED)
def create_emergency_info(
    payload: EmergencyInfoEntryCreate, session: SessionDep, subject: SubjectDep
) -> EmergencyInfoEntry:
    entry = EmergencyInfoEntry(owner_subject=subject, **payload.model_dump())
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


@router.get("/emergency-info/{entry_id}", response_model=EmergencyInfoEntryResponse)
def get_emergency_info_entry(entry_id: str, session: SessionDep, subject: SubjectDep) -> EmergencyInfoEntry:
    return owned_emergency_entry(session, subject, entry_id)


@router.patch("/emergency-info/{entry_id}", response_model=EmergencyInfoEntryResponse)
def update_emergency_info(
    entry_id: str, payload: EmergencyInfoEntryUpdate, session: SessionDep, subject: SubjectDep
) -> EmergencyInfoEntry:
    entry = owned_emergency_entry(session, subject, entry_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    session.commit()
    session.refresh(entry)
    return entry


@router.delete("/emergency-info/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_emergency_info(entry_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    session.delete(owned_emergency_entry(session, subject, entry_id))
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
