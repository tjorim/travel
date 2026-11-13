"""Media and its derivatives, and imports from a provider."""

from __future__ import annotations

from typing import Any

from .. import schemas
from ..models import ImportProvider
from ..secrets import get_secret_store
from ..services import media as media_service
from .core import BinaryUpload, McpTools, storage
from .rendering import _model, _models


class MediaTools(McpTools):
    """Media and its derivatives, and imports from a provider."""

    def upload_media(self, trip_id: str, file: BinaryUpload) -> dict[str, Any]:
        """Import an owner-selected local media file through the validated storage pipeline."""
        return self._call(
            "media.upload",
            "media_asset",
            None,
            trip_id,
            lambda s, sub: file.apply(
                lambda upload: media_service.upload_media(
                    s,
                    storage(),
                    sub,
                    trip_id,
                    filename=upload.filename,
                    content_type=upload.content_type,
                    file=upload.file,
                )[0]
            ),
            lambda x: _model(x, schemas.MediaAssetResponse),
        )

    def list_media(self, trip_id: str) -> list[dict[str, Any]]:
        """List owner-only media assets."""
        return self._call(
            "media.list",
            "media_asset",
            None,
            trip_id,
            lambda s, sub: media_service.list_media(s, sub, trip_id),
            lambda x: _models(x, schemas.MediaAssetResponse),
        )

    def suggest_media_travel_update_candidates(
        self, trip_id: str, payload: schemas.MediaTravelUpdateCandidatesRequest
    ) -> dict[str, Any]:
        """Calculate transient owner-review travel update candidates; nothing is persisted."""
        return self._call(
            "media.travel_update_candidates",
            "media_asset",
            None,
            trip_id,
            lambda s, sub: media_service.suggest_travel_update_candidates(s, sub, trip_id, payload),
            lambda x: _model(x, schemas.MediaTravelUpdateCandidatesResponse),
        )

    def delete_media(self, trip_id: str, media_id: str, confirm: bool = False) -> dict[str, str]:
        """Soft-delete media after explicit confirmation."""
        return self._call(
            "media.delete",
            "media_asset",
            media_id,
            trip_id,
            lambda s, sub: media_service.remove_media(s, sub, trip_id, media_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def create_media_derivative(
        self, trip_id: str, media_id: str, payload: schemas.MediaDerivativeCreate
    ) -> dict[str, Any]:
        """Generate a metadata-stripped derivative that remains pending owner approval."""
        return self._call(
            "media_derivative.create",
            "media_derivative",
            None,
            trip_id,
            lambda s, sub: media_service.add_derivative(s, storage(), sub, trip_id, media_id, payload),
            lambda x: _model(x, schemas.MediaDerivativeResponse),
        )

    def approve_media_derivative(
        self, trip_id: str, media_id: str, derivative_id: str, confirm: bool = False
    ) -> dict[str, Any]:
        """Approve a reviewed derivative for possible audience scope use."""
        return self._call(
            "media_derivative.approve",
            "media_derivative",
            derivative_id,
            trip_id,
            lambda s, sub: media_service.approve_derivative(s, sub, trip_id, media_id, derivative_id),
            lambda x: _model(x, schemas.MediaDerivativeResponse),
            confirm=confirm,
            needs_confirmation=True,
        )

    def delete_media_derivative(
        self, trip_id: str, media_id: str, derivative_id: str, confirm: bool = False
    ) -> dict[str, str]:
        """Permanently delete a derivative and withdraw it from live scopes after confirmation."""
        return self._call(
            "media_derivative.delete",
            "media_derivative",
            derivative_id,
            trip_id,
            lambda s, sub: media_service.remove_derivative(s, sub, trip_id, media_id, derivative_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
            after_commit=lambda purge, s: purge.finalise(s, storage()),
        )

    def list_media_derivatives(self, trip_id: str, media_id: str) -> list[dict[str, Any]]:
        """List metadata-stripped derivatives and their review state."""
        return self._call(
            "media_derivative.list",
            "media_derivative",
            media_id,
            trip_id,
            lambda s, sub: media_service.list_derivatives(s, sub, trip_id, media_id),
            lambda x: _models(x, schemas.MediaDerivativeResponse),
        )

    def update_media_derivative_presentation(
        self, trip_id: str, media_id: str, derivative_id: str, payload: schemas.MediaDerivativePresentationUpdate
    ) -> dict[str, Any]:
        """Set approved derivative presentation metadata without changing its bytes. caption is inline Markdown only: bold, italic and links."""
        return self._call(
            "media_derivative.presentation",
            "media_derivative",
            derivative_id,
            trip_id,
            lambda s, sub: media_service.update_derivative_presentation(
                s, sub, trip_id, media_id, derivative_id, payload
            ),
            lambda x: _model(x, schemas.MediaDerivativeResponse),
        )

    def start_media_import_session(self, trip_id: str, provider: ImportProvider) -> dict[str, Any]:
        """Start an explicit provider selection session; interactive OAuth is a separate workflow."""
        from ..media.providers import get_provider_resolver

        return self._call(
            "media_import.start",
            "import_session",
            None,
            trip_id,
            lambda s, sub: media_service.start_import_session(
                s, sub, trip_id, provider, get_secret_store(), get_provider_resolver()
            ),
            lambda x: _model(x, schemas.ImportSessionResponse),
        )

    def complete_media_import_session(
        self, trip_id: str, provider: ImportProvider, session_id: str, confirm: bool = False
    ) -> dict[str, Any]:
        """Copy only owner-selected provider media after explicit confirmation."""
        from ..media.providers import get_provider_resolver

        return self._call(
            "media_import.complete",
            "import_session",
            session_id,
            trip_id,
            lambda s, sub: media_service.complete_import(
                s,
                storage(),
                sub,
                trip_id,
                provider,
                session_id,
                get_secret_store(),
                get_provider_resolver(),
                checkpoint=s.commit,
            ),
            lambda x: _model(x, schemas.ImportSessionCompleteResponse),
            confirm=confirm,
            needs_confirmation=True,
        )

    def list_provider_connection_status(self) -> list[dict[str, Any]]:
        """Read non-secret provider connection status."""
        return self._call(
            "provider_connection.list",
            "provider_connection",
            None,
            None,
            lambda _s, sub: media_service.list_provider_connection_status(sub, get_secret_store()),
            lambda x: _models(x, schemas.ProviderConnectionStatus),
        )

    def get_media(self, trip_id: str, media_id: str) -> dict[str, Any]:
        """Read metadata and the owner-authorized delivery URL for one media asset."""
        return self._call(
            "media.get",
            "media_asset",
            media_id,
            trip_id,
            lambda s, sub: media_service.get_media(s, sub, trip_id, media_id),
            lambda x: _model(x, schemas.MediaAssetResponse),
        )
