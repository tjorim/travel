"""Copy-verify-record handling for private documents and redacted copies.

The service never derives a shareable document from an original. A client
uploads the already-redacted result and a JSON manifest describing that work;
both are copied into Travel-controlled storage and checksum verified before a
pending-review ``DocumentDerivative`` row is committed.
"""

import json
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..media.service import MediaImportError, store_uploaded_object
from ..models import DerivativeReviewState, DocumentAsset, DocumentDerivative, DocumentKind
from ..storage import ObjectStorage, sha256_hex


class DocumentError(MediaImportError):
    """A rejected document or redaction upload."""


def direct_upload(
    session: Session,
    storage: ObjectStorage,
    *,
    trip_id: str,
    filename: str,
    content_type: str,
    data: bytes,
    document_kind: DocumentKind,
    title: str,
) -> tuple[DocumentAsset, bool]:
    """Store an owner original and create one retry-safe asset record."""
    stored = store_uploaded_object(session, storage, trip_id=trip_id, data=data, content_type=content_type)
    existing = session.scalar(
        select(DocumentAsset).where(
            DocumentAsset.trip_id == trip_id, DocumentAsset.original_object_id == stored.id
        )
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


def create_redacted_derivative(
    session: Session,
    storage: ObjectStorage,
    *,
    document_asset: DocumentAsset,
    data: bytes,
    content_type: str,
    manifest_data: bytes,
    manifest_content_type: str,
) -> tuple[DocumentDerivative, bool]:
    """Record an independently authored redacted document for owner review.

    Hash comparison rejects an original re-upload even though storage dedup
    would otherwise resolve it to the same stored object. This is the durable
    boundary that prevents an original from masquerading as a derivative.
    """
    if document_asset.original_object.sha256 == sha256_hex(data):
        raise DocumentError("A document derivative must be a new redacted file, not the original")
    if manifest_content_type.split(";", 1)[0].strip().lower() != "application/json":
        raise DocumentError("The redaction manifest must have application/json content type")
    try:
        manifest = json.loads(manifest_data)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DocumentError("The redaction manifest must be valid JSON") from error
    if not isinstance(manifest, dict):
        raise DocumentError("The redaction manifest must be a JSON object")

    redacted = store_uploaded_object(session, storage, trip_id=document_asset.trip_id, data=data, content_type=content_type)
    redaction_manifest = store_uploaded_object(
        session,
        storage,
        trip_id=document_asset.trip_id,
        data=manifest_data,
        content_type="application/json",
    )
    if redacted.id == redaction_manifest.id:
        raise DocumentError("The redaction manifest must be a separate file")

    existing = session.scalar(
        select(DocumentDerivative).where(
            DocumentDerivative.document_asset_id == document_asset.id,
            DocumentDerivative.object_id == redacted.id,
            DocumentDerivative.redaction_manifest_object_id == redaction_manifest.id,
        )
    )
    if existing is not None:
        session.commit()
        return existing, False
    if session.scalar(select(DocumentDerivative.id).where(DocumentDerivative.object_id == redacted.id)) is not None:
        raise DocumentError("This redacted file is already attached to another document")
    if session.scalar(
        select(DocumentDerivative.id).where(DocumentDerivative.redaction_manifest_object_id == redaction_manifest.id)
    ) is not None:
        raise DocumentError("This redaction manifest is already attached to another derivative")

    derivative = DocumentDerivative(
        trip_id=document_asset.trip_id,
        document_asset_id=document_asset.id,
        object_id=redacted.id,
        redaction_manifest_object_id=redaction_manifest.id,
        review_state=DerivativeReviewState.PENDING,
    )
    session.add(derivative)
    session.commit()
    return derivative, True


def delete_document_asset(session: Session, *, document_asset: DocumentAsset) -> None:
    """Soft-delete an original and hide it and its derivatives immediately."""
    document_asset.deleted_at = datetime.now(UTC)
    session.commit()
