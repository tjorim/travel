"""Trip documents, the owner library and emergency information."""

from __future__ import annotations

from typing import Any

from .. import schemas
from ..models import DocumentKind
from ..services import documents as document_service
from ..services import library as library_service
from .core import BinaryUpload, McpTools, storage
from .rendering import _model, _models


class DocumentTools(McpTools):
    """Trip documents, the owner library and emergency information."""

    def upload_document(
        self, trip_id: str, title: str, document_kind: DocumentKind, file: BinaryUpload
    ) -> dict[str, Any]:
        """Upload an owner-only trip document via the application storage pipeline."""
        return self._call(
            "document.upload",
            "document_asset",
            None,
            trip_id,
            lambda s, sub: file.apply(
                lambda upload: document_service.upload_document(
                    s,
                    storage(),
                    sub,
                    trip_id,
                    title=title,
                    document_kind=document_kind,
                    filename=upload.filename,
                    content_type=upload.content_type,
                    file=upload.file,
                )[0]
            ),
            lambda x: _model(x, schemas.DocumentAssetResponse),
        )

    def list_documents(self, trip_id: str) -> list[dict[str, Any]]:
        """List owner-only documents for a trip."""
        return self._call(
            "document.list",
            "document_asset",
            None,
            trip_id,
            lambda s, sub: document_service.list_documents(s, sub, trip_id),
            lambda x: _models(x, schemas.DocumentAssetResponse),
        )

    def delete_document(self, trip_id: str, document_id: str, confirm: bool = False) -> dict[str, str]:
        """Soft-delete a trip document after explicit confirmation."""
        return self._call(
            "document.delete",
            "document_asset",
            document_id,
            trip_id,
            lambda s, sub: document_service.remove_document(s, sub, trip_id, document_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
            after_commit=lambda purge, s: purge.finalise(s, storage()),
        )

    def list_library_documents(self, linked_trip_id: str | None = None) -> list[dict[str, Any]]:
        """List the owner's reusable private document library."""
        return self._call(
            "library_document.list",
            "library_document",
            None,
            linked_trip_id,
            lambda s, sub: library_service.list_library_documents(s, sub, linked_trip_id),
            lambda x: _models(x, schemas.OwnerDocumentResponse),
        )

    def list_emergency_info(self) -> list[dict[str, Any]]:
        """List owner-only emergency information (noodnummers): emergency numbers, contacts and medical notes."""
        return self._call(
            "emergency_info.list",
            "emergency_info",
            None,
            None,
            lambda s, sub: library_service.list_emergency_info(s, sub),
            lambda x: _models(x, schemas.EmergencyInfoEntryResponse),
        )

    def create_emergency_info(self, payload: schemas.EmergencyInfoEntryCreate) -> dict[str, Any]:
        """Create a private emergency-information entry. notes is Markdown."""
        return self._call(
            "emergency_info.create",
            "emergency_info",
            None,
            None,
            lambda s, sub: library_service.create_emergency_info(s, sub, payload),
            lambda x: _model(x, schemas.EmergencyInfoEntryResponse),
        )

    def upload_library_document(
        self, title: str, document_kind: DocumentKind, file: BinaryUpload, linked_trip_id: str | None = None
    ) -> dict[str, Any]:
        """Upload a reusable owner-private library document."""
        return self._call(
            "library_document.upload",
            "library_document",
            None,
            linked_trip_id,
            lambda s, sub: file.apply(
                lambda upload: library_service.upload_library_document(
                    s,
                    storage(),
                    sub,
                    title=title,
                    document_kind=document_kind,
                    filename=upload.filename,
                    content_type=upload.content_type,
                    file=upload.file,
                    linked_trip_id=linked_trip_id,
                )[0]
            ),
            lambda x: _model(x, schemas.OwnerDocumentResponse),
        )

    def update_library_document(self, document_id: str, payload: schemas.OwnerDocumentUpdate) -> dict[str, Any]:
        """Update a reusable private document's metadata."""
        return self._call(
            "library_document.update",
            "library_document",
            document_id,
            None,
            lambda s, sub: library_service.update_library_document(s, sub, document_id, payload),
            lambda x: _model(x, schemas.OwnerDocumentResponse),
        )

    def delete_library_document(self, document_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete a library document after explicit confirmation."""
        return self._call(
            "library_document.delete",
            "library_document",
            document_id,
            None,
            lambda s, sub: library_service.remove_library_document(s, sub, document_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
            after_commit=lambda purge, s: purge.finalise(s, storage()),
        )

    def update_emergency_info(self, entry_id: str, payload: schemas.EmergencyInfoEntryUpdate) -> dict[str, Any]:
        """Update a private emergency-information entry. notes is Markdown."""
        return self._call(
            "emergency_info.update",
            "emergency_info",
            entry_id,
            None,
            lambda s, sub: library_service.update_emergency_info(s, sub, entry_id, payload),
            lambda x: _model(x, schemas.EmergencyInfoEntryResponse),
        )

    def delete_emergency_info(self, entry_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete an emergency-information entry after explicit confirmation."""
        return self._call(
            "emergency_info.delete",
            "emergency_info",
            entry_id,
            None,
            lambda s, sub: library_service.delete_emergency_info(s, sub, entry_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def get_document(self, trip_id: str, document_id: str) -> dict[str, Any]:
        """Read metadata and the owner-authorized delivery URL for one trip document."""
        return self._call(
            "document.get",
            "document_asset",
            document_id,
            trip_id,
            lambda s, sub: document_service.get_document(s, sub, trip_id, document_id),
            lambda x: _model(x, schemas.DocumentAssetResponse),
        )

    def get_library_document(self, document_id: str) -> dict[str, Any]:
        """Read metadata and the owner-authorized delivery URL for one library document."""
        return self._call(
            "library_document.get",
            "library_document",
            document_id,
            None,
            lambda s, sub: library_service.get_library_document(s, sub, document_id),
            lambda x: _model(x, schemas.OwnerDocumentResponse),
        )

    def get_emergency_info_entry(self, entry_id: str) -> dict[str, Any]:
        """Read one owner-only emergency-information entry."""
        return self._call(
            "emergency_info.get",
            "emergency_info",
            entry_id,
            None,
            lambda s, sub: library_service.get_emergency_info_entry(s, sub, entry_id),
            lambda x: _model(x, schemas.EmergencyInfoEntryResponse),
        )
