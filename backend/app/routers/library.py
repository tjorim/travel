"""Owner-wide document library and emergency information.

Both resources are scoped directly to the authenticated owner subject rather
than to a trip, so an owner never needs a dummy trip to hold reusable
documents or emergency contacts. Neither resource is ever projected onto a
public/unlisted trip response.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..media.ranges import private_original_headers
from ..models import DocumentKind, EmergencyInfoEntry
from ..schemas import (
    DocumentTitle,
    EmergencyInfoEntryCreate,
    EmergencyInfoEntryResponse,
    EmergencyInfoEntryUpdate,
    Identifier,
    OwnerDocumentResponse,
    OwnerDocumentUpdate,
)
from ..services import library as service
from ..storage import ObjectStorage, get_storage

router = APIRouter(prefix="/library", tags=["library"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
StorageDep = Annotated[ObjectStorage, Depends(get_storage)]


@router.post("/documents/uploads", response_model=OwnerDocumentResponse)
def upload_library_document(
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    response: Response,
    title: Annotated[DocumentTitle, Form()],
    document_kind: Annotated[DocumentKind, Form()],
    file: Annotated[UploadFile, File()],
    linked_trip_id: Annotated[Identifier | None, Form()] = None,
) -> OwnerDocumentResponse:
    uploaded, created = service.upload_library_document(
        session,
        storage,
        subject,
        title=title,
        document_kind=document_kind,
        filename=file.filename,
        content_type=file.content_type,
        file=file.file,
        linked_trip_id=linked_trip_id,
    )
    session.commit()
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return uploaded


@router.get("/documents", response_model=list[OwnerDocumentResponse])
def list_library_documents(
    session: SessionDep, subject: SubjectDep, linked_trip_id: Identifier | None = None
) -> list[OwnerDocumentResponse]:
    return service.list_library_documents(session, subject, linked_trip_id)


@router.get("/documents/{document_id}", response_model=OwnerDocumentResponse)
def get_library_document(document_id: Identifier, session: SessionDep, subject: SubjectDep) -> OwnerDocumentResponse:
    return service.get_library_document(session, subject, document_id)


@router.patch("/documents/{document_id}", response_model=OwnerDocumentResponse)
def update_library_document(
    document_id: Identifier, payload: OwnerDocumentUpdate, session: SessionDep, subject: SubjectDep
) -> OwnerDocumentResponse:
    updated = service.update_library_document(session, subject, document_id, payload)
    session.commit()
    return updated


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_library_document(
    document_id: Identifier, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> Response:
    purge = service.remove_library_document(session, subject, document_id)
    session.commit()
    purge.finalise(session, storage)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/documents/{document_id}/original")
def get_library_document_original(
    document_id: Identifier, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> StreamingResponse:
    original = service.owned_library_document(session, subject, document_id).original_object
    return StreamingResponse(
        iter([storage.get(original.object_key)]),
        media_type=original.content_type,
        headers=private_original_headers(original.content_type),
    )


@router.get("/emergency-info", response_model=list[EmergencyInfoEntryResponse])
def list_emergency_info(session: SessionDep, subject: SubjectDep) -> list[EmergencyInfoEntry]:
    return service.list_emergency_info(session, subject)


@router.post("/emergency-info", response_model=EmergencyInfoEntryResponse, status_code=status.HTTP_201_CREATED)
def create_emergency_info(
    payload: EmergencyInfoEntryCreate, session: SessionDep, subject: SubjectDep
) -> EmergencyInfoEntry:
    entry = service.create_emergency_info(session, subject, payload)
    session.commit()
    return entry


@router.get("/emergency-info/{entry_id}", response_model=EmergencyInfoEntryResponse)
def get_emergency_info_entry(entry_id: Identifier, session: SessionDep, subject: SubjectDep) -> EmergencyInfoEntry:
    return service.get_emergency_info_entry(session, subject, entry_id)


@router.patch("/emergency-info/{entry_id}", response_model=EmergencyInfoEntryResponse)
def update_emergency_info(
    entry_id: Identifier, payload: EmergencyInfoEntryUpdate, session: SessionDep, subject: SubjectDep
) -> EmergencyInfoEntry:
    entry = service.update_emergency_info(session, subject, entry_id, payload)
    session.commit()
    return entry


@router.delete("/emergency-info/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_emergency_info(entry_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    service.delete_emergency_info(session, subject, entry_id)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
