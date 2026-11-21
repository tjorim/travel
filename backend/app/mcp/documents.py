"""Documents and emergency information."""

from __future__ import annotations

from typing import Any

from app import schemas
from app.mcp.core import BinaryUpload, McpTools, storage
from app.mcp.rendering import _model, _models
from app.models import DocumentKind
from app.services import emergency_info as emergency_service
from app.services.documents import service as document_service


class DocumentTools(McpTools):
    """Documents and emergency information."""

    def upload_document(
        self,
        title: str,
        document_kind: DocumentKind,
        file: BinaryUpload,
        trip_id: str | None = None,
    ) -> dict[str, Any]:
        """Upload an owner-only document via the application storage pipeline. Give trip_id to file it under a trip (needed to attach it to that trip's stays and routes); omit it for a reusable document such as an insurance policy."""
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
                    title=title,
                    document_kind=document_kind,
                    filename=upload.filename,
                    content_type=upload.content_type,
                    file=upload.file,
                    trip_id=trip_id,
                )[0]
            ),
            lambda x: _model(x, schemas.DocumentResponse),
        )

    def list_documents(self, trip_id: str | None = None, unfiled: bool = False) -> list[dict[str, Any]]:
        """List the owner's documents: all of them, those filed under one trip (trip_id), or only the unfiled ones (unfiled=true)."""
        return self._call(
            "document.list",
            "document_asset",
            None,
            trip_id,
            lambda s, sub: document_service.list_documents(s, sub, trip_id, unfiled=unfiled),
            lambda x: _models(x, schemas.DocumentResponse),
        )

    def get_document(self, document_id: str, trip_id: str | None = None) -> dict[str, Any]:
        """Read metadata and the owner-authorized delivery URL for one document (with trip_id, only if it is filed under that trip)."""
        return self._call(
            "document.get",
            "document_asset",
            document_id,
            trip_id,
            lambda s, sub: document_service.get_document(s, sub, document_id, trip_id),
            lambda x: _model(x, schemas.DocumentResponse),
        )

    def update_document(self, document_id: str, payload: schemas.DocumentUpdate) -> dict[str, Any]:
        """Update a document's title, kind or trip. trip_id files it under a trip, null unfiles it; a document attached to stays or routes must be detached first."""
        return self._call(
            "document.update",
            "document_asset",
            document_id,
            None,
            lambda s, sub: document_service.update_document(s, sub, document_id, payload),
            lambda x: _model(x, schemas.DocumentResponse),
        )

    def delete_document(self, document_id: str, confirm: bool = False, trip_id: str | None = None) -> dict[str, str]:
        """Permanently delete a document and its stored file after explicit confirmation."""
        return self._call(
            "document.delete",
            "document_asset",
            document_id,
            trip_id,
            lambda s, sub: document_service.remove_document(s, sub, document_id, trip_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
            after_commit=lambda purge, s: purge.finalise(s, storage()),
        )

    def list_emergency_info(self) -> list[dict[str, Any]]:
        """List owner-only emergency information (noodnummers): emergency numbers, contacts and medical notes."""
        return self._call(
            "emergency_info.list",
            "emergency_info",
            None,
            None,
            lambda s, sub: emergency_service.list_emergency_info(s, sub),
            lambda x: _models(x, schemas.EmergencyInfoEntryResponse),
        )

    def create_emergency_info(self, payload: schemas.EmergencyInfoEntryCreate) -> dict[str, Any]:
        """Create a private emergency-information entry. notes is Markdown."""
        return self._call(
            "emergency_info.create",
            "emergency_info",
            None,
            None,
            lambda s, sub: emergency_service.create_emergency_info(s, sub, payload),
            lambda x: _model(x, schemas.EmergencyInfoEntryResponse),
        )

    def update_emergency_info(self, entry_id: str, payload: schemas.EmergencyInfoEntryUpdate) -> dict[str, Any]:
        """Update a private emergency-information entry. notes is Markdown."""
        return self._call(
            "emergency_info.update",
            "emergency_info",
            entry_id,
            None,
            lambda s, sub: emergency_service.update_emergency_info(s, sub, entry_id, payload),
            lambda x: _model(x, schemas.EmergencyInfoEntryResponse),
        )

    def delete_emergency_info(self, entry_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete an emergency-information entry after explicit confirmation."""
        return self._call(
            "emergency_info.delete",
            "emergency_info",
            entry_id,
            None,
            lambda s, sub: emergency_service.delete_emergency_info(s, sub, entry_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def get_emergency_info_entry(self, entry_id: str) -> dict[str, Any]:
        """Read one owner-only emergency-information entry."""
        return self._call(
            "emergency_info.get",
            "emergency_info",
            entry_id,
            None,
            lambda s, sub: emergency_service.get_emergency_info_entry(s, sub, entry_id),
            lambda x: _model(x, schemas.EmergencyInfoEntryResponse),
        )
