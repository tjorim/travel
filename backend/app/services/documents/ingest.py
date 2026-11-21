"""Copy-verify-record handling for owner documents.

A document belongs to the owner and is optionally filed under one trip; its original is a ``StoredObject`` owned by
the owner, so the file stays where it is when the document moves between trips.

Nothing here commits (``docs/object-storage.md``): an upload writes and verifies the bytes, then flushes the
row, and the caller commits after, so the bytes exist before the row does (rule 1). A removal marks the
object ``purge_pending`` and returns a ``PendingPurge`` the caller finalises after its commit (rule 3).
"""

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import Refusal
from app.models import DocumentAsset, DocumentKind, ObjectState, StoredObject
from app.schemas import DocumentTitle
from app.services.media.ingest import (
    MediaImportError,
    PendingPurge,
    _object_is_referenced,
    store_uploaded_object,
)
from app.services.storage import ObjectStorage, StagedUpload


class DocumentError(MediaImportError):
    """A rejected document upload."""


def trip_documents(session: Session, trip_id: str, document_asset_ids: list[str]) -> list[DocumentAsset]:
    """Resolve documents to attach to one record of an already-authorized trip, in the order given.

    A client can only attach documents filed under this trip; any other id refuses the whole list. Routes and
    stays share this check, so a document can never be attached across trips, nor while it is unfiled.
    """
    if not document_asset_ids:
        return []
    # A shared lock until the caller commits: moving or unfiling the same document (``update_document``) takes
    # ``FOR NO KEY UPDATE``, so it waits for this attachment to be written, then sees the link and refuses. That mode
    # does not conflict with the ``FOR KEY SHARE`` of the link's own foreign-key check or with the trip delete's
    # update of the filing, so none of them can deadlock with it.
    assets = list(
        session.scalars(
            select(DocumentAsset)
            .where(DocumentAsset.trip_id == trip_id, DocumentAsset.id.in_(document_asset_ids))
            .with_for_update(read=True)
        )
    )
    if len(assets) != len(document_asset_ids):
        raise Refusal(
            "One or more documents are unavailable for this trip",
            code="one_or_more_documents_are_unavailable_for_this_trip",
        )
    by_id = {asset.id: asset for asset in assets}
    return [by_id[asset_id] for asset_id in document_asset_ids]


def existing_document(
    session: Session, *, original_object_id: str, trip_id: str | None, excluding: str | None = None
) -> DocumentAsset | None:
    """The oldest document that already holds this file under this trip (or unfiled), if any."""
    query = select(DocumentAsset).where(DocumentAsset.original_object_id == original_object_id)
    query = query.where(DocumentAsset.trip_id.is_(None) if trip_id is None else DocumentAsset.trip_id == trip_id)
    if excluding is not None:
        query = query.where(DocumentAsset.id != excluding)
    return session.scalar(query.order_by(DocumentAsset.created_at, DocumentAsset.id).limit(1))


def direct_upload(
    session: Session,
    storage: ObjectStorage,
    *,
    owner_subject: str,
    trip_id: str | None,
    filename: str,
    content_type: str,
    data: bytes | StagedUpload,
    document_kind: DocumentKind,
    title: str,
) -> tuple[DocumentAsset, bool]:
    """Store an owner original and create one retry-safe document record under the trip (or unfiled)."""
    try:
        title = TypeAdapter(DocumentTitle).validate_python(title)
    except ValidationError as error:
        raise DocumentError("Invalid document title", code="invalid_document_title") from error
    stored = store_uploaded_object(session, storage, owner_subject=owner_subject, data=data, content_type=content_type)
    existing = existing_document(session, original_object_id=stored.id, trip_id=trip_id)
    if existing is not None:
        return existing, False

    asset = DocumentAsset(
        owner_subject=owner_subject,
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
    """Remove a document and mark its stored original ``purge_pending`` when no other document or media uses it."""
    object_id = document_asset.original_object_id
    session.delete(document_asset)
    session.flush()
    if not _object_is_referenced(session, object_id):
        session.get_one(StoredObject, object_id).state = ObjectState.PURGE_PENDING
    session.flush()
    return PendingPurge(objects=(object_id,))
