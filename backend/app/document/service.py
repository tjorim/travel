"""Copy-verify-record handling for private trip documents.

Nothing here commits (``docs/object-storage.md``): an upload writes and verifies the bytes, then flushes the
row, and the caller commits after, so the bytes exist before the row does (rule 1). A removal marks the
object ``purge_pending`` and returns a ``PendingPurge`` the caller finalises after its commit (rule 3).
"""

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import Refusal
from ..media.service import MediaImportError, PendingPurge, _object_is_referenced, store_uploaded_object
from ..models import DocumentAsset, DocumentKind, ObjectState, StoredObject
from ..schemas import DocumentTitle
from ..storage import ObjectStorage, StagedUpload


class DocumentError(MediaImportError):
    """A rejected document upload."""


def trip_documents(session: Session, trip_id: str, document_asset_ids: list[str]) -> list[DocumentAsset]:
    """Resolve documents to attach to one record of an already-authorized trip, in the order given.

    A client can only attach non-deleted documents owned by this trip; any other id refuses the whole list.
    Routes and stays share this check, so a document can never be linked across trips.
    """
    if not document_asset_ids:
        return []
    assets = list(
        session.scalars(
            select(DocumentAsset).where(
                DocumentAsset.trip_id == trip_id,
                DocumentAsset.id.in_(document_asset_ids),
                DocumentAsset.deleted_at.is_(None),
            )
        )
    )
    if len(assets) != len(document_asset_ids):
        raise Refusal(
            "One or more documents are unavailable for this trip",
            code="one_or_more_documents_are_unavailable_for_this_trip",
        )
    by_id = {asset.id: asset for asset in assets}
    return [by_id[asset_id] for asset_id in document_asset_ids]


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
    try:
        title = TypeAdapter(DocumentTitle).validate_python(title)
    except ValidationError as error:
        raise DocumentError("Invalid document title", code="invalid_document_title") from error
    stored = store_uploaded_object(session, storage, trip_id=trip_id, data=data, content_type=content_type)
    existing = session.scalar(
        select(DocumentAsset).where(DocumentAsset.trip_id == trip_id, DocumentAsset.original_object_id == stored.id)
    )
    if existing is not None:
        return existing, False

    asset = DocumentAsset(
        trip_id=trip_id,
        original_object_id=stored.id,
        document_kind=document_kind,
        title=title,
        owner_metadata={"original_filename": filename},
    )
    session.add(asset)
    session.flush()
    return asset, True


def delete_document_asset(session: Session, *, document_asset: DocumentAsset) -> PendingPurge:
    """Remove a trip document and mark its unreferenced stored original ``purge_pending``."""
    object_id = document_asset.original_object_id
    session.delete(document_asset)
    session.flush()
    if not _object_is_referenced(session, object_id):
        session.get_one(StoredObject, object_id).state = ObjectState.PURGE_PENDING
    session.flush()
    return PendingPurge(trip_objects=(object_id,))
