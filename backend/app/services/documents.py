"""Owner documents: private files, optionally filed under a trip.

A document belongs to the owner. Filed under a trip (``trip_id``), it can be attached to that trip's stays and
routes; unfiled it is a reusable essential such as an insurance policy. Deleting a trip unfiles its documents.
Documents are never part of a published view.

Like every service this never commits. Uploading and removing a stored original follow the object-storage
lifecycle (``docs/object-storage.md``): an upload writes the bytes before the caller commits the row, and a removal
marks the object ``purge_pending`` and returns a ``PendingPurge`` that the caller finalises after its commit, because
bytes may be deleted only for a row already committed as ``purge_pending``.
"""

from typing import BinaryIO

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..document.service import DocumentError, delete_document_asset, direct_upload, existing_document
from ..errors import RecordNotFound, Refusal, service_error
from ..media.service import MediaImportError, PendingPurge, read_bounded_upload
from ..models import DocumentAsset, DocumentKind, RouteDocumentAsset, StayDocumentAsset
from ..schemas import DocumentResponse, DocumentUpdate, Identifier
from ..storage import ObjectStorage
from .trips import owned_trip


def document_response(asset: DocumentAsset) -> DocumentResponse:
    original = asset.original_object
    return DocumentResponse(
        id=asset.id,
        document_kind=asset.document_kind,
        title=asset.title,
        byte_size=original.byte_size,
        content_type=original.content_type,
        original_filename=asset.owner_metadata.get("original_filename"),
        trip_id=asset.trip_id,
        created_at=asset.created_at,
        file_url=f"/api/documents/{asset.id}/original",
    )


def owned_document_asset(
    session: Session, subject: str, document_id: Identifier, trip_id: Identifier | None = None
) -> DocumentAsset:
    """The owner's document; with ``trip_id`` (the trip-scoped routes) it must also be filed under that trip."""
    if trip_id is not None:
        owned_trip(session, trip_id, subject)
    asset = session.scalar(
        select(DocumentAsset).where(DocumentAsset.id == document_id, DocumentAsset.owner_subject == subject)
    )
    if asset is None or (trip_id is not None and asset.trip_id != trip_id):
        raise RecordNotFound("Document not found")
    return asset


def upload_document(
    session: Session,
    storage: ObjectStorage,
    subject: str,
    *,
    title: str,
    document_kind: DocumentKind,
    filename: str | None,
    content_type: str | None,
    file: BinaryIO,
    trip_id: Identifier | None = None,
) -> tuple[DocumentResponse, bool]:
    """Store a document original, filed under ``trip_id`` when given; the caller commits after.

    The flag says whether the document is new: the same bytes are stored once per owner, and a retry returns the
    document that already holds them under that trip."""
    if trip_id is not None:
        owned_trip(session, trip_id, subject)
    if not content_type:
        raise Refusal("A content type is required", code="a_content_type_is_required")
    try:
        with read_bounded_upload(file, DocumentError) as data:
            asset, created = direct_upload(
                session,
                storage,
                owner_subject=subject,
                trip_id=trip_id,
                filename=filename or "upload",
                content_type=content_type,
                data=data,
                document_kind=document_kind,
                title=title,
            )
    except MediaImportError as error:  # includes DocumentError
        raise service_error(error) from error
    return document_response(asset), created


def list_documents(
    session: Session, subject: str, trip_id: Identifier | None = None, *, unfiled: bool = False
) -> list[DocumentResponse]:
    """The owner's documents, newest first: all, those filed under one trip, or only the unfiled ones."""
    if trip_id is not None and unfiled:
        raise Refusal("Choose a trip or unfiled documents, not both", code="choose_a_trip_or_unfiled_documents")
    query = select(DocumentAsset).where(DocumentAsset.owner_subject == subject)
    if trip_id is not None:
        owned_trip(session, trip_id, subject)
        query = query.where(DocumentAsset.trip_id == trip_id)
    elif unfiled:
        query = query.where(DocumentAsset.trip_id.is_(None))
    return [
        document_response(asset)
        for asset in session.scalars(query.order_by(DocumentAsset.created_at.desc(), DocumentAsset.id))
    ]


def get_document(
    session: Session, subject: str, document_id: Identifier, trip_id: Identifier | None = None
) -> DocumentResponse:
    return document_response(owned_document_asset(session, subject, document_id, trip_id))


def update_document(
    session: Session, subject: str, document_id: Identifier, payload: DocumentUpdate
) -> DocumentResponse:
    """Edit a document's title, kind or trip (``trip_id`` null unfiles it).

    Moving a document away from its trip would leave it attached to records of a trip it no longer belongs to, so
    it is refused until the owner detaches it from those stays and routes."""
    asset = owned_document_asset(session, subject, document_id)
    updates = payload.model_dump(exclude_unset=True)
    if "trip_id" in updates and updates["trip_id"] != asset.trip_id:
        target = updates["trip_id"]
        if target is not None:
            owned_trip(session, target, subject)
        if session.scalar(
            select(StayDocumentAsset.stay_id).where(StayDocumentAsset.document_asset_id == asset.id).limit(1)
        ) or session.scalar(
            select(RouteDocumentAsset.route_id).where(RouteDocumentAsset.document_asset_id == asset.id).limit(1)
        ):
            raise Refusal(
                "Detach the document from stays and routes before filing it under another trip",
                code="detach_the_document_from_stays_and_routes_before_moving_it",
            )
        if existing_document(session, original_object_id=asset.original_object_id, trip_id=target, excluding=asset.id):
            raise Refusal("That trip already holds a document with this file", code="that_trip_already_holds_this_file")
    for field, value in updates.items():
        setattr(asset, field, value)
    session.flush()
    session.refresh(asset)
    return document_response(asset)


def remove_document(
    session: Session, subject: str, document_id: Identifier, trip_id: Identifier | None = None
) -> PendingPurge:
    """Remove a document; the caller commits, then finalises the returned purge with its storage."""
    return delete_document_asset(session, document_asset=owned_document_asset(session, subject, document_id, trip_id))
