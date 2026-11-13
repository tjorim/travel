"""Trip documents: owner-only files kept with a trip.

Uploading and removing a stored original follow the object-storage lifecycle (``docs/object-storage.md``: write
before the row commits, delete only after ``purge_pending`` commits), so those two operations commit inside
``app.document.service``. Every other operation here leaves the commit to the caller.
"""

from typing import BinaryIO

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..document.service import delete_document_asset, direct_upload
from ..errors import RecordNotFound, Refusal, service_error
from ..media.service import MediaImportError, read_bounded_upload
from ..models import DocumentAsset, DocumentKind
from ..schemas import DocumentAssetResponse, Identifier
from ..storage import ObjectStorage
from .trips import owned_trip


def document_response(asset: DocumentAsset, trip_id: Identifier) -> DocumentAssetResponse:
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


def owned_document_asset(session: Session, subject: str, trip_id: Identifier, document_id: Identifier) -> DocumentAsset:
    owned_trip(session, trip_id, subject)
    asset = session.scalar(
        select(DocumentAsset).where(
            DocumentAsset.id == document_id,
            DocumentAsset.trip_id == trip_id,
            DocumentAsset.deleted_at.is_(None),
        )
    )
    if asset is None:
        raise RecordNotFound("Document not found")
    return asset


def upload_document(
    session: Session,
    storage: ObjectStorage,
    subject: str,
    trip_id: Identifier,
    *,
    title: str,
    document_kind: DocumentKind,
    filename: str | None,
    content_type: str | None,
    file: BinaryIO,
) -> tuple[DocumentAssetResponse, bool]:
    """Store a document original; the flag says whether the document is new (the same bytes are stored once)."""
    owned_trip(session, trip_id, subject)
    if not content_type:
        raise Refusal("A content type is required", code="a_content_type_is_required")
    try:
        with read_bounded_upload(file) as data:
            asset, created = direct_upload(
                session,
                storage,
                trip_id=trip_id,
                filename=filename or "upload",
                content_type=content_type,
                data=data,
                document_kind=document_kind,
                title=title,
            )
    except MediaImportError as error:  # includes DocumentError
        raise service_error(error) from error
    return document_response(asset, trip_id), created


def list_documents(session: Session, subject: str, trip_id: Identifier) -> list[DocumentAssetResponse]:
    owned_trip(session, trip_id, subject)
    assets = session.scalars(
        select(DocumentAsset)
        .where(DocumentAsset.trip_id == trip_id, DocumentAsset.deleted_at.is_(None))
        .order_by(DocumentAsset.created_at.desc())
    )
    return [document_response(asset, trip_id) for asset in assets]


def get_document(session: Session, subject: str, trip_id: Identifier, document_id: Identifier) -> DocumentAssetResponse:
    return document_response(owned_document_asset(session, subject, trip_id, document_id), trip_id)


def remove_document(
    session: Session, storage: ObjectStorage, subject: str, trip_id: Identifier, document_id: Identifier
) -> None:
    delete_document_asset(session, storage, document_asset=owned_document_asset(session, subject, trip_id, document_id))
