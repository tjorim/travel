"""Owner-only trip documents."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..media.ranges import private_original_headers
from ..models import DocumentKind
from ..schemas import DocumentAssetResponse, DocumentTitle, Identifier
from ..services import documents as service
from ..storage import ObjectStorage, get_storage

router = APIRouter(prefix="/trips/{trip_id}/documents", tags=["documents"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
StorageDep = Annotated[ObjectStorage, Depends(get_storage)]


@router.post("/uploads", response_model=DocumentAssetResponse)
def upload_document(
    trip_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    response: Response,
    title: Annotated[DocumentTitle, Form()],
    document_kind: Annotated[DocumentKind, Form()],
    file: Annotated[UploadFile, File()],
) -> DocumentAssetResponse:
    uploaded, created = service.upload_document(
        session,
        storage,
        subject,
        trip_id,
        title=title,
        document_kind=document_kind,
        filename=file.filename,
        content_type=file.content_type,
        file=file.file,
    )
    session.commit()
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return uploaded


@router.get("", response_model=list[DocumentAssetResponse])
def list_documents(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> list[DocumentAssetResponse]:
    return service.list_documents(session, subject, trip_id)


@router.get("/{document_id}", response_model=DocumentAssetResponse)
def get_document(
    trip_id: Identifier, document_id: Identifier, session: SessionDep, subject: SubjectDep
) -> DocumentAssetResponse:
    return service.get_document(session, subject, trip_id, document_id)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_document(
    trip_id: Identifier, document_id: Identifier, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> Response:
    purge = service.remove_document(session, subject, trip_id, document_id)
    session.commit()
    purge.finalise(session, storage)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{document_id}/original")
def get_document_original(
    trip_id: Identifier, document_id: Identifier, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> StreamingResponse:
    original = service.owned_document_asset(session, subject, trip_id, document_id).original_object
    return StreamingResponse(
        iter([storage.get(original.object_key)]),
        media_type=original.content_type,
        headers=private_original_headers(original.content_type),
    )
