"""Authenticated, typed owner MCP tools for Travel.

The MCP layer is deliberately a thin adapter over the existing owner domain
handlers.  It opens the same SQLAlchemy session, supplies the authenticated
subject, and validates with the same Pydantic request/response models as the
browser API.  It never accepts SQL, filesystem paths, object keys, URLs to
fetch, or arbitrary HTTP instructions.

Production transport wiring belongs to apps#226.  This module intentionally
supports local stdio use and integration testing now, while refusing a caller
without an OIDC subject (except the explicitly configured development subject).
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
from collections.abc import Callable
from io import BytesIO
from typing import Any, Literal, TypeVar
from urllib.parse import quote

import anyio.to_thread
from fastapi import HTTPException, Response
from fastapi.datastructures import UploadFile
from fastapi.encoders import jsonable_encoder
from fastmcp import FastMCP
from fastmcp.exceptions import DisabledError, FastMCPError, NotFoundError, ToolError
from fastmcp.server.auth.providers.keycloak import KeycloakAuthProvider
from fastmcp.server.dependencies import get_access_token, get_context
from fastmcp.server.http import StarletteWithLifespan
from fastmcp.server.middleware import Middleware, MiddlewareContext
from mcp.types import ToolAnnotations
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from . import schemas
from .config import settings
from .database import SessionLocal
from .models import DocumentKind, ImportProvider, McpAuditEvent, TrackKind, Visibility
from .routers import (
    documents,
    itinerary,
    library,
    media,
    places,
    publication,
    stays,
    tasks,
    tracks,
    transport,
    trips,
)
from .routers import visibility as visibility_routes
from .secrets import get_secret_store
from .storage import get_storage

Result = TypeVar("Result")
logger = logging.getLogger(__name__)


class BinaryUpload(BaseModel):
    """A bounded, explicit binary input for an owner-selected local file."""

    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=120)
    data_base64: str = Field(min_length=1, max_length=300_000_000)

    def upload_file(self) -> UploadFile:
        try:
            data = base64.b64decode(self.data_base64, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("data_base64 must be valid base64") from error
        return UploadFile(filename=self.filename, file=BytesIO(data), headers={"content-type": self.content_type})


class DocumentDerivativeUpload(BaseModel):
    file: BinaryUpload
    redaction_manifest: BinaryUpload


def _model(value: Any, model_type: type[BaseModel] | None = None) -> Any:
    """Serialize only the declared API representation, never ORM internals."""
    if model_type is None:
        return jsonable_encoder(value)
    return model_type.model_validate(value).model_dump(mode="json")


def _models(values: list[Any], model_type: type[BaseModel]) -> list[dict[str, Any]]:
    return [_model(value, model_type) for value in values]


def _share_url(token: str) -> str:
    """Build the visitor URL that corresponds to an unlisted capability.

    MCP has no browser request or current page URL, so this must use the
    configured visitor PWA origin rather than returning a relative path or an
    API URL.  The token is URL-safe today, but quote it defensively because it
    is a capability and must remain one path segment.
    """
    return f"{str(settings.public_app_url).rstrip('/')}/share/{quote(token, safe='')}"


_AUDITED = "_travel_mcp_audited"


def _request_id() -> str | None:
    """The MCP request id, which correlates a client error, a log line and an audit row."""
    try:
        return str(get_context().request_id)
    except Exception:  # no request context, for example a direct call in a test
        return None


def _validation_fields(error: ValidationError) -> str:
    """Field paths and error types only; pydantic messages echo the rejected input."""
    found = error.errors(include_input=False, include_context=False, include_url=False)
    return ", ".join(f"{'.'.join(str(part) for part in item['loc']) or '<root>'}:{item['type']}" for item in found[:8])


def _error_summary(error: BaseException) -> str:
    """A short, payload-free description that is safe to log and to persist in the audit trail."""
    if isinstance(error, HTTPException):
        return str(error.detail)[:240]
    if isinstance(error, ValidationError):
        return f"Validation failed ({_validation_fields(error)})"[:240]
    return str(error)[:240]


class TravelMcpBackend:
    """Task-specific owner tools which share the application's validation rules."""

    def __init__(self, factory: sessionmaker[Session] = SessionLocal) -> None:
        self.factory = factory

    def _subject(self) -> str:
        """Resolve only a validated FastMCP/OIDC identity, never a tool argument."""
        try:
            token = get_access_token()
        except Exception:  # stdio has no token context
            token = None
        claims = getattr(token, "claims", {}) if token is not None else {}
        subject = claims.get("sub") if isinstance(claims, dict) else None
        if isinstance(subject, str) and subject:
            return subject
        if settings.environment == "development" and settings.mcp_development_subject:
            return settings.mcp_development_subject
        raise PermissionError("Authentication required: a bearer token with a subject claim is required")

    @staticmethod
    def _confirmation(confirm: bool) -> None:
        if not confirm:
            raise ValueError("Set confirm=true after reviewing the preview or target; this operation changes access or deletes data")

    def _audit(
        self, session: Session, *, subject: str, action: str, resource_type: str, resource_id: str | None,
        trip_id: str | None, result: str, detail: str | None = None, request_id: str | None = None,
    ) -> None:
        # Payloads and raw exception traces deliberately never become audit data.
        details = {"error": detail} if detail else {}
        if request_id:
            details["request_id"] = request_id
        session.add(McpAuditEvent(
            owner_subject=subject, action=action, resource_type=resource_type,
            resource_id=resource_id, trip_id=trip_id, result=result, details=details,
        ))
        session.commit()

    def _record_audit(
        self, *, subject: str, action: str, resource_type: str, resource_id: str | None,
        trip_id: str | None, result: str, detail: str | None = None, request_id: str | None = None,
    ) -> None:
        try:
            with self.factory() as session:
                self._audit(session, subject=subject, action=action, resource_type=resource_type,
                            resource_id=resource_id, trip_id=trip_id, result=result, detail=detail,
                            request_id=request_id)
        except Exception as error:
            # Domain handlers may already have committed. An audit outage must
            # not turn a completed operation into a reported tool failure.
            logger.error("MCP audit write failed for %s request_id=%s: %s", action, request_id, type(error).__name__)

    def _audit_unexecuted_rejection(self, tool: str, arguments: dict[str, Any] | None, error: BaseException) -> None:
        """Audit a call refused before its tool body ran, such as invalid arguments.

        Only the tool name and a payload-free summary are kept. Nothing is
        recorded without an authenticated subject.
        """
        try:
            subject = self._subject()
        except PermissionError:
            return
        trip_id = (arguments or {}).get("trip_id")
        self._record_audit(
            subject=subject, action=tool, resource_type="tool_invocation", resource_id=None,
            trip_id=trip_id if isinstance(trip_id, str) and len(trip_id) <= 32 else None,
            result="rejected", detail=_error_summary(error), request_id=_request_id(),
        )

    def _reject(
        self, error: Exception, subject: str, action: str, resource_type: str,
        resource_id: str | None, trip_id: str | None, request_id: str | None,
    ) -> None:
        summary = _error_summary(error)
        logger.warning("MCP tool %s rejected request_id=%s error=%s: %s", action, request_id, type(error).__name__, summary)
        self._record_audit(subject=subject, action=action, resource_type=resource_type,
                           resource_id=resource_id, trip_id=trip_id, result="rejected", detail=summary,
                           request_id=request_id)

    def _call(
        self, action: str, resource_type: str, resource_id: str | None, trip_id: str | None,
        operation: Callable[[Session, str], Result], output: Callable[[Result], Any] = jsonable_encoder,
        *, confirm: bool = True, needs_confirmation: bool = False,
    ) -> Any:
        subject = self._subject()
        request_id = _request_id()
        try:
            with self.factory() as session:
                if needs_confirmation:
                    self._confirmation(confirm)
                result = operation(session, subject)
                rendered = output(result)
                session.commit()
        except HTTPException as error:
            self._reject(error, subject, action, resource_type, resource_id, trip_id, request_id)
            translated = ValueError(str(error.detail))
            setattr(translated, _AUDITED, True)
            raise translated from error
        except Exception as error:
            self._reject(error, subject, action, resource_type, resource_id, trip_id, request_id)
            setattr(error, _AUDITED, True)
            raise
        self._record_audit(subject=subject, action=action, resource_type=resource_type,
                           resource_id=resource_id, trip_id=trip_id, result="succeeded", request_id=request_id)
        return rendered

    # Identity and audit -------------------------------------------------
    def whoami(self) -> dict[str, str]:
        """Show the authenticated owner subject; no token material is returned."""
        subject = self._subject()
        return {"subject": subject, "role": "owner"}

    def list_mcp_audit_events(self, limit: int = Field(default=50, ge=1, le=200)) -> list[dict[str, Any]]:
        """Read this owner's bounded MCP invocation history, newest first."""
        return self._call("mcp_audit.list", "mcp_audit_event", None, None,
            lambda s, subject: list(s.scalars(select(McpAuditEvent).where(McpAuditEvent.owner_subject == subject)
                                              .order_by(McpAuditEvent.occurred_at.desc()).limit(limit))),
            lambda rows: [_model(row) for row in rows])

    # Trips, route stages and travel updates ------------------------
    def list_trips(self) -> list[dict[str, Any]]:
        """List the caller's private trips and their owner-only editing context."""
        return self._call("trip.list", "trip", None, None, lambda s, sub: trips.list_trips(s, sub), lambda x: _models(x, schemas.TripResponse))

    def create_trip(self, payload: schemas.TripCreate) -> dict[str, Any]:
        """Create a private trip."""
        return self._call("trip.create", "trip", None, None, lambda s, sub: trips.create_trip(payload, s, sub), lambda x: _model(x, schemas.TripResponse))

    def get_trip(self, trip_id: str) -> dict[str, Any]:
        """Read one owned trip."""
        return self._call("trip.get", "trip", trip_id, trip_id, lambda s, sub: trips.get_trip(trip_id, s, sub), lambda x: _model(x, schemas.TripResponse))

    def update_trip(self, trip_id: str, payload: schemas.TripUpdate) -> dict[str, Any]:
        """Update an owned trip's private metadata."""
        return self._call("trip.update", "trip", trip_id, trip_id, lambda s, sub: trips.update_trip(trip_id, payload, s, sub), lambda x: _model(x, schemas.TripResponse))

    def delete_trip(self, trip_id: str, confirm: bool = False) -> dict[str, str]:
        """Permanently delete an owned trip after explicit confirmation."""
        return self._call("trip.delete", "trip", trip_id, trip_id, lambda s, sub: trips.delete_trip(trip_id, s, sub), lambda _: {"status": "deleted"}, confirm=confirm, needs_confirmation=True)

    def create_route_stage(self, trip_id: str, payload: schemas.RouteStageCreate) -> dict[str, Any]:
        """Add a reviewed broad route stage."""
        return self._call("route_stage.create", "route_stage", None, trip_id, lambda s, sub: trips.create_route_stage(trip_id, payload, s, sub), lambda x: _model(x, schemas.RouteStageResponse))

    def update_route_stage(self, trip_id: str, stage_id: str, payload: schemas.RouteStageUpdate) -> dict[str, Any]:
        """Edit one broad route stage."""
        return self._call("route_stage.update", "route_stage", stage_id, trip_id, lambda s, sub: trips.update_route_stage(trip_id, stage_id, payload, s, sub), lambda x: _model(x, schemas.RouteStageResponse))

    def delete_route_stage(self, trip_id: str, stage_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete a route stage after explicit confirmation."""
        return self._call("route_stage.delete", "route_stage", stage_id, trip_id, lambda s, sub: trips.delete_route_stage(trip_id, stage_id, s, sub), lambda _: {"status": "deleted"}, confirm=confirm, needs_confirmation=True)

    def create_travel_update(self, trip_id: str, payload: schemas.TravelUpdateCreate) -> dict[str, Any]:
        """Create a reisupdate: private notes, exact place and attached media stay private; the title, text, date and area are shared only as its visibility allows."""
        return self._call("travel_update.create", "travel_update", None, trip_id, lambda s, sub: trips.create_travel_update(trip_id, payload, s, sub), lambda x: _model(x, schemas.TravelUpdateResponse))

    def update_travel_update(self, trip_id: str, update_id: str, payload: schemas.TravelUpdatePatch) -> dict[str, Any]:
        """Edit a reisupdate, including who may see it (private, everyone or custom)."""
        return self._call("travel_update.update", "travel_update", update_id, trip_id, lambda s, sub: trips.update_travel_update(trip_id, update_id, payload, s, sub), lambda x: _model(x, schemas.TravelUpdateResponse))

    def delete_travel_update(self, trip_id: str, update_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete a reisupdate after explicit confirmation."""
        return self._call("travel_update.delete", "travel_update", update_id, trip_id, lambda s, sub: trips.delete_travel_update(trip_id, update_id, s, sub), lambda _: {"status": "deleted"}, confirm=confirm, needs_confirmation=True)

    # Exact and broad places --------------------------------------------
    def search_places(self, trip_id: str, payload: schemas.PlaceSearchRequest) -> dict[str, Any]:
        """Explicitly search the configured owner-only place provider; this never saves a place."""
        from .places.search import get_place_search_service
        return self._call("place.search", "place_search", None, trip_id, lambda s, sub: places.search_places(trip_id, payload, s, sub, get_place_search_service()), lambda x: _model(x, schemas.PlaceSearchResponse))

    def reverse_geocode_place(self, trip_id: str, payload: schemas.PlaceReverseGeocodeRequest) -> dict[str, Any]:
        """Explicitly request a coordinate-to-place suggestion; this never writes canonical data."""
        from .places.search import get_place_search_service
        return self._call("place.reverse", "place_search", None, trip_id, lambda s, sub: places.reverse_geocode_place(trip_id, payload, s, sub, get_place_search_service()), lambda x: _model(x, schemas.PlaceSearchResponse))

    def list_exact_places(self, trip_id: str) -> list[dict[str, Any]]:
        """List owner-only exact places."""
        return self._call("exact_place.list", "exact_place", None, trip_id, lambda s, sub: places.list_exact_places(trip_id, s, sub), lambda x: _models(x, schemas.ExactPlaceResponse))

    def save_exact_place(self, trip_id: str, payload: schemas.ExactPlaceInput) -> dict[str, Any]:
        """Save a selected exact place for this trip."""
        return self._call("exact_place.create", "exact_place", None, trip_id, lambda s, sub: places.save_exact_place(trip_id, payload, s, sub), lambda x: _model(x, schemas.ExactPlaceResponse))

    def list_broad_places(self, trip_id: str) -> list[dict[str, Any]]:
        """List intentionally authored broad places only."""
        return self._call("broad_place.list", "broad_place", None, trip_id, lambda s, sub: places.list_broad_places(trip_id, s, sub), lambda x: _models(x, schemas.BroadPlaceResponse))

    def save_broad_place(self, trip_id: str, payload: schemas.BroadPlaceInput) -> dict[str, Any]:
        """Save a broad place without making it public."""
        return self._call("broad_place.create", "broad_place", None, trip_id, lambda s, sub: places.save_broad_place(trip_id, payload, s, sub), lambda x: _model(x, schemas.BroadPlaceResponse))

    def update_broad_place(self, trip_id: str, place_id: str, payload: schemas.BroadPlaceUpdate) -> dict[str, Any]:
        """Edit a broad place, for example to set its IANA time zone."""
        return self._call("broad_place.update", "broad_place", place_id, trip_id, lambda s, sub: places.update_broad_place(trip_id, place_id, payload, s, sub), lambda x: _model(x, schemas.BroadPlaceResponse))

    def update_exact_place(self, trip_id: str, place_id: str, payload: schemas.ExactPlaceUpdate) -> dict[str, Any]:
        """Give an exact place its public name; a spot cannot be shared without one."""
        return self._call("exact_place.update", "exact_place", place_id, trip_id, lambda s, sub: places.update_exact_place(trip_id, place_id, payload, s, sub), lambda x: _model(x, schemas.ExactPlaceResponse))

    def set_visibility(self, trip_id: str, kind: schemas.ShareScopeKind, record_id: str, visibility: Visibility, confirm: bool = False) -> dict[str, Any]:
        """Choose who receives one record: private, everyone, or custom (only audiences that list it)."""
        kind, visibility = schemas.ShareScopeKind(kind), Visibility(visibility)
        return self._call("visibility.set", kind.value, record_id, trip_id, lambda s, sub: visibility_routes.put_visibility(trip_id, kind, record_id, schemas.VisibilityUpdate(visibility=visibility), s, sub), lambda x: _model(x, schemas.VisibilityUpdate), confirm=confirm, needs_confirmation=True)

    # Publication, previews, share capabilities -------------------------
    def get_public_projection_status(self, trip_id: str) -> dict[str, Any]:
        """Read the public-surface state and current explicit scope."""
        return self._call("public_projection.get", "public_surface", trip_id, trip_id, lambda s, sub: publication.get_public_projection_status(trip_id, s, sub), lambda x: _model(x, schemas.PublicProjectionStatusResponse))

    def preview_public_projection(self, trip_id: str) -> dict[str, Any]:
        """Render the live public projection for owner review without publishing it."""
        return self._call("public_projection.preview", "public_surface", trip_id, trip_id, lambda s, sub: publication.preview_public_projection(trip_id, s, sub, Response()), lambda x: _model(x, schemas.ProjectionDocument))

    def set_public_projection_scope(self, trip_id: str, payload: schemas.ShareScopeInput, confirm: bool = False) -> dict[str, Any]:
        """Replace the live public scope after explicit owner confirmation."""
        return self._call("public_projection.scope", "public_surface", trip_id, trip_id, lambda s, sub: publication.set_public_projection_scope(trip_id, payload, s, sub), lambda x: _model(x, schemas.PublicProjectionStatusResponse), confirm=confirm, needs_confirmation=True)

    def publish_public_projection(self, trip_id: str, confirm: bool = False) -> dict[str, Any]:
        """Start public delivery only after an explicit confirmation."""
        return self._call("public_projection.publish", "public_surface", trip_id, trip_id, lambda s, sub: publication.publish_public_projection(trip_id, s, sub), lambda x: _model(x, schemas.PublicProjectionStatusResponse), confirm=confirm, needs_confirmation=True)

    def unpublish_public_projection(self, trip_id: str, reason: str | None = None, confirm: bool = False) -> dict[str, Any]:
        """Stop public delivery only after explicit confirmation."""
        return self._call("public_projection.unpublish", "public_surface", trip_id, trip_id, lambda s, sub: publication.unpublish_public_projection(trip_id, s, sub, schemas.AuditReasonInput(reason=reason)), lambda x: _model(x, schemas.PublicProjectionStatusResponse), confirm=confirm, needs_confirmation=True)

    def list_share_links(self, trip_id: str) -> list[dict[str, Any]]:
        """List named share links without returning any capability token."""
        return self._call("share_link.list", "share_link", None, trip_id, lambda s, sub: publication.list_share_links(trip_id, s, sub), lambda x: _models(x, schemas.ShareLinkResponse))

    def create_share_link(self, trip_id: str, payload: schemas.ShareLinkCreate, confirm: bool = False) -> dict[str, Any]:
        """Create a draft named share link after reviewing its audience scope."""
        return self._call("share_link.create", "share_link", None, trip_id, lambda s, sub: publication.create_share_link(trip_id, payload, s, sub), lambda x: _model(x, schemas.ShareLinkResponse), confirm=confirm, needs_confirmation=True)

    def get_share_link(self, trip_id: str, link_id: str) -> dict[str, Any]:
        """Read one named link's state and scoped audience without a capability token."""
        return self._call("share_link.get", "share_link", link_id, trip_id, lambda s, sub: publication.get_share_link(trip_id, link_id, s, sub), lambda x: _model(x, schemas.ShareLinkResponse))

    def update_share_link(self, trip_id: str, link_id: str, payload: schemas.ShareLinkUpdate, confirm: bool = False) -> dict[str, Any]:
        """Update a named link's label or live scope after explicit owner confirmation."""
        return self._call("share_link.update", "share_link", link_id, trip_id, lambda s, sub: publication.update_share_link(trip_id, link_id, payload, s, sub), lambda x: _model(x, schemas.ShareLinkResponse), confirm=confirm, needs_confirmation=True)

    def preview_share_link(self, trip_id: str, link_id: str) -> dict[str, Any]:
        """Render a named link's current projection for owner review; no token is minted."""
        return self._call("share_link.preview", "share_link", link_id, trip_id, lambda s, sub: publication.preview_share_link(trip_id, link_id, s, sub, Response()), lambda x: _model(x, schemas.ProjectionDocument))

    def activate_share_link(self, trip_id: str, link_id: str, payload: schemas.ShareLinkActivateRequest, confirm: bool = False) -> dict[str, Any]:
        """Activate a reusable owner-managed URL and return its full visitor URL."""
        return self._call("share_link.activate", "share_link", link_id, trip_id, lambda s, sub: publication.activate_share_link(trip_id, link_id, payload, s, sub), lambda x: {**_model(x, schemas.ShareLinkActivateResponse), "share_url": _share_url(x.token)}, confirm=confirm, needs_confirmation=True)

    def revoke_share_link(self, trip_id: str, link_id: str, reason: str | None = None, confirm: bool = False) -> dict[str, Any]:
        """Immediately revoke a share capability after explicit confirmation."""
        return self._call("share_link.revoke", "share_link", link_id, trip_id, lambda s, sub: publication.revoke_share_link(trip_id, link_id, schemas.AuditReasonInput(reason=reason), s, sub), lambda x: _model(x, schemas.ShareLinkResponse), confirm=confirm, needs_confirmation=True)

    def rotate_share_link(self, trip_id: str, link_id: str, payload: schemas.ShareLinkActivateRequest, confirm: bool = False) -> dict[str, Any]:
        """Revoke the current capability and return a new full visitor URL after confirmation."""
        return self._call("share_link.rotate", "share_link", link_id, trip_id, lambda s, sub: publication.rotate_share_link(trip_id, link_id, payload, s, sub), lambda x: {**_model(x, schemas.ShareLinkActivateResponse), "share_url": _share_url(x.token)}, confirm=confirm, needs_confirmation=True)

    def list_trip_audit_events(self, trip_id: str) -> list[dict[str, Any]]:
        """Read audience/publication lifecycle history for an owned trip."""
        return self._call("audit_event.list", "audit_event", None, trip_id, lambda s, sub: publication.list_audit_events(trip_id, s, sub), lambda x: _models(x, schemas.AuditEventResponse))

    # Media and document asset workflows --------------------------------
    def upload_media(self, trip_id: str, file: BinaryUpload) -> dict[str, Any]:
        """Import an owner-selected local media file through the validated storage pipeline."""
        return self._call("media.upload", "media_asset", None, trip_id, lambda s, sub: media.upload_media(trip_id, s, sub, get_storage(), Response(), file.upload_file()), lambda x: _model(x, schemas.MediaAssetResponse))

    def list_media(self, trip_id: str) -> list[dict[str, Any]]:
        """List owner-only media assets."""
        return self._call("media.list", "media_asset", None, trip_id, lambda s, sub: media.list_media(trip_id, s, sub), lambda x: _models(x, schemas.MediaAssetResponse))

    def suggest_media_visit_candidates(self, trip_id: str, payload: schemas.MediaVisitCandidatesRequest) -> dict[str, Any]:
        """Calculate transient owner-review visit candidates; nothing is persisted."""
        return self._call("media.visit_candidates", "media_asset", None, trip_id, lambda s, sub: media.suggest_visit_candidates(trip_id, payload, s, sub), lambda x: _model(x, schemas.MediaVisitCandidatesResponse))

    def delete_media(self, trip_id: str, media_id: str, confirm: bool = False) -> dict[str, str]:
        """Soft-delete media after explicit confirmation."""
        return self._call("media.delete", "media_asset", media_id, trip_id, lambda s, sub: media.remove_media(trip_id, media_id, s, sub), lambda _: {"status": "deleted"}, confirm=confirm, needs_confirmation=True)

    def create_media_derivative(self, trip_id: str, media_id: str, payload: schemas.MediaDerivativeCreate) -> dict[str, Any]:
        """Generate a metadata-stripped derivative that remains pending owner approval."""
        return self._call("media_derivative.create", "media_derivative", None, trip_id, lambda s, sub: media.add_derivative(trip_id, media_id, payload, s, sub, get_storage()), lambda x: _model(x, schemas.MediaDerivativeResponse))

    def approve_media_derivative(self, trip_id: str, media_id: str, derivative_id: str, confirm: bool = False) -> dict[str, Any]:
        """Approve a reviewed derivative for possible audience scope use."""
        return self._call("media_derivative.approve", "media_derivative", derivative_id, trip_id, lambda s, sub: media.approve_derivative(trip_id, media_id, derivative_id, s, sub), lambda x: _model(x, schemas.MediaDerivativeResponse), confirm=confirm, needs_confirmation=True)

    def delete_media_derivative(self, trip_id: str, media_id: str, derivative_id: str, confirm: bool = False) -> dict[str, str]:
        """Permanently delete a derivative and withdraw it from live scopes after confirmation."""
        return self._call("media_derivative.delete", "media_derivative", derivative_id, trip_id, lambda s, sub: media.remove_derivative(trip_id, media_id, derivative_id, s, sub, get_storage()), lambda _: {"status": "deleted"}, confirm=confirm, needs_confirmation=True)

    def upload_document(self, trip_id: str, title: str, document_kind: DocumentKind, file: BinaryUpload) -> dict[str, Any]:
        """Upload an owner-only trip document via the application storage pipeline."""
        return self._call("document.upload", "document_asset", None, trip_id, lambda s, sub: documents.upload_document(trip_id, s, sub, get_storage(), Response(), title, document_kind, file.upload_file()), lambda x: _model(x, schemas.DocumentAssetResponse))

    def list_documents(self, trip_id: str) -> list[dict[str, Any]]:
        """List owner-only documents for a trip."""
        return self._call("document.list", "document_asset", None, trip_id, lambda s, sub: documents.list_documents(trip_id, s, sub), lambda x: _models(x, schemas.DocumentAssetResponse))

    def delete_document(self, trip_id: str, document_id: str, confirm: bool = False) -> dict[str, str]:
        """Soft-delete a trip document after explicit confirmation."""
        return self._call("document.delete", "document_asset", document_id, trip_id, lambda s, sub: documents.remove_document(trip_id, document_id, s, sub), lambda _: {"status": "deleted"}, confirm=confirm, needs_confirmation=True)

    # Owner-wide library -------------------------------------------------
    def list_library_documents(self, linked_trip_id: str | None = None) -> list[dict[str, Any]]:
        """List the owner's reusable private document library."""
        return self._call("library_document.list", "library_document", None, linked_trip_id, lambda s, sub: library.list_library_documents(s, sub, linked_trip_id), lambda x: _models(x, schemas.OwnerDocumentResponse))

    def list_emergency_info(self) -> list[dict[str, Any]]:
        """List owner-only emergency information."""
        return self._call("emergency_info.list", "emergency_info", None, None, lambda s, sub: library.list_emergency_info(s, sub), lambda x: _models(x, schemas.EmergencyInfoEntryResponse))

    def create_emergency_info(self, payload: schemas.EmergencyInfoEntryCreate) -> dict[str, Any]:
        """Create a private emergency-information entry."""
        return self._call("emergency_info.create", "emergency_info", None, None, lambda s, sub: library.create_emergency_info(payload, s, sub), lambda x: _model(x, schemas.EmergencyInfoEntryResponse))

    # Stays, transport, itinerary, and preparation ----------------------
    def list_stays(self, trip_id: str) -> list[dict[str, Any]]:
        """List exact, owner-only accommodation records."""
        return self._call("stay.list", "stay", None, trip_id, lambda s, sub: stays.list_stays(trip_id, s, sub), lambda x: _models(x, schemas.StayResponse))

    def create_stay(self, trip_id: str, payload: schemas.StayCreate) -> dict[str, Any]:
        """Create a private stay with check-in and check-out dates; omit local times until verified."""
        return self._call("stay.create", "stay", None, trip_id, lambda s, sub: stays.create_stay(trip_id, payload, s, sub), lambda x: _model(x, schemas.StayResponse))

    def update_stay(self, trip_id: str, stay_id: str, payload: schemas.StayUpdate) -> dict[str, Any]:
        """Update a private stay; set arrives_at/departs_at to null to clear unverified times."""
        return self._call("stay.update", "stay", stay_id, trip_id, lambda s, sub: stays.update_stay(trip_id, stay_id, payload, s, sub), lambda x: _model(x, schemas.StayResponse))

    def delete_stay(self, trip_id: str, stay_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete an accommodation record after explicit confirmation."""
        return self._call("stay.delete", "stay", stay_id, trip_id, lambda s, sub: stays.delete_stay(trip_id, stay_id, s, sub), lambda _: {"status": "deleted"}, confirm=confirm, needs_confirmation=True)

    def list_transport_legs(self, trip_id: str) -> list[dict[str, Any]]:
        """List owner-only transport itinerary records."""
        return self._call("transport_leg.list", "transport_leg", None, trip_id, lambda s, sub: transport.list_transport_legs(trip_id, s, sub), lambda x: _models(x, schemas.TransportLegResponse))

    def create_transport_leg(self, trip_id: str, payload: schemas.TransportLegCreate) -> dict[str, Any]:
        """Create a transport leg with validated exact places and document links."""
        return self._call("transport_leg.create", "transport_leg", None, trip_id, lambda s, sub: transport.create_transport_leg(trip_id, payload, s, sub), lambda x: _model(x, schemas.TransportLegResponse))

    def update_transport_leg(self, trip_id: str, leg_id: str, payload: schemas.TransportLegUpdate) -> dict[str, Any]:
        """Update an owner-only transport leg."""
        return self._call("transport_leg.update", "transport_leg", leg_id, trip_id, lambda s, sub: transport.update_transport_leg(trip_id, leg_id, payload, s, sub), lambda x: _model(x, schemas.TransportLegResponse))

    def delete_transport_leg(self, trip_id: str, leg_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete a transport leg after explicit confirmation."""
        return self._call("transport_leg.delete", "transport_leg", leg_id, trip_id, lambda s, sub: transport.delete_transport_leg(trip_id, leg_id, s, sub), lambda _: {"status": "deleted"}, confirm=confirm, needs_confirmation=True)

    def list_itinerary_entries(self, trip_id: str) -> list[dict[str, Any]]:
        """List ordered owner day-plan entries."""
        return self._call("itinerary_entry.list", "itinerary_entry", None, trip_id, lambda s, sub: itinerary.list_itinerary_entries(trip_id, s, sub), lambda x: _models(x, schemas.ItineraryEntryResponse))

    def create_itinerary_entry(self, trip_id: str, payload: schemas.ItineraryEntryCreate) -> dict[str, Any]:
        """Create a validated owner day-plan entry."""
        return self._call("itinerary_entry.create", "itinerary_entry", None, trip_id, lambda s, sub: itinerary.create_itinerary_entry(trip_id, payload, s, sub), lambda x: _model(x, schemas.ItineraryEntryResponse))

    def update_itinerary_entry(self, trip_id: str, entry_id: str, payload: schemas.ItineraryEntryUpdate) -> dict[str, Any]:
        """Update or reorder an owner day-plan entry."""
        return self._call("itinerary_entry.update", "itinerary_entry", entry_id, trip_id, lambda s, sub: itinerary.update_itinerary_entry(trip_id, entry_id, payload, s, sub), lambda x: _model(x, schemas.ItineraryEntryResponse))

    def delete_itinerary_entry(self, trip_id: str, entry_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete a day-plan entry after explicit confirmation."""
        return self._call("itinerary_entry.delete", "itinerary_entry", entry_id, trip_id, lambda s, sub: itinerary.delete_itinerary_entry(trip_id, entry_id, s, sub), lambda _: {"status": "deleted"}, confirm=confirm, needs_confirmation=True)

    def list_trip_tasks(self, trip_id: str) -> list[dict[str, Any]]:
        """List owner preparation tasks."""
        return self._call("trip_task.list", "trip_task", None, trip_id, lambda s, sub: tasks.list_trip_tasks(trip_id, s, sub), lambda x: _models(x, schemas.TripTaskResponse))

    def create_trip_task(self, trip_id: str, payload: schemas.TripTaskCreate) -> dict[str, Any]:
        """Create a private task. Use remind_at for an inbox and email reminder; due_date alone schedules nothing."""
        return self._call("trip_task.create", "trip_task", None, trip_id, lambda s, sub: tasks.create_trip_task(trip_id, payload, s, sub), lambda x: _model(x, schemas.TripTaskResponse))

    def update_trip_task(self, trip_id: str, task_id: str, payload: schemas.TripTaskUpdate) -> dict[str, Any]:
        """Update a private task, including its explicit reminder schedule."""
        return self._call("trip_task.update", "trip_task", task_id, trip_id, lambda s, sub: tasks.update_trip_task(trip_id, task_id, payload, s, sub), lambda x: _model(x, schemas.TripTaskResponse))

    def delete_trip_task(self, trip_id: str, task_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete a preparation task after explicit confirmation."""
        return self._call("trip_task.delete", "trip_task", task_id, trip_id, lambda s, sub: tasks.delete_trip_task(trip_id, task_id, s, sub), lambda _: {"status": "deleted"}, confirm=confirm, needs_confirmation=True)

    def list_task_alerts(self, trip_id: str) -> list[dict[str, Any]]:
        """List delivered owner-inbox task reminders for a trip."""
        return self._call("task_alert.list", "task_alert", None, trip_id, lambda s, sub: tasks.list_task_alerts(trip_id, s, sub), lambda x: _models(x, schemas.TripTaskAlertResponse))

    def mark_task_alert_read(self, trip_id: str, alert_id: str) -> dict[str, Any]:
        """Mark one owner-inbox task alert as read."""
        return self._call("task_alert.read", "task_alert", alert_id, trip_id, lambda s, sub: tasks.mark_task_alert_read(trip_id, alert_id, s, sub), lambda x: _model(x, schemas.TripTaskAlertResponse))
    # Finished private tracks and broad reviewed routes ------------------
    def upload_finished_track(self, trip_id: str, started_at: str, ended_at: str, kind: TrackKind, file: BinaryUpload) -> dict[str, Any]:
        """Upload one complete recorded track; live point streaming is not supported."""
        from datetime import datetime
        return self._call("recorded_track.upload", "recorded_track", None, trip_id, lambda s, sub: tracks.upload_finished_track(trip_id, s, sub, get_storage(), Response(), datetime.fromisoformat(started_at.replace("Z", "+00:00")), datetime.fromisoformat(ended_at.replace("Z", "+00:00")), kind, file.upload_file()), lambda x: _model(x, schemas.RecordedTrackResponse))

    def list_recorded_tracks(self, trip_id: str) -> list[dict[str, Any]]:
        """List completed private recordings, never live location data."""
        return self._call("recorded_track.list", "recorded_track", None, trip_id, lambda s, sub: tracks.list_recorded_tracks(trip_id, s, sub), lambda x: _models(x, schemas.RecordedTrackResponse))

    def list_broad_routes(self, trip_id: str) -> list[dict[str, Any]]:
        """List separately authored broad GeoJSON routes."""
        return self._call("broad_route.list", "broad_route", None, trip_id, lambda s, sub: tracks.list_broad_routes(trip_id, s, sub), lambda x: _models(x, schemas.BroadRouteResponse))

    def create_broad_route(self, trip_id: str, payload: schemas.BroadRouteCreate) -> dict[str, Any]:
        """Create a reviewed broad route; it is never derived from raw tracks."""
        return self._call("broad_route.create", "broad_route", None, trip_id, lambda s, sub: tracks.create_broad_route(trip_id, payload, s, sub), lambda x: _model(x, schemas.BroadRouteResponse))

    def update_broad_route(self, trip_id: str, route_id: str, payload: schemas.BroadRouteUpdate) -> dict[str, Any]:
        """Update an authored broad route."""
        return self._call("broad_route.update", "broad_route", route_id, trip_id, lambda s, sub: tracks.update_broad_route(trip_id, route_id, payload, s, sub), lambda x: _model(x, schemas.BroadRouteResponse))

    def delete_broad_route(self, trip_id: str, route_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete a broad route after explicit confirmation."""
        return self._call("broad_route.delete", "broad_route", route_id, trip_id, lambda s, sub: tracks.delete_broad_route(trip_id, route_id, s, sub), lambda _: {"status": "deleted"}, confirm=confirm, needs_confirmation=True)

    # Remaining derivative, import, and owner-library lifecycle tools ----
    def list_media_derivatives(self, trip_id: str, media_id: str) -> list[dict[str, Any]]:
        """List metadata-stripped derivatives and their review state."""
        return self._call("media_derivative.list", "media_derivative", media_id, trip_id, lambda s, sub: media.list_derivatives(trip_id, media_id, s, sub), lambda x: _models(x, schemas.MediaDerivativeResponse))

    def update_media_derivative_presentation(self, trip_id: str, media_id: str, derivative_id: str, payload: schemas.MediaDerivativePresentationUpdate) -> dict[str, Any]:
        """Set approved derivative presentation metadata without changing its bytes."""
        return self._call("media_derivative.presentation", "media_derivative", derivative_id, trip_id, lambda s, sub: media.update_derivative_presentation(trip_id, media_id, derivative_id, payload, s, sub), lambda x: _model(x, schemas.MediaDerivativeResponse))

    def start_media_import_session(self, trip_id: str, provider: ImportProvider) -> dict[str, Any]:
        """Start an explicit provider selection session; interactive OAuth is a separate workflow."""
        from .media.providers import get_provider_resolver
        return self._call("media_import.start", "import_session", None, trip_id, lambda s, sub: media.start_import_session(trip_id, provider, s, sub, get_secret_store(), get_provider_resolver()), lambda x: _model(x, schemas.ImportSessionResponse))

    def complete_media_import_session(self, trip_id: str, provider: ImportProvider, session_id: str, confirm: bool = False) -> dict[str, Any]:
        """Copy only owner-selected provider media after explicit confirmation."""
        from .media.providers import get_provider_resolver
        return self._call("media_import.complete", "import_session", session_id, trip_id, lambda s, sub: media.complete_import(trip_id, provider, session_id, s, sub, get_storage(), get_secret_store(), get_provider_resolver()), lambda x: _model(x, schemas.ImportSessionCompleteResponse), confirm=confirm, needs_confirmation=True)

    def list_provider_connection_status(self) -> list[dict[str, Any]]:
        """Read non-secret provider connection status."""
        return self._call("provider_connection.list", "provider_connection", None, None, lambda _s, sub: media.list_provider_connection_status(sub, get_secret_store()), lambda x: _models(x, schemas.ProviderConnectionStatus))

    def list_document_derivatives(self, trip_id: str, document_id: str) -> list[dict[str, Any]]:
        """List redacted document derivatives and their review state."""
        return self._call("document_derivative.list", "document_derivative", document_id, trip_id, lambda s, sub: documents.list_derivatives(trip_id, document_id, s, sub), lambda x: _models(x, schemas.DocumentDerivativeResponse))

    def add_document_derivative(self, trip_id: str, document_id: str, payload: DocumentDerivativeUpload) -> dict[str, Any]:
        """Upload an explicitly redacted derivative and its validated redaction manifest."""
        return self._call("document_derivative.create", "document_derivative", None, trip_id, lambda s, sub: documents.add_redacted_derivative(trip_id, document_id, s, sub, get_storage(), Response(), payload.file.upload_file(), payload.redaction_manifest.upload_file()), lambda x: _model(x, schemas.DocumentDerivativeResponse))

    def approve_document_derivative(self, trip_id: str, document_id: str, derivative_id: str, confirm: bool = False) -> dict[str, Any]:
        """Approve a reviewed redacted document derivative after confirmation."""
        return self._call("document_derivative.approve", "document_derivative", derivative_id, trip_id, lambda s, sub: documents.approve_derivative(trip_id, document_id, derivative_id, s, sub), lambda x: _model(x, schemas.DocumentDerivativeResponse), confirm=confirm, needs_confirmation=True)

    def upload_library_document(self, title: str, document_kind: DocumentKind, file: BinaryUpload, linked_trip_id: str | None = None) -> dict[str, Any]:
        """Upload a reusable owner-private library document."""
        return self._call("library_document.upload", "library_document", None, linked_trip_id, lambda s, sub: library.upload_library_document(s, sub, get_storage(), Response(), title, document_kind, file.upload_file(), linked_trip_id), lambda x: _model(x, schemas.OwnerDocumentResponse))

    def update_library_document(self, document_id: str, payload: schemas.OwnerDocumentUpdate) -> dict[str, Any]:
        """Update a reusable private document's metadata."""
        return self._call("library_document.update", "library_document", document_id, None, lambda s, sub: library.update_library_document(document_id, payload, s, sub), lambda x: _model(x, schemas.OwnerDocumentResponse))

    def delete_library_document(self, document_id: str, confirm: bool = False) -> dict[str, str]:
        """Soft-delete a library document after explicit confirmation."""
        return self._call("library_document.delete", "library_document", document_id, None, lambda s, sub: library.remove_library_document(document_id, s, sub), lambda _: {"status": "deleted"}, confirm=confirm, needs_confirmation=True)

    def update_emergency_info(self, entry_id: str, payload: schemas.EmergencyInfoEntryUpdate) -> dict[str, Any]:
        """Update a private emergency-information entry."""
        return self._call("emergency_info.update", "emergency_info", entry_id, None, lambda s, sub: library.update_emergency_info(entry_id, payload, s, sub), lambda x: _model(x, schemas.EmergencyInfoEntryResponse))

    def delete_emergency_info(self, entry_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete an emergency-information entry after explicit confirmation."""
        return self._call("emergency_info.delete", "emergency_info", entry_id, None, lambda s, sub: library.delete_emergency_info(entry_id, s, sub), lambda _: {"status": "deleted"}, confirm=confirm, needs_confirmation=True)

    # Focused owner reads and delivery diagnostics -----------------------
    def get_exact_place_navigation(self, trip_id: str, place_id: str) -> dict[str, Any]:
        """Resolve an owned exact place to its authorized navigation URL."""
        return self._call("exact_place.navigation", "exact_place", place_id, trip_id, lambda s, sub: places.owner_navigation(place_id, trip_id, s, sub), lambda x: _model(x, schemas.NavigationResponse))

    def get_stay(self, trip_id: str, stay_id: str) -> dict[str, Any]:
        """Read one owner-only exact accommodation record."""
        return self._call("stay.get", "stay", stay_id, trip_id, lambda s, sub: stays.get_stay(trip_id, stay_id, s, sub), lambda x: _model(x, schemas.StayResponse))

    def get_transport_leg(self, trip_id: str, leg_id: str) -> dict[str, Any]:
        """Read one owner-only transport itinerary record."""
        return self._call("transport_leg.get", "transport_leg", leg_id, trip_id, lambda s, sub: transport.get_transport_leg(trip_id, leg_id, s, sub), lambda x: _model(x, schemas.TransportLegResponse))

    def get_itinerary_entry(self, trip_id: str, entry_id: str) -> dict[str, Any]:
        """Read one ordered owner day-plan entry."""
        return self._call("itinerary_entry.get", "itinerary_entry", entry_id, trip_id, lambda s, sub: itinerary.get_itinerary_entry(trip_id, entry_id, s, sub), lambda x: _model(x, schemas.ItineraryEntryResponse))

    def get_trip_task(self, trip_id: str, task_id: str) -> dict[str, Any]:
        """Read one owner preparation task."""
        return self._call("trip_task.get", "trip_task", task_id, trip_id, lambda s, sub: tasks.get_trip_task(trip_id, task_id, s, sub), lambda x: _model(x, schemas.TripTaskResponse))

    def get_recorded_track(self, trip_id: str, track_id: str) -> dict[str, Any]:
        """Read metadata and the owner-authorized delivery URL for one finished track."""
        return self._call("recorded_track.get", "recorded_track", track_id, trip_id, lambda s, sub: tracks.get_recorded_track(trip_id, track_id, s, sub), lambda x: _model(x, schemas.RecordedTrackResponse))

    def get_broad_route(self, trip_id: str, route_id: str) -> dict[str, Any]:
        """Read one authored broad route."""
        return self._call("broad_route.get", "broad_route", route_id, trip_id, lambda s, sub: tracks.get_broad_route(trip_id, route_id, s, sub), lambda x: _model(x, schemas.BroadRouteResponse))

    def get_media(self, trip_id: str, media_id: str) -> dict[str, Any]:
        """Read metadata and the owner-authorized delivery URL for one media asset."""
        return self._call("media.get", "media_asset", media_id, trip_id, lambda s, sub: media.get_media(trip_id, media_id, s, sub), lambda x: _model(x, schemas.MediaAssetResponse))

    def get_document(self, trip_id: str, document_id: str) -> dict[str, Any]:
        """Read metadata and the owner-authorized delivery URL for one trip document."""
        return self._call("document.get", "document_asset", document_id, trip_id, lambda s, sub: documents.get_document(trip_id, document_id, s, sub), lambda x: _model(x, schemas.DocumentAssetResponse))

    def get_library_document(self, document_id: str) -> dict[str, Any]:
        """Read metadata and the owner-authorized delivery URL for one library document."""
        return self._call("library_document.get", "library_document", document_id, None, lambda s, sub: library.get_library_document(document_id, s, sub), lambda x: _model(x, schemas.OwnerDocumentResponse))

    def get_emergency_info_entry(self, entry_id: str) -> dict[str, Any]:
        """Read one owner-only emergency-information entry."""
        return self._call("emergency_info.get", "emergency_info", entry_id, None, lambda s, sub: library.get_emergency_info_entry(entry_id, s, sub), lambda x: _model(x, schemas.EmergencyInfoEntryResponse))

    def preview_public_navigation(self, trip_id: str, local_id: str) -> dict[str, Any]:
        """Verify an opaque public-preview navigation marker and return its destination."""
        return self._call("public_projection.preview_navigation", "public_surface", local_id, trip_id, lambda s, sub: publication.preview_public_navigation(trip_id, local_id, s, sub), lambda x: json.loads(x.body))

    def preview_share_navigation(self, trip_id: str, link_id: str, local_id: str) -> dict[str, Any]:
        """Verify an opaque named-link preview navigation marker and return its destination."""
        return self._call("share_link.preview_navigation", "share_link", link_id, trip_id, lambda s, sub: publication.preview_share_navigation(trip_id, link_id, local_id, s, sub), lambda x: json.loads(x.body))

    def inspect_public_preview_file(self, trip_id: str, local_id: str) -> dict[str, str | None]:
        """Verify that a scoped public-preview file is deliverable without returning its bytes."""
        return self._call("public_projection.preview_file", "public_surface", local_id, trip_id, lambda s, sub: publication.preview_public_file(trip_id, local_id, s, sub, get_storage()), lambda x: {"content_type": x.media_type, "cache_control": x.headers.get("cache-control")})

    def inspect_share_preview_file(self, trip_id: str, link_id: str, local_id: str) -> dict[str, str | None]:
        """Verify that a scoped named-link preview file is deliverable without returning its bytes."""
        return self._call("share_link.preview_file", "share_link", link_id, trip_id, lambda s, sub: publication.preview_share_file(trip_id, link_id, local_id, s, sub, get_storage()), lambda x: {"content_type": x.media_type, "cache_control": x.headers.get("cache-control")})


class ToolFailureMiddleware(Middleware):
    """Turn every failure that would surface as a bare protocol error into a correlated tool error.

    FastMCP reports a pydantic error raised by a tool body as ``-32602 Invalid
    request parameters`` and any other unexpected failure as a generic
    ``-32603``; neither names the tool or can be found in the server logs.
    This maps them to an ``isError`` result carrying the MCP request id, logs
    the same id, and audits calls that were refused before ``_call`` ran (for
    example invalid arguments). Only names, types and field paths are logged.
    """

    def __init__(self, backend: TravelMcpBackend) -> None:
        self.backend = backend

    async def on_call_tool(self, context: MiddlewareContext[Any], call_next: Callable[..., Any]) -> Any:
        try:
            return await call_next(context)
        except (NotFoundError, DisabledError):
            raise
        except Exception as error:
            tool = context.message.name
            request_id = _request_id()
            audited = getattr(error, _AUDITED, False) or getattr(error.__cause__, _AUDITED, False)
            if not audited:
                await anyio.to_thread.run_sync(
                    self.backend._audit_unexecuted_rejection, tool, context.message.arguments, error
                )
            if isinstance(error, ValidationError):
                fields = _validation_fields(error)
                logger.warning("MCP tool %s failed validation request_id=%s fields=%s", tool, request_id, fields)
                raise ToolError(
                    f"{tool} failed validation ({fields}); the stored or generated data did not match the API schema. "
                    f"Reference: {request_id}"
                ) from None
            if isinstance(error, FastMCPError):
                raise ToolError(f"{error} Reference: {request_id}") from error
            logger.error("MCP tool %s failed request_id=%s error=%s", tool, request_id, type(error).__name__)
            raise ToolError(f"{tool} hit an unexpected {type(error).__name__}. Reference: {request_id}") from None


_TOOL_NAMES = tuple(name for name in TravelMcpBackend.__dict__ if not name.startswith("_") and callable(getattr(TravelMcpBackend, name)))

# Version of the cross-app capability manifest contract shared by the Travel,
# Worktime, Champagnefestival and Daynest `/api/mcp/capabilities` endpoints
# (tjorim/apps#229). Each tool reports `effect`, `requires_confirmation` and an
# app-specific `access` object; Travel has one owner-only policy, so `access` is
# empty rather than an invented per-tool tier.
MCP_CAPABILITY_CONTRACT_VERSION = 1

# One authoritative manifest serves registration and FastAPI discovery, so an
# operator can inspect exactly the tools mounted at /mcp without maintaining a
# second hand-written list. `effect` is intentionally a small safety signal,
# not an authorization mechanism.
MCP_TOOL_CAPABILITIES: dict[str, dict[str, Literal["read", "write"] | bool]] = {
    name: {
        "effect": "read" if name.startswith(("get_", "list_", "search_", "reverse_", "preview_", "inspect_", "suggest_", "whoami")) else "write",
        "requires_confirmation": name.startswith(("delete_", "revoke_", "unpublish_", "publish_", "set_"))
        or name in {"create_share_link", "update_share_link", "activate_share_link", "rotate_share_link", "approve_media_derivative", "approve_document_derivative", "complete_media_import_session"},
    }
    for name in _TOOL_NAMES
}


# Write tools that only add data or advance a state (draft -> active, pending ->
# approved); none replaces data that already exists.  MCP's ``destructiveHint``
# means "may delete or overwrite", so anything absent from this set (every
# ``update_*``, ``delete_*``, ``revoke_*``/``unpublish_*``,
# ``set_public_projection_scope`` and ``rotate_share_link``, which revokes the
# current capability, plus any future unclassified tool) is destructive.
_ADDITIVE_WRITE_TOOLS = frozenset(
    {name for name in _TOOL_NAMES if name.startswith("create_")}
    | {
        "save_exact_place",
        "save_broad_place",
        "upload_media",
        "upload_document",
        "upload_library_document",
        "upload_finished_track",
        "add_document_derivative",
        "approve_media_derivative",
        "approve_document_derivative",
        "activate_share_link",
        "publish_public_projection",
        "start_media_import_session",
        "complete_media_import_session",
        "mark_task_alert_read",
    }
)

# Tools that call an external service (the place-search provider, media import
# providers), so their effect is not confined to Travel's own data.
_OPEN_WORLD_TOOLS = frozenset(
    {"search_places", "reverse_geocode_place", "start_media_import_session", "complete_media_import_session"}
)


def _tool_annotations(name: str) -> ToolAnnotations:
    capability = MCP_TOOL_CAPABILITIES[name]
    read = capability["effect"] == "read"
    return ToolAnnotations(
        read_only_hint=read,
        destructive_hint=False if read else name not in _ADDITIVE_WRITE_TOOLS,
        idempotent_hint=read,
        open_world_hint=name in _OPEN_WORLD_TOOLS,
    )


def create_mcp_server(factory: sessionmaker[Session] = SessionLocal) -> FastMCP:
    """Create Travel's MCP server with OIDC verification when configured."""
    auth = None
    if settings.oidc_issuer_url and settings.mcp_base_url:
        auth = KeycloakAuthProvider(realm_url=settings.oidc_issuer_url, base_url=settings.mcp_base_url, audience=settings.oidc_audience)
    server = FastMCP("travel", version="0.1.0", instructions="Private Travel owner-management tools. Review previews before confirmed audience, publication, or deletion actions.", auth=auth)
    backend = TravelMcpBackend(factory)
    server.add_middleware(ToolFailureMiddleware(backend))
    for name in MCP_TOOL_CAPABILITIES:
        server.tool(name=name, annotations=_tool_annotations(name))(getattr(backend, name))
    return server


def mcp_http_enabled() -> bool:
    """Whether this process has enough deployment configuration to mount MCP.

    Never mount an unauthenticated HTTP MCP endpoint. Local stdio remains
    development-only and is started explicitly through ``main()`` below.
    """
    return bool(settings.mcp_base_url and settings.oidc_issuer_url)


def create_mcp_http_app(
    factory: sessionmaker[Session] = SessionLocal, **http_app_kwargs: Any
) -> tuple[FastMCP, StarletteWithLifespan]:
    """Create the authenticated, stateless HTTP app mounted by FastAPI.

    Keeping this factory beside ``create_mcp_server`` mirrors Worktime's
    pattern and prevents application startup from accidentally mounting an
    unauthenticated FastMCP instance.
    """
    if not mcp_http_enabled():
        raise RuntimeError("MCP HTTP requires TRAVEL_MCP_BASE_URL and TRAVEL_OIDC_ISSUER_URL")
    server = create_mcp_server(factory)
    return server, server.http_app(path="/", stateless_http=True, **http_app_kwargs)


def main() -> None:
    """Run the authenticated local stdio MCP server."""
    create_mcp_server().run()


if __name__ == "__main__":
    main()
