"""Owner-only trip documents."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..document.service import delete_document_asset, direct_upload
from ..errors import ApiException, service_exception
from ..media.ranges import private_original_headers
from ..media.service import MediaImportError, read_bounded_upload
from ..models import DocumentAsset, DocumentKind
from ..schemas import DocumentAssetResponse, Identifier, SafeText
from ..storage import ObjectStorage, get_storage
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}/documents", tags=["documents"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
StorageDep = Annotated[ObjectStorage, Depends(get_storage)]


def _asset_response(asset: DocumentAsset, trip_id: Identifier) -> DocumentAssetResponse:
    original = asset.original_object
    return DocumentAssetResponse(
        id=asset.id,
        document_kind=asset.document_kind,
        title=asset.title,
        byte_size=original.byte_size,
        content_type=original.content_type,
        original_filename=asset.owner_metadata.get("original_filename"),
        created_at=asset.created_at,
        deleted_at=asset.deleted_at,
        file_url=f"/api/trips/{trip_id}/documents/{asset.id}/original",
    )


def owned_document_asset(session: Session, trip_id: Identifier, subject: str, document_id: Identifier) -> DocumentAsset:
    owned_trip(session, trip_id, subject)
    asset = session.scalar(
        select(DocumentAsset).where(
            DocumentAsset.id == document_id,
            DocumentAsset.trip_id == trip_id,
            DocumentAsset.deleted_at.is_(None),
        )
    )
    if asset is None:
        raise ApiException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found", code="not_found")
    return asset


@router.post("/uploads", response_model=DocumentAssetResponse)
def upload_document(
    trip_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    response: Response,
    title: Annotated[SafeText, Form(min_length=1, max_length=160)],
    document_kind: Annotated[DocumentKind, Form()],
    file: Annotated[UploadFile, File()],
) -> DocumentAssetResponse:
    owned_trip(session, trip_id, subject)
    if not file.content_type:
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A content type is required",
            code="a_content_type_is_required",
        )
    try:
        with read_bounded_upload(file.file) as data:
            asset, created = direct_upload(
                session,
                storage,
                trip_id=trip_id,
                filename=file.filename or "upload",
                content_type=file.content_type,
                data=data,
                document_kind=document_kind,
                title=title,
            )
    except MediaImportError as error:  # includes DocumentError
        raise service_exception(status.HTTP_422_UNPROCESSABLE_CONTENT, error) from error
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return _asset_response(asset, trip_id)


@router.get("", response_model=list[DocumentAssetResponse])
def list_documents(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> list[DocumentAssetResponse]:
    owned_trip(session, trip_id, subject)
    assets = session.scalars(
        select(DocumentAsset)
        .where(DocumentAsset.trip_id == trip_id, DocumentAsset.deleted_at.is_(None))
        .order_by(DocumentAsset.created_at.desc())
    )
    return [_asset_response(asset, trip_id) for asset in assets]


@router.get("/{document_id}", response_model=DocumentAssetResponse)
def get_document(
    trip_id: Identifier, document_id: Identifier, session: SessionDep, subject: SubjectDep
) -> DocumentAssetResponse:
    return _asset_response(owned_document_asset(session, trip_id, subject, document_id), trip_id)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_document(
    trip_id: Identifier, document_id: Identifier, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> Response:
    delete_document_asset(session, storage, document_asset=owned_document_asset(session, trip_id, subject, document_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{document_id}/original")
def get_document_original(
    trip_id: Identifier, document_id: Identifier, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> StreamingResponse:
    original = owned_document_asset(session, trip_id, subject, document_id).original_object
    return StreamingResponse(
        iter([storage.get(original.object_key)]),
        media_type=original.content_type,
        headers=private_original_headers(original.content_type),
    )
