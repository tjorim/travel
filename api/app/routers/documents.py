"""Owner-only document originals and explicitly redacted derivatives."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..document.service import DocumentError, create_redacted_derivative, delete_document_asset, direct_upload
from ..models import DerivativeReviewState, DocumentAsset, DocumentDerivative, DocumentKind
from ..schemas import DocumentAssetResponse, DocumentDerivativeResponse
from ..storage import ObjectStorage, get_storage
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}/documents", tags=["documents"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
StorageDep = Annotated[ObjectStorage, Depends(get_storage)]


def _asset_response(asset: DocumentAsset, trip_id: str) -> DocumentAssetResponse:
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


def _derivative_response(derivative: DocumentDerivative, trip_id: str) -> DocumentDerivativeResponse:
    redacted = derivative.object
    return DocumentDerivativeResponse(
        id=derivative.id,
        document_asset_id=derivative.document_asset_id,
        review_state=derivative.review_state,
        byte_size=redacted.byte_size,
        content_type=redacted.content_type,
        created_at=derivative.created_at,
        file_url=(
            f"/api/trips/{trip_id}/documents/{derivative.document_asset_id}/derivatives/{derivative.id}/file"
        ),
    )


def owned_document_asset(session: Session, trip_id: str, subject: str, document_id: str) -> DocumentAsset:
    owned_trip(session, trip_id, subject)
    asset = session.scalar(
        select(DocumentAsset).where(
            DocumentAsset.id == document_id,
            DocumentAsset.trip_id == trip_id,
            DocumentAsset.deleted_at.is_(None),
        )
    )
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return asset


def owned_derivative(
    session: Session, trip_id: str, subject: str, document_id: str, derivative_id: str
) -> DocumentDerivative:
    asset = owned_document_asset(session, trip_id, subject, document_id)
    derivative = session.scalar(
        select(DocumentDerivative).where(
            DocumentDerivative.id == derivative_id,
            DocumentDerivative.document_asset_id == asset.id,
        )
    )
    if derivative is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document derivative not found")
    return derivative


@router.post("/uploads", response_model=DocumentAssetResponse)
def upload_document(
    trip_id: str,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    response: Response,
    title: Annotated[str, Form(min_length=1, max_length=160)],
    document_kind: Annotated[DocumentKind, Form()],
    file: Annotated[UploadFile, File()],
) -> DocumentAssetResponse:
    owned_trip(session, trip_id, subject)
    if not file.content_type:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A content type is required")
    try:
        asset, created = direct_upload(
            session,
            storage,
            trip_id=trip_id,
            filename=file.filename or "upload",
            content_type=file.content_type,
            data=file.file.read(),
            document_kind=document_kind,
            title=title,
        )
    except DocumentError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return _asset_response(asset, trip_id)


@router.get("", response_model=list[DocumentAssetResponse])
def list_documents(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[DocumentAssetResponse]:
    owned_trip(session, trip_id, subject)
    assets = session.scalars(
        select(DocumentAsset)
        .where(DocumentAsset.trip_id == trip_id, DocumentAsset.deleted_at.is_(None))
        .order_by(DocumentAsset.created_at.desc())
    )
    return [_asset_response(asset, trip_id) for asset in assets]


@router.get("/{document_id}", response_model=DocumentAssetResponse)
def get_document(
    trip_id: str, document_id: str, session: SessionDep, subject: SubjectDep
) -> DocumentAssetResponse:
    return _asset_response(owned_document_asset(session, trip_id, subject, document_id), trip_id)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_document(trip_id: str, document_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    delete_document_asset(session, document_asset=owned_document_asset(session, trip_id, subject, document_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{document_id}/original")
def get_document_original(
    trip_id: str, document_id: str, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> StreamingResponse:
    original = owned_document_asset(session, trip_id, subject, document_id).original_object
    return StreamingResponse(
        iter([storage.get(original.object_key)]), media_type=original.content_type, headers={"Cache-Control": "no-store"}
    )


@router.post("/{document_id}/derivatives", response_model=DocumentDerivativeResponse)
def add_redacted_derivative(
    trip_id: str,
    document_id: str,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    response: Response,
    file: Annotated[UploadFile, File()],
    redaction_manifest: Annotated[UploadFile, File()],
) -> DocumentDerivativeResponse:
    asset = owned_document_asset(session, trip_id, subject, document_id)
    if not file.content_type or not redaction_manifest.content_type:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Both files need a content type")
    try:
        derivative, created = create_redacted_derivative(
            session,
            storage,
            document_asset=asset,
            data=file.file.read(),
            content_type=file.content_type,
            manifest_data=redaction_manifest.file.read(),
            manifest_content_type=redaction_manifest.content_type,
        )
    except DocumentError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return _derivative_response(derivative, trip_id)


@router.get("/{document_id}/derivatives", response_model=list[DocumentDerivativeResponse])
def list_derivatives(
    trip_id: str, document_id: str, session: SessionDep, subject: SubjectDep
) -> list[DocumentDerivativeResponse]:
    return [_derivative_response(item, trip_id) for item in owned_document_asset(session, trip_id, subject, document_id).derivatives]


@router.post("/{document_id}/derivatives/{derivative_id}/approve", response_model=DocumentDerivativeResponse)
def approve_derivative(
    trip_id: str, document_id: str, derivative_id: str, session: SessionDep, subject: SubjectDep
) -> DocumentDerivativeResponse:
    derivative = owned_derivative(session, trip_id, subject, document_id, derivative_id)
    derivative.review_state = DerivativeReviewState.APPROVED
    session.commit()
    return _derivative_response(derivative, trip_id)


@router.get("/{document_id}/derivatives/{derivative_id}/file")
def get_derivative_file(
    trip_id: str, document_id: str, derivative_id: str, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> StreamingResponse:
    derivative = owned_derivative(session, trip_id, subject, document_id, derivative_id)
    redacted = derivative.object
    return StreamingResponse(
        iter([storage.get(redacted.object_key)]), media_type=redacted.content_type, headers={"Cache-Control": "no-store"}
    )
