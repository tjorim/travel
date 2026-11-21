"""Owner-only documents: one resource, optionally filed under a trip.

``/documents`` is the API. ``/trips/{trip_id}/documents`` and ``/library/documents`` are the two former homes,
kept as thin deprecated aliases for one release (the PWA's pinned offline copies and open tabs still name them):
each only fixes the trip and calls the same service function, so there is one implementation.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.auth import current_subject
from app.db.session import get_session

from ..media.ranges import private_original_headers
from ..models import DocumentKind
from ..schemas import DocumentResponse, DocumentTitle, DocumentUpdate, Identifier, LibraryDocumentUpdate
from ..services import documents as service
from ..storage import ObjectStorage, get_storage

router = APIRouter(prefix="/documents", tags=["documents"])
trip_router = APIRouter(prefix="/trips/{trip_id}/documents", tags=["documents"], deprecated=True)
library_router = APIRouter(prefix="/library/documents", tags=["documents"], deprecated=True)

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
StorageDep = Annotated[ObjectStorage, Depends(get_storage)]


def _upload(
    session: Session,
    storage: ObjectStorage,
    subject: str,
    response: Response,
    *,
    title: str,
    document_kind: DocumentKind,
    file: UploadFile,
    trip_id: Identifier | None,
) -> DocumentResponse:
    uploaded, created = service.upload_document(
        session,
        storage,
        subject,
        title=title,
        document_kind=document_kind,
        filename=file.filename,
        content_type=file.content_type,
        file=file.file,
        trip_id=trip_id,
    )
    session.commit()
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return uploaded


def _remove(
    session: Session, storage: ObjectStorage, subject: str, document_id: Identifier, trip_id: Identifier | None
) -> Response:
    purge = service.remove_document(session, subject, document_id, trip_id)
    session.commit()
    purge.finalise(session, storage)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _original(
    session: Session, storage: ObjectStorage, subject: str, document_id: Identifier, trip_id: Identifier | None
) -> StreamingResponse:
    original = service.owned_document_asset(session, subject, document_id, trip_id).original_object
    return StreamingResponse(
        iter([storage.get(original.object_key)]),
        media_type=original.content_type,
        headers=private_original_headers(original.content_type),
    )


@router.post("/uploads", response_model=DocumentResponse)
def upload_document(
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    response: Response,
    title: Annotated[DocumentTitle, Form()],
    document_kind: Annotated[DocumentKind, Form()],
    file: Annotated[UploadFile, File()],
    trip_id: Annotated[Identifier | None, Form()] = None,
) -> DocumentResponse:
    return _upload(
        session, storage, subject, response, title=title, document_kind=document_kind, file=file, trip_id=trip_id
    )


@router.get("", response_model=list[DocumentResponse])
def list_documents(
    session: SessionDep, subject: SubjectDep, trip_id: Identifier | None = None, unfiled: bool = False
) -> list[DocumentResponse]:
    return service.list_documents(session, subject, trip_id, unfiled=unfiled)


@router.get("/{document_id}", response_model=DocumentResponse)
def get_document(document_id: Identifier, session: SessionDep, subject: SubjectDep) -> DocumentResponse:
    return service.get_document(session, subject, document_id)


@router.patch("/{document_id}", response_model=DocumentResponse)
def update_document(
    document_id: Identifier, payload: DocumentUpdate, session: SessionDep, subject: SubjectDep
) -> DocumentResponse:
    updated = service.update_document(session, subject, document_id, payload)
    session.commit()
    return updated


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_document(document_id: Identifier, session: SessionDep, subject: SubjectDep, storage: StorageDep) -> Response:
    return _remove(session, storage, subject, document_id, None)


@router.get("/{document_id}/original")
def get_document_original(
    document_id: Identifier, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> StreamingResponse:
    return _original(session, storage, subject, document_id, None)


# --- Deprecated: the trip's documents ---------------------------------------------------


@trip_router.post("/uploads", response_model=DocumentResponse)
def upload_trip_document(
    trip_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    response: Response,
    title: Annotated[DocumentTitle, Form()],
    document_kind: Annotated[DocumentKind, Form()],
    file: Annotated[UploadFile, File()],
) -> DocumentResponse:
    return _upload(
        session, storage, subject, response, title=title, document_kind=document_kind, file=file, trip_id=trip_id
    )


@trip_router.get("", response_model=list[DocumentResponse])
def list_trip_documents(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> list[DocumentResponse]:
    return service.list_documents(session, subject, trip_id)


@trip_router.get("/{document_id}", response_model=DocumentResponse)
def get_trip_document(
    trip_id: Identifier, document_id: Identifier, session: SessionDep, subject: SubjectDep
) -> DocumentResponse:
    return service.get_document(session, subject, document_id, trip_id)


@trip_router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_trip_document(
    trip_id: Identifier, document_id: Identifier, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> Response:
    return _remove(session, storage, subject, document_id, trip_id)


@trip_router.get("/{document_id}/original")
def get_trip_document_original(
    trip_id: Identifier, document_id: Identifier, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> StreamingResponse:
    return _original(session, storage, subject, document_id, trip_id)


# --- Deprecated: the owner library (a document is "linked" to a trip when it is filed under it) ---------


@library_router.post("/uploads", response_model=DocumentResponse)
def upload_library_document(
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    response: Response,
    title: Annotated[DocumentTitle, Form()],
    document_kind: Annotated[DocumentKind, Form()],
    file: Annotated[UploadFile, File()],
    linked_trip_id: Annotated[Identifier | None, Form()] = None,
) -> DocumentResponse:
    return _upload(
        session,
        storage,
        subject,
        response,
        title=title,
        document_kind=document_kind,
        file=file,
        trip_id=linked_trip_id,
    )


@library_router.get("", response_model=list[DocumentResponse])
def list_library_documents(
    session: SessionDep, subject: SubjectDep, linked_trip_id: Identifier | None = None
) -> list[DocumentResponse]:
    return service.list_documents(session, subject, linked_trip_id)


@library_router.get("/{document_id}", response_model=DocumentResponse)
def get_library_document(document_id: Identifier, session: SessionDep, subject: SubjectDep) -> DocumentResponse:
    return service.get_document(session, subject, document_id)


@library_router.patch("/{document_id}", response_model=DocumentResponse)
def update_library_document(
    document_id: Identifier, payload: LibraryDocumentUpdate, session: SessionDep, subject: SubjectDep
) -> DocumentResponse:
    updated = service.update_document(session, subject, document_id, payload.as_document_update())
    session.commit()
    return updated


@library_router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_library_document(
    document_id: Identifier, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> Response:
    return _remove(session, storage, subject, document_id, None)


@library_router.get("/{document_id}/original")
def get_library_document_original(
    document_id: Identifier, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> StreamingResponse:
    return _original(session, storage, subject, document_id, None)
