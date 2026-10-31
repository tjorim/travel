"""Copy-verify-record handling for private trip documents."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..media.service import MediaImportError, _object_is_referenced, _purge_pending_objects, store_uploaded_object
from ..models import DocumentAsset, DocumentKind, ObjectState, StoredObject
from ..storage import ObjectStorage, StagedUpload


class DocumentError(MediaImportError):
    """A rejected document upload."""


def direct_upload(
    session: Session,
    storage: ObjectStorage,
    *,
    trip_id: str,
    filename: str,
    content_type: str,
    data: bytes | StagedUpload,
    document_kind: DocumentKind,
    title: str,
) -> tuple[DocumentAsset, bool]:
    """Store an owner original and create one retry-safe asset record."""
    stored = store_uploaded_object(session, storage, trip_id=trip_id, data=data, content_type=content_type)
    existing = session.scalar(
        select(DocumentAsset).where(DocumentAsset.trip_id == trip_id, DocumentAsset.original_object_id == stored.id)
    )
    if existing is not None:
        session.commit()
        return existing, False

    asset = DocumentAsset(
        trip_id=trip_id,
        original_object_id=stored.id,
        document_kind=document_kind,
        title=title,
        owner_metadata={"original_filename": filename},
    )
    session.add(asset)
    session.commit()
    return asset, True


def delete_document_asset(session: Session, storage: ObjectStorage, *, document_asset: DocumentAsset) -> None:
    """Remove a trip document and purge its unreferenced stored original."""
    object_id = document_asset.original_object_id
    session.delete(document_asset)
    session.flush()
    if not _object_is_referenced(session, object_id):
        session.get_one(StoredObject, object_id).state = ObjectState.PURGE_PENDING
    session.commit()
    _purge_pending_objects(session, storage, object_ids=[object_id])
