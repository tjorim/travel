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
import time
from collections.abc import Callable, Sequence
from io import BytesIO
from typing import Any, Literal, TypeVar
from urllib.parse import quote

import anyio.to_thread
from fastapi import FastAPI, HTTPException, Response
from fastapi.datastructures import UploadFile
from fastapi.encoders import jsonable_encoder
from fastmcp import FastMCP
from fastmcp.exceptions import DisabledError, FastMCPError, NotFoundError, ToolError
from fastmcp.exceptions import ValidationError as ArgumentValidationError
from fastmcp.server.auth.providers.keycloak import KeycloakAuthProvider
from fastmcp.server.dependencies import get_access_token, get_context
from fastmcp.server.http import StarletteWithLifespan
from fastmcp.server.middleware import Middleware, MiddlewareContext
from fastmcp.server.transforms.search import BM25SearchTransform
from fastmcp.tools.base import Tool
from mcp.types import ToolAnnotations
from pydantic import AnyHttpUrl, BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from starlette.middleware import Middleware as StarletteMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import schemas
from .config import settings
from .database import SessionLocal
from .models import DocumentKind, ImportProvider, McpAuditEvent, Visibility
from .routers import (
    areas,
    documents,
    library,
    locations,
    media,
    packing,
    places,
    publication,
    routes,
    stays,
    tasks,
    trips,
    visits,
)
from .routers import visibility as visibility_routes
from .secrets import get_secret_store
from .storage import get_storage

Result = TypeVar("Result")
logger = logging.getLogger(__name__)


class BinaryUpload(schemas.InputModel):
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


def _without_html(value: Any) -> Any:
    """Drop the rendered ``*_html`` fields: an MCP client reads and writes the Markdown source."""
    if isinstance(value, dict):
        return {key: _without_html(item) for key, item in value.items() if not key.endswith("_html")}
    if isinstance(value, list):
        return [_without_html(item) for item in value]
    return value


def _model(value: Any, model_type: type[BaseModel] | None = None) -> Any:
    """Serialize only the declared API representation, never ORM internals."""
    if model_type is None:
        return jsonable_encoder(value)
    return _without_html(model_type.model_validate(value).model_dump(mode="json"))


def _models(values: list[Any], model_type: type[BaseModel]) -> list[dict[str, Any]]:
    return [_model(value, model_type) for value in values]


# The fields a compact list row keeps: enough to recognise a record and pass its
# ids on, without repeating every embedded area and location in full. ``get_*``
# returns the complete record.
_COMPACT_FIELDS = {
    "area": ("id", "label", "country_code", "region", "timezone", "visibility"),
    "location": ("id", "label", "display_name", "locality", "area_id", "visibility"),
    "visit": (
        "id",
        "position",
        "title",
        "kind",
        "status",
        "starts_on",
        "ends_on",
        "start_time",
        "end_time",
        "visibility",
    ),
    "stay": ("id", "check_in_date", "check_out_date", "status", "property_name", "visibility"),
    "route": (
        "id",
        "mode",
        "status",
        "label",
        "departs_on",
        "departs_at",
        "arrives_at",
        "departure_timezone",
        "arrival_timezone",
        "carrier",
        "service_reference",
        "travel_class",
        "visibility",
    ),
}


def _compact(kind: str, row: dict[str, Any]) -> dict[str, Any]:
    """Reduce one serialized row to ids and labels, naming its area and location by id and label only."""
    compact = {field: row[field] for field in _COMPACT_FIELDS[kind]}
    for prefix, area, location in (
        ("", "area", "location"),
        ("departure_", "departure_area", "departure_location"),
        ("arrival_", "arrival_area", "arrival_location"),
    ):
        if area in row:
            compact[f"{prefix}area"] = {"id": row[area]["id"], "label": row[area]["label"]}
        if location in row:
            place = row[location]
            compact[f"{prefix}location_id"] = place["id"] if place else None
    if kind == "route":
        compact["has_geometry"] = row["geometry"] is not None
    return compact


def _listed(kind: str, model_type: type[BaseModel], compact: bool) -> Callable[[list[Any]], list[dict[str, Any]]]:
    def render(values: list[Any]) -> list[dict[str, Any]]:
        rows = _models(values, model_type)
        return [_compact(kind, row) for row in rows] if compact else rows

    return render


class BatchCreate(schemas.InputModel):
    """Records to add to one trip in a single all-or-nothing call, created in this order.

    Each list item takes exactly the payload of its single ``create_*`` tool.
    """

    visits: list[schemas.VisitCreate] = Field(default_factory=list, max_length=100)
    stays: list[schemas.StayCreate] = Field(default_factory=list, max_length=100)
    routes: list[schemas.RouteCreate] = Field(default_factory=list, max_length=100)
    travel_updates: list[schemas.TravelUpdateCreate] = Field(default_factory=list, max_length=100)
    trip_tasks: list[schemas.TripTaskCreate] = Field(default_factory=list, max_length=100)


def _share_url(token: str) -> str:
    """Build the visitor URL that corresponds to an unlisted capability.

    MCP has no browser request or current page URL, so this must use the
    configured visitor PWA origin rather than returning a relative path or an
    API URL.  The token is URL-safe today, but quote it defensively because it
    is a capability and must remain one path segment.
    """
    return f"{str(settings.public_app_url).rstrip('/')}/share/{quote(token, safe='')}"


_AUDITED = "_travel_mcp_audited"
# Set on the tool error ToolFailureMiddleware reports, so the ``call_tool``
# proxy passes an inner tool's report on instead of auditing it again.
_REPORTED = "_travel_mcp_reported"


def _reported(error: ToolError) -> ToolError:
    setattr(error, _REPORTED, True)
    return error


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
    # FastMCP wraps an invalid-argument error, whose message echoes the rejected values.
    cause = error if isinstance(error, ValidationError) else error.__cause__
    if isinstance(cause, ValidationError):
        return f"Validation failed ({_validation_fields(cause)})"[:240]
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
            raise ValueError(
                "Set confirm=true after reviewing the preview or target; this operation changes access or deletes data"
            )

    def _audit(
        self,
        session: Session,
        *,
        subject: str,
        action: str,
        resource_type: str,
        resource_id: str | None,
        trip_id: str | None,
        result: str,
        detail: str | None = None,
        request_id: str | None = None,
    ) -> None:
        # Payloads and raw exception traces deliberately never become audit data.
        details = {"error": detail} if detail else {}
        if request_id:
            details["request_id"] = request_id
        session.add(
            McpAuditEvent(
                owner_subject=subject,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                trip_id=trip_id,
                result=result,
                details=details,
            )
        )
        session.commit()

    def _record_audit(
        self,
        *,
        subject: str,
        action: str,
        resource_type: str,
        resource_id: str | None,
        trip_id: str | None,
        result: str,
        detail: str | None = None,
        request_id: str | None = None,
    ) -> None:
        try:
            with self.factory() as session:
                self._audit(
                    session,
                    subject=subject,
                    action=action,
                    resource_type=resource_type,
                    resource_id=resource_id,
                    trip_id=trip_id,
                    result=result,
                    detail=detail,
                    request_id=request_id,
                )
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
            subject=subject,
            action=tool,
            resource_type="tool_invocation",
            resource_id=None,
            trip_id=trip_id if isinstance(trip_id, str) and len(trip_id) <= 32 else None,
            result="rejected",
            detail=_error_summary(error),
            request_id=_request_id(),
        )

    def _reject(
        self,
        error: Exception,
        subject: str,
        action: str,
        resource_type: str,
        resource_id: str | None,
        trip_id: str | None,
        request_id: str | None,
    ) -> None:
        summary = _error_summary(error)
        logger.warning(
            "MCP tool %s rejected request_id=%s error=%s: %s", action, request_id, type(error).__name__, summary
        )
        self._record_audit(
            subject=subject,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            trip_id=trip_id,
            result="rejected",
            detail=summary,
            request_id=request_id,
        )

    def _call(
        self,
        action: str,
        resource_type: str,
        resource_id: str | None,
        trip_id: str | None,
        operation: Callable[[Session, str], Result],
        output: Callable[[Result], Any] = jsonable_encoder,
        *,
        confirm: bool = True,
        needs_confirmation: bool = False,
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
        self._record_audit(
            subject=subject,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            trip_id=trip_id,
            result="succeeded",
            request_id=request_id,
        )
        return rendered

    # Identity and audit -------------------------------------------------
    def whoami(self) -> dict[str, str]:
        """Show the authenticated owner subject; no token material is returned."""
        subject = self._subject()
        return {"subject": subject, "role": "owner"}

    def list_mcp_audit_events(self, limit: int = Field(default=50, ge=1, le=200)) -> list[dict[str, Any]]:
        """Read this owner's bounded MCP invocation history, newest first."""
        return self._call(
            "mcp_audit.list",
            "mcp_audit_event",
            None,
            None,
            lambda s, subject: list(
                s.scalars(
                    select(McpAuditEvent)
                    .where(McpAuditEvent.owner_subject == subject)
                    .order_by(McpAuditEvent.occurred_at.desc())
                    .limit(limit)
                )
            ),
            lambda rows: [_model(row) for row in rows],
        )

    # Trips and travel updates ------------------------
    def list_trips(self) -> list[dict[str, Any]]:
        """List the caller's private trips and their owner-only editing context."""
        return self._call(
            "trip.list",
            "trip",
            None,
            None,
            lambda s, sub: trips.list_trips(s, sub),
            lambda x: _models(x, schemas.TripResponse),
        )

    def create_trip(self, payload: schemas.TripCreate) -> dict[str, Any]:
        """Create a private trip."""
        return self._call(
            "trip.create",
            "trip",
            None,
            None,
            lambda s, sub: trips.create_trip(payload, s, sub),
            lambda x: _model(x, schemas.TripResponse),
        )

    def get_trip(self, trip_id: str) -> dict[str, Any]:
        """Read one owned trip."""
        return self._call(
            "trip.get",
            "trip",
            trip_id,
            trip_id,
            lambda s, sub: trips.get_trip(trip_id, s, sub),
            lambda x: _model(x, schemas.TripResponse),
        )

    def get_trip_overview(self, trip_id: str) -> dict[str, Any]:
        """Check a trip in one read: counts per kind, including visits_undated and routes_undated (to compare with a source such as an archive file), visibility per kind, what the public page and each draft or active link receive, and warnings to review before sharing (an active audience receiving nothing, shared trip dates, planning words like "concept" in a visible label, records without a map point because their area is not shared, undated visits duplicating dated ones)."""
        return self._call(
            "trip.overview",
            "trip",
            trip_id,
            trip_id,
            lambda s, sub: trips.get_trip_overview(trip_id, s, sub),
            lambda x: _model(x, schemas.TripOverviewResponse),
        )

    def batch_create(self, trip_id: str, payload: BatchCreate) -> dict[str, list[dict[str, Any]]]:
        """Create several visits, stays, routes, reisupdates and tasks at once in an existing trip, in one call. All or nothing: if any record is refused, none is kept and the error names it (for example routes[3]). Returns compact rows with the new ids."""
        steps: list[tuple[str, str, Callable[[Session, str, Any], Any], type[BaseModel]]] = [
            ("visits", "visit", lambda s, sub, item: visits.create_visit(trip_id, item, s, sub), schemas.VisitResponse),
            ("stays", "stay", lambda s, sub, item: stays.create_stay(trip_id, item, s, sub), schemas.StayResponse),
            ("routes", "route", lambda s, sub, item: routes.create_route(trip_id, item, s, sub), schemas.RouteResponse),
            (
                "travel_updates",
                "",
                lambda s, sub, item: trips.create_travel_update(trip_id, item, s, sub),
                schemas.TravelUpdateResponse,
            ),
            (
                "trip_tasks",
                "",
                lambda s, sub, item: tasks.create_trip_task(trip_id, item, s, sub),
                schemas.TripTaskResponse,
            ),
        ]

        def operation(session: Session, subject: str) -> dict[str, list[dict[str, Any]]]:
            # The domain handlers commit each record. Inside a batch a commit
            # only flushes, so ``_call`` commits everything at the end, or the
            # closing session rolls all of it back when one record is refused.
            session.commit = session.flush  # type: ignore[method-assign]
            created: dict[str, list[dict[str, Any]]] = {}
            try:
                for field, kind, create, model_type in steps:
                    rows = []
                    for index, item in enumerate(getattr(payload, field)):
                        try:
                            row = _model(create(session, subject, item), model_type)
                        except HTTPException as error:
                            raise HTTPException(
                                error.status_code, f"{field}[{index}]: {error.detail}. Nothing was created."
                            ) from error
                        rows.append(_compact(kind, row) if kind else {"id": row["id"], "title": row["title"]})
                    if rows:
                        created[field] = rows
            finally:
                del session.commit  # the class's real commit again
            return created

        return self._call("trip.batch_create", "trip", trip_id, trip_id, operation, lambda x: x)

    def update_trip(self, trip_id: str, payload: schemas.TripUpdate) -> dict[str, Any]:
        """Update an owned trip's private metadata."""
        return self._call(
            "trip.update",
            "trip",
            trip_id,
            trip_id,
            lambda s, sub: trips.update_trip(trip_id, payload, s, sub),
            lambda x: _model(x, schemas.TripResponse),
        )

    def delete_trip(self, trip_id: str, confirm: bool = False) -> dict[str, str]:
        """Permanently delete an owned trip after explicit confirmation."""
        return self._call(
            "trip.delete",
            "trip",
            trip_id,
            trip_id,
            lambda s, sub: trips.delete_trip(trip_id, s, sub),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def list_visits(self, trip_id: str, compact: bool = True) -> list[dict[str, Any]]:
        """List the trip's visits (stops) in order. Compact rows name the area and location by id; pass compact=false, or use get_visit, for the full records."""
        return self._call(
            "visit.list",
            "visit",
            None,
            trip_id,
            lambda s, sub: visits.list_visits(trip_id, s, sub),
            _listed("visit", schemas.VisitResponse, compact),
        )

    def get_visit(self, trip_id: str, visit_id: str) -> dict[str, Any]:
        """Read one visit."""
        return self._call(
            "visit.get",
            "visit",
            visit_id,
            trip_id,
            lambda s, sub: visits.get_visit(trip_id, visit_id, s, sub),
            lambda x: _model(x, schemas.VisitResponse),
        )

    def create_visit(self, trip_id: str, payload: schemas.VisitCreate) -> dict[str, Any]:
        """Create a visit: an area, or a location in one, with optional days, times, kind and notes. The visit status (idea, planned, confirmed or cancelled) is owner-only and never shared: keep planning state there, not in a title or area label, and cancel a rejected idea instead of deleting it. A cancelled visit can never be shared. Times stay private unless share_time is set. Visits replace the archive's route stages and day-plan steps; summary is the visitor text (a highlight). notes and summary are Markdown."""
        return self._call(
            "visit.create",
            "visit",
            None,
            trip_id,
            lambda s, sub: visits.create_visit(trip_id, payload, s, sub),
            lambda x: _model(x, schemas.VisitResponse),
        )

    def update_visit(self, trip_id: str, visit_id: str, payload: schemas.VisitUpdate) -> dict[str, Any]:
        """Edit or reorder a visit."""
        return self._call(
            "visit.update",
            "visit",
            visit_id,
            trip_id,
            lambda s, sub: visits.update_visit(trip_id, visit_id, payload, s, sub),
            lambda x: _model(x, schemas.VisitResponse),
        )

    def delete_visit(self, trip_id: str, visit_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete a visit after explicit confirmation."""
        return self._call(
            "visit.delete",
            "visit",
            visit_id,
            trip_id,
            lambda s, sub: visits.delete_visit(trip_id, visit_id, s, sub),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def create_travel_update(self, trip_id: str, payload: schemas.TravelUpdateCreate) -> dict[str, Any]:
        """Create a travel update, a new reisupdate (reisupdate schrijven): private notes, location and attached media stay private; the title, text, date and area are shared only as its visibility allows. Reisupdates replace the archive's story moments and excerpts: body is the visitor text. body and private_notes are Markdown."""
        return self._call(
            "travel_update.create",
            "travel_update",
            None,
            trip_id,
            lambda s, sub: trips.create_travel_update(trip_id, payload, s, sub),
            lambda x: _model(x, schemas.TravelUpdateResponse),
        )

    def update_travel_update(self, trip_id: str, update_id: str, payload: schemas.TravelUpdatePatch) -> dict[str, Any]:
        """Edit a reisupdate, including who may see it (private, everyone or custom)."""
        return self._call(
            "travel_update.update",
            "travel_update",
            update_id,
            trip_id,
            lambda s, sub: trips.update_travel_update(trip_id, update_id, payload, s, sub),
            lambda x: _model(x, schemas.TravelUpdateResponse),
        )

    def delete_travel_update(self, trip_id: str, update_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete a reisupdate after explicit confirmation."""
        return self._call(
            "travel_update.delete",
            "travel_update",
            update_id,
            trip_id,
            lambda s, sub: trips.delete_travel_update(trip_id, update_id, s, sub),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    # Areas and locations ---------------------------------------------------
    def search_places(self, trip_id: str, payload: schemas.PlaceSearchRequest) -> dict[str, Any]:
        """Explicitly search the configured owner-only place provider; this never saves a place."""
        from .places.search import get_place_search_service

        return self._call(
            "place.search",
            "place_search",
            None,
            trip_id,
            lambda s, sub: places.search_places(trip_id, payload, s, sub, get_place_search_service()),
            lambda x: _model(x, schemas.PlaceSearchResponse),
        )

    def reverse_geocode_place(self, trip_id: str, payload: schemas.PlaceReverseGeocodeRequest) -> dict[str, Any]:
        """Explicitly request a coordinate-to-place suggestion; this never writes canonical data."""
        from .places.search import get_place_search_service

        return self._call(
            "place.reverse",
            "place_search",
            None,
            trip_id,
            lambda s, sub: places.reverse_geocode_place(trip_id, payload, s, sub, get_place_search_service()),
            lambda x: _model(x, schemas.PlaceSearchResponse),
        )

    def list_locations(self, trip_id: str, compact: bool = True) -> list[dict[str, Any]]:
        """List owner-only locations. Compact rows keep the ids, names and area id; pass compact=false for addresses, coordinates and provider fields."""
        return self._call(
            "location.list",
            "location",
            None,
            trip_id,
            lambda s, sub: locations.list_locations(trip_id, s, sub),
            _listed("location", schemas.LocationResponse, compact),
        )

    def save_location(self, trip_id: str, payload: schemas.LocationInput) -> dict[str, Any]:
        """Save a selected location for this trip."""
        return self._call(
            "location.create",
            "location",
            None,
            trip_id,
            lambda s, sub: locations.save_location(trip_id, payload, s, sub),
            lambda x: _model(x, schemas.LocationResponse),
        )

    def list_areas(self, trip_id: str, query: str | None = None, compact: bool = True) -> list[dict[str, Any]]:
        """List areas: the cities and regions you authored. query keeps only areas whose label contains it (case-insensitive), to find an area id by name. Pass compact=false for coordinates."""

        def found(values: list[Any]) -> list[Any]:
            needle = (query or "").strip().casefold()
            return [area for area in values if needle in area.label.casefold()]

        return self._call(
            "area.list",
            "area",
            None,
            trip_id,
            lambda s, sub: found(areas.list_areas(trip_id, s, sub)),
            _listed("area", schemas.AreaResponse, compact),
        )

    def suggest_area(self, trip_id: str, payload: schemas.AreaSuggestRequest) -> dict[str, Any]:
        """Suggest a nearby area or a new generalized area from coordinates; never saves it."""
        from .places.search import get_place_search_service

        return self._call(
            "area.suggest",
            "area",
            None,
            trip_id,
            lambda s, sub: areas.suggest_area(trip_id, payload, s, sub, get_place_search_service()),
            lambda x: _model(x, schemas.AreaSuggestion),
        )

    def save_area(self, trip_id: str, payload: schemas.AreaInput) -> dict[str, Any]:
        """Save an area without making it public."""
        return self._call(
            "area.create",
            "area",
            None,
            trip_id,
            lambda s, sub: areas.save_area(trip_id, payload, s, sub),
            lambda x: _model(x, schemas.AreaResponse),
        )

    def update_area(self, trip_id: str, area_id: str, payload: schemas.AreaUpdate) -> dict[str, Any]:
        """Edit an area, for example to set its IANA time zone."""
        return self._call(
            "area.update",
            "area",
            area_id,
            trip_id,
            lambda s, sub: areas.update_area(trip_id, area_id, payload, s, sub),
            lambda x: _model(x, schemas.AreaResponse),
        )

    def delete_area(self, trip_id: str, area_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete an unused area after explicit confirmation. Refused while a visit, reisupdate, location or route still uses it: move or merge those first."""
        return self._call(
            "area.delete",
            "area",
            area_id,
            trip_id,
            lambda s, sub: areas.delete_area(trip_id, area_id, s, sub),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def merge_areas(
        self, trip_id: str, keep_id: str, duplicate_ids: list[str], confirm: bool = False
    ) -> dict[str, Any]:
        """Fold duplicate areas into keep_id: every location, visit, route end and reisupdate filed under a duplicate moves to keep_id (stays follow their location), then the duplicates are deleted, in one transaction. keep_id keeps its label, point, time zone and visibility. Without confirm=true it only previews the counts per duplicate, warns when a duplicate reaches an audience the kept area does not, and lists city_level_location_ids: locations that only name the city and would then be duplicates, to fold with merge_locations afterwards. Review that preview, then repeat with confirm=true."""
        payload = schemas.MergeRequest(keep_id=keep_id, duplicate_ids=duplicate_ids, confirm=confirm)
        return self._call(
            "area.merge" if confirm else "area.merge_preview",
            "area",
            keep_id,
            trip_id,
            lambda s, sub: areas.merge_areas(trip_id, payload, s, sub),
        )

    def delete_location(self, trip_id: str, location_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete an unused location after explicit confirmation. Refused, naming what still uses it, while a visit, stay, route or reisupdate points at it; use merge_locations to fold a duplicate into another location instead."""
        return self._call(
            "location.delete",
            "location",
            location_id,
            trip_id,
            lambda s, sub: locations.delete_location(trip_id, location_id, s, sub),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def merge_locations(
        self, trip_id: str, keep_id: str, duplicate_ids: list[str], confirm: bool = False
    ) -> dict[str, Any]:
        """Merge duplicate locations (locaties samenvoegen) into keep_id: every visit, stay, route end and reisupdate at a duplicate moves to keep_id, then the duplicates are deleted, in one transaction. Without confirm=true it only previews the counts per duplicate and warns when a duplicate reaches an audience the kept location does not (the merge keeps keep_id's name, visibility and area). Review that preview, then repeat with confirm=true."""
        payload = schemas.MergeRequest(keep_id=keep_id, duplicate_ids=duplicate_ids, confirm=confirm)
        return self._call(
            "location.merge" if confirm else "location.merge_preview",
            "location",
            keep_id,
            trip_id,
            lambda s, sub: locations.merge_locations(trip_id, payload, s, sub),
        )

    def update_location(self, trip_id: str, location_id: str, payload: schemas.LocationUpdate) -> dict[str, Any]:
        """Give a location its public name (a location cannot be shared without one), move it to another area (its routes and visits move along), or geocode it in place: after search_places, verify the match and send its latitude and longitude, viewport edges, osm_element_type and osm_element_id (the OSM link follows the element) and navigation provider fields. The id and every visit, stay, route end and reisupdate keep pointing at it; area, label and visibility never change. Omitted fields keep their value and null clears one; latitude/longitude, the four viewport edges and the OSM type/id are each set or cleared together. Moving an existing point needs the new place's OSM, viewport and provider fields too (null the ones that no longer apply), and a shared location must be made private first, because a shared location publishes its point."""
        return self._call(
            "location.update",
            "location",
            location_id,
            trip_id,
            lambda s, sub: locations.update_location(trip_id, location_id, payload, s, sub),
            lambda x: _model(x, schemas.LocationResponse),
        )

    def set_visibility(
        self, trip_id: str, kind: schemas.ShareScopeKind, record_id: str, visibility: Visibility, confirm: bool = False
    ) -> dict[str, Any]:
        """Choose who can see one record (its zichtbaarheid): private, everyone, or custom (only audiences that list it)."""
        kind, visibility = schemas.ShareScopeKind(kind), Visibility(visibility)
        return self._call(
            "visibility.set",
            kind.value,
            record_id,
            trip_id,
            lambda s, sub: visibility_routes.put_visibility(
                trip_id, kind, record_id, schemas.VisibilityUpdate(visibility=visibility), s, sub
            ),
            lambda x: _model(x, schemas.VisibilityUpdate),
            confirm=confirm,
            needs_confirmation=True,
        )

    # Publication, previews, share capabilities -------------------------
    def get_public_projection_status(self, trip_id: str) -> dict[str, Any]:
        """Read the public-surface state and current explicit scope."""
        return self._call(
            "public_projection.get",
            "public_surface",
            trip_id,
            trip_id,
            lambda s, sub: publication.get_public_projection_status(trip_id, s, sub),
            lambda x: _model(x, schemas.PublicProjectionStatusResponse),
        )

    def preview_public_projection(self, trip_id: str) -> dict[str, Any]:
        """Preview what publishing the trip publicly would show: render the live public projection for owner review without publishing it."""
        return self._call(
            "public_projection.preview",
            "public_surface",
            trip_id,
            trip_id,
            lambda s, sub: publication.preview_public_projection(trip_id, s, sub, Response()),
            lambda x: _model(x, schemas.ProjectionDocument),
        )

    def set_public_projection_scope(
        self, trip_id: str, payload: schemas.ShareScopeInput, confirm: bool = False
    ) -> dict[str, Any]:
        """Replace the live public scope after explicit owner confirmation."""
        return self._call(
            "public_projection.scope",
            "public_surface",
            trip_id,
            trip_id,
            lambda s, sub: publication.set_public_projection_scope(trip_id, payload, s, sub),
            lambda x: _model(x, schemas.PublicProjectionStatusResponse),
            confirm=confirm,
            needs_confirmation=True,
        )

    def publish_public_projection(self, trip_id: str, confirm: bool = False) -> dict[str, Any]:
        """Publish the trip publicly: start public delivery only after an explicit confirmation."""
        return self._call(
            "public_projection.publish",
            "public_surface",
            trip_id,
            trip_id,
            lambda s, sub: publication.publish_public_projection(trip_id, s, sub),
            lambda x: _model(x, schemas.PublicProjectionStatusResponse),
            confirm=confirm,
            needs_confirmation=True,
        )

    def unpublish_public_projection(
        self, trip_id: str, reason: str | None = None, confirm: bool = False
    ) -> dict[str, Any]:
        """Stop public delivery only after explicit confirmation."""
        return self._call(
            "public_projection.unpublish",
            "public_surface",
            trip_id,
            trip_id,
            lambda s, sub: publication.unpublish_public_projection(
                trip_id, s, sub, schemas.AuditReasonInput(reason=reason)
            ),
            lambda x: _model(x, schemas.PublicProjectionStatusResponse),
            confirm=confirm,
            needs_confirmation=True,
        )

    def list_share_links(self, trip_id: str) -> list[dict[str, Any]]:
        """List named share links without returning any capability token."""
        return self._call(
            "share_link.list",
            "share_link",
            None,
            trip_id,
            lambda s, sub: publication.list_share_links(trip_id, s, sub),
            lambda x: _models(x, schemas.ShareLinkResponse),
        )

    def create_share_link(
        self, trip_id: str, payload: schemas.ShareLinkCreate, confirm: bool = False
    ) -> dict[str, Any]:
        """Create a draft named share link after reviewing its audience scope."""
        return self._call(
            "share_link.create",
            "share_link",
            None,
            trip_id,
            lambda s, sub: publication.create_share_link(trip_id, payload, s, sub),
            lambda x: _model(x, schemas.ShareLinkResponse),
            confirm=confirm,
            needs_confirmation=True,
        )

    def get_share_link(self, trip_id: str, link_id: str) -> dict[str, Any]:
        """Read one named link's state and scoped audience without a capability token."""
        return self._call(
            "share_link.get",
            "share_link",
            link_id,
            trip_id,
            lambda s, sub: publication.get_share_link(trip_id, link_id, s, sub),
            lambda x: _model(x, schemas.ShareLinkResponse),
        )

    def update_share_link(
        self, trip_id: str, link_id: str, payload: schemas.ShareLinkUpdate, confirm: bool = False
    ) -> dict[str, Any]:
        """Update a named link's label or live scope after explicit owner confirmation."""
        return self._call(
            "share_link.update",
            "share_link",
            link_id,
            trip_id,
            lambda s, sub: publication.update_share_link(trip_id, link_id, payload, s, sub),
            lambda x: _model(x, schemas.ShareLinkResponse),
            confirm=confirm,
            needs_confirmation=True,
        )

    def preview_share_link(self, trip_id: str, link_id: str) -> dict[str, Any]:
        """Render a named link's current projection for owner review; no token is minted."""
        return self._call(
            "share_link.preview",
            "share_link",
            link_id,
            trip_id,
            lambda s, sub: publication.preview_share_link(trip_id, link_id, s, sub, Response()),
            lambda x: _model(x, schemas.ProjectionDocument),
        )

    def activate_share_link(
        self, trip_id: str, link_id: str, payload: schemas.ShareLinkActivateRequest, confirm: bool = False
    ) -> dict[str, Any]:
        """Activate a reusable owner-managed URL and return its full visitor URL."""
        return self._call(
            "share_link.activate",
            "share_link",
            link_id,
            trip_id,
            lambda s, sub: publication.activate_share_link(trip_id, link_id, payload, s, sub),
            lambda x: {**_model(x, schemas.ShareLinkActivateResponse), "share_url": _share_url(x.token)},
            confirm=confirm,
            needs_confirmation=True,
        )

    def revoke_share_link(
        self, trip_id: str, link_id: str, reason: str | None = None, confirm: bool = False
    ) -> dict[str, Any]:
        """Immediately revoke a share capability after explicit confirmation."""
        return self._call(
            "share_link.revoke",
            "share_link",
            link_id,
            trip_id,
            lambda s, sub: publication.revoke_share_link(
                trip_id, link_id, schemas.AuditReasonInput(reason=reason), s, sub
            ),
            lambda x: _model(x, schemas.ShareLinkResponse),
            confirm=confirm,
            needs_confirmation=True,
        )

    def rotate_share_link(
        self, trip_id: str, link_id: str, payload: schemas.ShareLinkActivateRequest, confirm: bool = False
    ) -> dict[str, Any]:
        """Revoke the current capability and return a new full visitor URL after confirmation."""
        return self._call(
            "share_link.rotate",
            "share_link",
            link_id,
            trip_id,
            lambda s, sub: publication.rotate_share_link(trip_id, link_id, payload, s, sub),
            lambda x: {**_model(x, schemas.ShareLinkActivateResponse), "share_url": _share_url(x.token)},
            confirm=confirm,
            needs_confirmation=True,
        )

    def list_trip_audit_events(self, trip_id: str) -> list[dict[str, Any]]:
        """Read audience/publication lifecycle history for an owned trip."""
        return self._call(
            "audit_event.list",
            "audit_event",
            None,
            trip_id,
            lambda s, sub: publication.list_audit_events(trip_id, s, sub),
            lambda x: _models(x, schemas.AuditEventResponse),
        )

    # Media and document asset workflows --------------------------------
    def upload_media(self, trip_id: str, file: BinaryUpload) -> dict[str, Any]:
        """Import an owner-selected local media file through the validated storage pipeline."""
        return self._call(
            "media.upload",
            "media_asset",
            None,
            trip_id,
            lambda s, sub: media.upload_media(trip_id, s, sub, get_storage(), Response(), file.upload_file()),
            lambda x: _model(x, schemas.MediaAssetResponse),
        )

    def list_media(self, trip_id: str) -> list[dict[str, Any]]:
        """List owner-only media assets."""
        return self._call(
            "media.list",
            "media_asset",
            None,
            trip_id,
            lambda s, sub: media.list_media(trip_id, s, sub),
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
            lambda s, sub: media.suggest_travel_update_candidates(trip_id, payload, s, sub),
            lambda x: _model(x, schemas.MediaTravelUpdateCandidatesResponse),
        )

    def delete_media(self, trip_id: str, media_id: str, confirm: bool = False) -> dict[str, str]:
        """Soft-delete media after explicit confirmation."""
        return self._call(
            "media.delete",
            "media_asset",
            media_id,
            trip_id,
            lambda s, sub: media.remove_media(trip_id, media_id, s, sub),
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
            lambda s, sub: media.add_derivative(trip_id, media_id, payload, s, sub, get_storage()),
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
            lambda s, sub: media.approve_derivative(trip_id, media_id, derivative_id, s, sub),
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
            lambda s, sub: media.remove_derivative(trip_id, media_id, derivative_id, s, sub, get_storage()),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def upload_document(
        self, trip_id: str, title: str, document_kind: DocumentKind, file: BinaryUpload
    ) -> dict[str, Any]:
        """Upload an owner-only trip document via the application storage pipeline."""
        return self._call(
            "document.upload",
            "document_asset",
            None,
            trip_id,
            lambda s, sub: documents.upload_document(
                trip_id, s, sub, get_storage(), Response(), title, document_kind, file.upload_file()
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
            lambda s, sub: documents.list_documents(trip_id, s, sub),
            lambda x: _models(x, schemas.DocumentAssetResponse),
        )

    def delete_document(self, trip_id: str, document_id: str, confirm: bool = False) -> dict[str, str]:
        """Soft-delete a trip document after explicit confirmation."""
        return self._call(
            "document.delete",
            "document_asset",
            document_id,
            trip_id,
            lambda s, sub: documents.remove_document(trip_id, document_id, s, sub, get_storage()),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    # Owner-wide library -------------------------------------------------
    def list_library_documents(self, linked_trip_id: str | None = None) -> list[dict[str, Any]]:
        """List the owner's reusable private document library."""
        return self._call(
            "library_document.list",
            "library_document",
            None,
            linked_trip_id,
            lambda s, sub: library.list_library_documents(s, sub, linked_trip_id),
            lambda x: _models(x, schemas.OwnerDocumentResponse),
        )

    def list_emergency_info(self) -> list[dict[str, Any]]:
        """List owner-only emergency information (noodnummers): emergency numbers, contacts and medical notes."""
        return self._call(
            "emergency_info.list",
            "emergency_info",
            None,
            None,
            lambda s, sub: library.list_emergency_info(s, sub),
            lambda x: _models(x, schemas.EmergencyInfoEntryResponse),
        )

    def create_emergency_info(self, payload: schemas.EmergencyInfoEntryCreate) -> dict[str, Any]:
        """Create a private emergency-information entry. notes is Markdown."""
        return self._call(
            "emergency_info.create",
            "emergency_info",
            None,
            None,
            lambda s, sub: library.create_emergency_info(payload, s, sub),
            lambda x: _model(x, schemas.EmergencyInfoEntryResponse),
        )

    # Stays and preparation ----------------------
    def list_stays(self, trip_id: str, compact: bool = True) -> list[dict[str, Any]]:
        """List owner-only accommodation records. A stay with status idea is a candidate under comparison, not part of the plan. Compact rows name the area and location by id; pass compact=false, or use get_stay, for booking and contact details."""
        return self._call(
            "stay.list",
            "stay",
            None,
            trip_id,
            lambda s, sub: stays.list_stays(trip_id, s, sub),
            _listed("stay", schemas.StayResponse, compact),
        )

    def create_stay(self, trip_id: str, payload: schemas.StayCreate) -> dict[str, Any]:
        """Add a hotel or other accommodation stay (verblijf toevoegen), private, with check-in and check-out dates; omit local times until verified. While the accommodation is undecided, give only area_id instead of a location. notes is Markdown; contact_details is plain text whose phone numbers, email and web addresses are linked."""
        return self._call(
            "stay.create",
            "stay",
            None,
            trip_id,
            lambda s, sub: stays.create_stay(trip_id, payload, s, sub),
            lambda x: _model(x, schemas.StayResponse),
        )

    def update_stay(self, trip_id: str, stay_id: str, payload: schemas.StayUpdate) -> dict[str, Any]:
        """Update a private stay; set check_in_time/check_out_time to null to clear unverified times. Move the chosen candidate from idea to planned or confirmed and cancel or delete the rejected alternatives."""
        return self._call(
            "stay.update",
            "stay",
            stay_id,
            trip_id,
            lambda s, sub: stays.update_stay(trip_id, stay_id, payload, s, sub),
            lambda x: _model(x, schemas.StayResponse),
        )

    def delete_stay(self, trip_id: str, stay_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete an accommodation record after explicit confirmation."""
        return self._call(
            "stay.delete",
            "stay",
            stay_id,
            trip_id,
            lambda s, sub: stays.delete_stay(trip_id, stay_id, s, sub),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def list_packing_lists(self, trip_id: str) -> list[dict[str, Any]]:
        """List the trip's private packing lists."""
        return self._call(
            "packing_list.list",
            "packing_list",
            None,
            trip_id,
            lambda s, sub: packing.list_packing_lists(trip_id, s, sub),
            lambda x: _models(x, schemas.PackingListResponse),
        )

    def create_packing_list(self, trip_id: str, payload: schemas.PackingListCreate) -> dict[str, Any]:
        """Create a private packing list for a trip."""
        return self._call(
            "packing_list.create",
            "packing_list",
            None,
            trip_id,
            lambda s, sub: packing.create_packing_list(trip_id, payload, s, sub),
            lambda x: _model(x, schemas.PackingListResponse),
        )

    def get_packing_list(self, trip_id: str, list_id: str) -> dict[str, Any]:
        """Read one private packing list."""
        return self._call(
            "packing_list.get",
            "packing_list",
            list_id,
            trip_id,
            lambda s, sub: packing.get_packing_list(trip_id, list_id, s, sub),
            lambda x: _model(x, schemas.PackingListResponse),
        )

    def update_packing_list(self, trip_id: str, list_id: str, payload: schemas.PackingListUpdate) -> dict[str, Any]:
        """Rename a private packing list."""
        return self._call(
            "packing_list.update",
            "packing_list",
            list_id,
            trip_id,
            lambda s, sub: packing.update_packing_list(trip_id, list_id, payload, s, sub),
            lambda x: _model(x, schemas.PackingListResponse),
        )

    def delete_packing_list(self, trip_id: str, list_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete a list and all its bags and items after explicit confirmation."""
        return self._call(
            "packing_list.delete",
            "packing_list",
            list_id,
            trip_id,
            lambda s, sub: packing.delete_packing_list(trip_id, list_id, s, sub),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def list_packing_bags(self, trip_id: str, list_id: str) -> list[dict[str, Any]]:
        """List a packing list's bags in display order."""
        return self._call(
            "packing_bag.list",
            "packing_bag",
            None,
            trip_id,
            lambda s, sub: packing.list_packing_bags(trip_id, list_id, s, sub),
            lambda x: _models(x, schemas.PackingBagResponse),
        )

    def get_packing_bag(self, trip_id: str, list_id: str, bag_id: str) -> dict[str, Any]:
        """Read one bag, including its optional weight limit in grams."""
        return self._call(
            "packing_bag.get",
            "packing_bag",
            bag_id,
            trip_id,
            lambda s, sub: packing.get_packing_bag(trip_id, list_id, bag_id, s, sub),
            lambda x: _model(x, schemas.PackingBagResponse),
        )

    def create_packing_bag(self, trip_id: str, list_id: str, payload: schemas.PackingBagCreate) -> dict[str, Any]:
        """Create and position a bag."""
        return self._call(
            "packing_bag.create",
            "packing_bag",
            None,
            trip_id,
            lambda s, sub: packing.create_packing_bag(trip_id, list_id, payload, s, sub),
            lambda x: _model(x, schemas.PackingBagResponse),
        )

    def update_packing_bag(
        self, trip_id: str, list_id: str, bag_id: str, payload: schemas.PackingBagUpdate
    ) -> dict[str, Any]:
        """Update or reorder a bag."""
        return self._call(
            "packing_bag.update",
            "packing_bag",
            bag_id,
            trip_id,
            lambda s, sub: packing.update_packing_bag(trip_id, list_id, bag_id, payload, s, sub),
            lambda x: _model(x, schemas.PackingBagResponse),
        )

    def delete_packing_bag(self, trip_id: str, list_id: str, bag_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete a bag after confirmation; its items become unassigned."""
        return self._call(
            "packing_bag.delete",
            "packing_bag",
            bag_id,
            trip_id,
            lambda s, sub: packing.delete_packing_bag(trip_id, list_id, bag_id, s, sub),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def list_packing_items(self, trip_id: str, list_id: str) -> list[dict[str, Any]]:
        """List all packed and unpacked items, including unassigned items."""
        return self._call(
            "packing_item.list",
            "packing_item",
            None,
            trip_id,
            lambda s, sub: packing.list_packing_items(trip_id, list_id, s, sub),
            lambda x: _models(x, schemas.PackingItemResponse),
        )

    def get_packing_item(self, trip_id: str, list_id: str, item_id: str) -> dict[str, Any]:
        """Read a packing item."""
        return self._call(
            "packing_item.get",
            "packing_item",
            item_id,
            trip_id,
            lambda s, sub: packing.get_packing_item(trip_id, list_id, item_id, s, sub),
            lambda x: _model(x, schemas.PackingItemResponse),
        )

    def create_packing_item(self, trip_id: str, list_id: str, payload: schemas.PackingItemCreate) -> dict[str, Any]:
        """Create one packing item, optionally assigned to a bag."""
        return self._call(
            "packing_item.create",
            "packing_item",
            None,
            trip_id,
            lambda s, sub: packing.create_packing_item(trip_id, list_id, payload, s, sub),
            lambda x: _model(x, schemas.PackingItemResponse),
        )

    def batch_create_packing_items(
        self, trip_id: str, list_id: str, payload: list[schemas.PackingItemCreate]
    ) -> list[dict[str, Any]]:
        """Create up to 100 packing items atomically."""
        return self._call(
            "packing_item.batch_create",
            "packing_item",
            None,
            trip_id,
            lambda s, sub: packing.batch_create_packing_items(trip_id, list_id, payload, s, sub),
            lambda x: _models(x, schemas.PackingItemResponse),
        )

    def update_packing_item(
        self, trip_id: str, list_id: str, item_id: str, payload: schemas.PackingItemUpdate
    ) -> dict[str, Any]:
        """Update packed state, bag assignment, order or item details."""
        return self._call(
            "packing_item.update",
            "packing_item",
            item_id,
            trip_id,
            lambda s, sub: packing.update_packing_item(trip_id, list_id, item_id, payload, s, sub),
            lambda x: _model(x, schemas.PackingItemResponse),
        )

    def mark_packing_item(self, trip_id: str, list_id: str, item_id: str, packed: bool) -> dict[str, Any]:
        """Mark one item packed or unpacked."""
        return self._call(
            "packing_item.mark",
            "packing_item",
            item_id,
            trip_id,
            lambda s, sub: packing.update_packing_item(
                trip_id, list_id, item_id, schemas.PackingItemUpdate(packed=packed), s, sub
            ),
            lambda x: _model(x, schemas.PackingItemResponse),
        )

    def move_packing_item(
        self, trip_id: str, list_id: str, item_id: str, bag_id: str | None, position: int
    ) -> dict[str, Any]:
        """Move an item to a bag or Unassigned at a zero-based position."""
        return self._call(
            "packing_item.move",
            "packing_item",
            item_id,
            trip_id,
            lambda s, sub: packing.update_packing_item(
                trip_id, list_id, item_id, schemas.PackingItemUpdate(bag_id=bag_id, position=position), s, sub
            ),
            lambda x: _model(x, schemas.PackingItemResponse),
        )

    def delete_packing_item(self, trip_id: str, list_id: str, item_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete an item after explicit confirmation."""
        return self._call(
            "packing_item.delete",
            "packing_item",
            item_id,
            trip_id,
            lambda s, sub: packing.delete_packing_item(trip_id, list_id, item_id, s, sub),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def list_trip_tasks(self, trip_id: str) -> list[dict[str, Any]]:
        """List owner preparation tasks with their due dates and reminders."""
        return self._call(
            "trip_task.list",
            "trip_task",
            None,
            trip_id,
            lambda s, sub: tasks.list_trip_tasks(trip_id, s, sub),
            lambda x: _models(x, schemas.TripTaskResponse),
        )

    def create_trip_task(self, trip_id: str, payload: schemas.TripTaskCreate) -> dict[str, Any]:
        """Create a private task. Use remind_at for an inbox and email reminder; due_date alone schedules nothing."""
        return self._call(
            "trip_task.create",
            "trip_task",
            None,
            trip_id,
            lambda s, sub: tasks.create_trip_task(trip_id, payload, s, sub),
            lambda x: _model(x, schemas.TripTaskResponse),
        )

    def update_trip_task(self, trip_id: str, task_id: str, payload: schemas.TripTaskUpdate) -> dict[str, Any]:
        """Update a private task, including its explicit reminder schedule."""
        return self._call(
            "trip_task.update",
            "trip_task",
            task_id,
            trip_id,
            lambda s, sub: tasks.update_trip_task(trip_id, task_id, payload, s, sub),
            lambda x: _model(x, schemas.TripTaskResponse),
        )

    def delete_trip_task(self, trip_id: str, task_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete a preparation task after explicit confirmation."""
        return self._call(
            "trip_task.delete",
            "trip_task",
            task_id,
            trip_id,
            lambda s, sub: tasks.delete_trip_task(trip_id, task_id, s, sub),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def list_task_alerts(self, trip_id: str) -> list[dict[str, Any]]:
        """List delivered owner-inbox reminders for a trip's tasks that are due."""
        return self._call(
            "task_alert.list",
            "task_alert",
            None,
            trip_id,
            lambda s, sub: tasks.list_task_alerts(trip_id, s, sub),
            lambda x: _models(x, schemas.TripTaskAlertResponse),
        )

    def mark_task_alert_read(self, trip_id: str, alert_id: str) -> dict[str, Any]:
        """Mark one owner-inbox task alert as read."""
        return self._call(
            "task_alert.read",
            "task_alert",
            alert_id,
            trip_id,
            lambda s, sub: tasks.mark_task_alert_read(trip_id, alert_id, s, sub),
            lambda x: _model(x, schemas.TripTaskAlertResponse),
        )

    # Routes: between two areas, with optional locations, schedule, booking and drawn line ----
    def list_routes(self, trip_id: str, compact: bool = True) -> list[dict[str, Any]]:
        """List routes: how the trip gets from one area to another, ordered by departs_on (the local departure day; a route can have a day before it has times). Compact rows name the ends by id and label and leave out the line, notes and bookings; pass compact=false, or use get_route, for the full records."""
        return self._call(
            "route.list",
            "route",
            None,
            trip_id,
            lambda s, sub: routes.list_routes(trip_id, s, sub),
            _listed("route", schemas.RouteResponse, compact),
        )

    def create_route(self, trip_id: str, payload: schemas.RouteCreate) -> dict[str, Any]:
        """Create a route between two areas with a travel mode (flight, train, bus, ferry, car, bike, walk or other). A day first, times optional: "on 5 December, no train yet" is departs_on alone; never invent a time or put the date in the label. The exact locations, schedule, booking details and a drawn GeoJSON line are optional."""
        return self._call(
            "route.create",
            "route",
            None,
            trip_id,
            lambda s, sub: routes.create_route(trip_id, payload, s, sub),
            lambda x: _model(x, schemas.RouteResponse),
        )

    def update_route(self, trip_id: str, route_id: str, payload: schemas.RouteUpdate) -> dict[str, Any]:
        """Update a route. Set departs_on to give it a day without times; add departs_at and arrives_at together later (its day must stay the local date of departs_at), or set both to null to go back to a day only."""
        return self._call(
            "route.update",
            "route",
            route_id,
            trip_id,
            lambda s, sub: routes.update_route(trip_id, route_id, payload, s, sub),
            lambda x: _model(x, schemas.RouteResponse),
        )

    def delete_route(self, trip_id: str, route_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete a route after explicit confirmation."""
        return self._call(
            "route.delete",
            "route",
            route_id,
            trip_id,
            lambda s, sub: routes.delete_route(trip_id, route_id, s, sub),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    # Remaining derivative, import, and owner-library lifecycle tools ----
    def list_media_derivatives(self, trip_id: str, media_id: str) -> list[dict[str, Any]]:
        """List metadata-stripped derivatives and their review state."""
        return self._call(
            "media_derivative.list",
            "media_derivative",
            media_id,
            trip_id,
            lambda s, sub: media.list_derivatives(trip_id, media_id, s, sub),
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
            lambda s, sub: media.update_derivative_presentation(trip_id, media_id, derivative_id, payload, s, sub),
            lambda x: _model(x, schemas.MediaDerivativeResponse),
        )

    def start_media_import_session(self, trip_id: str, provider: ImportProvider) -> dict[str, Any]:
        """Start an explicit provider selection session; interactive OAuth is a separate workflow."""
        from .media.providers import get_provider_resolver

        return self._call(
            "media_import.start",
            "import_session",
            None,
            trip_id,
            lambda s, sub: media.start_import_session(
                trip_id, provider, s, sub, get_secret_store(), get_provider_resolver()
            ),
            lambda x: _model(x, schemas.ImportSessionResponse),
        )

    def complete_media_import_session(
        self, trip_id: str, provider: ImportProvider, session_id: str, confirm: bool = False
    ) -> dict[str, Any]:
        """Copy only owner-selected provider media after explicit confirmation."""
        from .media.providers import get_provider_resolver

        return self._call(
            "media_import.complete",
            "import_session",
            session_id,
            trip_id,
            lambda s, sub: media.complete_import(
                trip_id, provider, session_id, s, sub, get_storage(), get_secret_store(), get_provider_resolver()
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
            lambda _s, sub: media.list_provider_connection_status(sub, get_secret_store()),
            lambda x: _models(x, schemas.ProviderConnectionStatus),
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
            lambda s, sub: library.upload_library_document(
                s, sub, get_storage(), Response(), title, document_kind, file.upload_file(), linked_trip_id
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
            lambda s, sub: library.update_library_document(document_id, payload, s, sub),
            lambda x: _model(x, schemas.OwnerDocumentResponse),
        )

    def delete_library_document(self, document_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete a library document after explicit confirmation."""
        return self._call(
            "library_document.delete",
            "library_document",
            document_id,
            None,
            lambda s, sub: library.remove_library_document(document_id, s, sub, get_storage()),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def update_emergency_info(self, entry_id: str, payload: schemas.EmergencyInfoEntryUpdate) -> dict[str, Any]:
        """Update a private emergency-information entry. notes is Markdown."""
        return self._call(
            "emergency_info.update",
            "emergency_info",
            entry_id,
            None,
            lambda s, sub: library.update_emergency_info(entry_id, payload, s, sub),
            lambda x: _model(x, schemas.EmergencyInfoEntryResponse),
        )

    def delete_emergency_info(self, entry_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete an emergency-information entry after explicit confirmation."""
        return self._call(
            "emergency_info.delete",
            "emergency_info",
            entry_id,
            None,
            lambda s, sub: library.delete_emergency_info(entry_id, s, sub),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    # Focused owner reads and delivery diagnostics -----------------------
    def get_location_navigation(self, trip_id: str, location_id: str) -> dict[str, Any]:
        """Resolve an owned location to its authorized navigation URL."""
        return self._call(
            "location.navigation",
            "location",
            location_id,
            trip_id,
            lambda s, sub: locations.owner_navigation(location_id, trip_id, s, sub),
            lambda x: _model(x, schemas.NavigationResponse),
        )

    def get_stay(self, trip_id: str, stay_id: str) -> dict[str, Any]:
        """Read one owner-only accommodation record."""
        return self._call(
            "stay.get",
            "stay",
            stay_id,
            trip_id,
            lambda s, sub: stays.get_stay(trip_id, stay_id, s, sub),
            lambda x: _model(x, schemas.StayResponse),
        )

    def get_trip_task(self, trip_id: str, task_id: str) -> dict[str, Any]:
        """Read one owner preparation task."""
        return self._call(
            "trip_task.get",
            "trip_task",
            task_id,
            trip_id,
            lambda s, sub: tasks.get_trip_task(trip_id, task_id, s, sub),
            lambda x: _model(x, schemas.TripTaskResponse),
        )

    def get_route(self, trip_id: str, route_id: str) -> dict[str, Any]:
        """Read one route."""
        return self._call(
            "route.get",
            "route",
            route_id,
            trip_id,
            lambda s, sub: routes.get_route(trip_id, route_id, s, sub),
            lambda x: _model(x, schemas.RouteResponse),
        )

    def get_media(self, trip_id: str, media_id: str) -> dict[str, Any]:
        """Read metadata and the owner-authorized delivery URL for one media asset."""
        return self._call(
            "media.get",
            "media_asset",
            media_id,
            trip_id,
            lambda s, sub: media.get_media(trip_id, media_id, s, sub),
            lambda x: _model(x, schemas.MediaAssetResponse),
        )

    def get_document(self, trip_id: str, document_id: str) -> dict[str, Any]:
        """Read metadata and the owner-authorized delivery URL for one trip document."""
        return self._call(
            "document.get",
            "document_asset",
            document_id,
            trip_id,
            lambda s, sub: documents.get_document(trip_id, document_id, s, sub),
            lambda x: _model(x, schemas.DocumentAssetResponse),
        )

    def get_library_document(self, document_id: str) -> dict[str, Any]:
        """Read metadata and the owner-authorized delivery URL for one library document."""
        return self._call(
            "library_document.get",
            "library_document",
            document_id,
            None,
            lambda s, sub: library.get_library_document(document_id, s, sub),
            lambda x: _model(x, schemas.OwnerDocumentResponse),
        )

    def get_emergency_info_entry(self, entry_id: str) -> dict[str, Any]:
        """Read one owner-only emergency-information entry."""
        return self._call(
            "emergency_info.get",
            "emergency_info",
            entry_id,
            None,
            lambda s, sub: library.get_emergency_info_entry(entry_id, s, sub),
            lambda x: _model(x, schemas.EmergencyInfoEntryResponse),
        )

    def preview_public_navigation(self, trip_id: str, local_id: str) -> dict[str, Any]:
        """Verify an opaque public-preview navigation marker and return its destination."""
        return self._call(
            "public_projection.preview_navigation",
            "public_surface",
            local_id,
            trip_id,
            lambda s, sub: publication.preview_public_navigation(trip_id, local_id, s, sub),
            lambda x: json.loads(x.body),
        )

    def preview_share_navigation(self, trip_id: str, link_id: str, local_id: str) -> dict[str, Any]:
        """Verify an opaque named-link preview navigation marker and return its destination."""
        return self._call(
            "share_link.preview_navigation",
            "share_link",
            link_id,
            trip_id,
            lambda s, sub: publication.preview_share_navigation(trip_id, link_id, local_id, s, sub),
            lambda x: json.loads(x.body),
        )

    def inspect_public_preview_file(self, trip_id: str, local_id: str) -> dict[str, str | None]:
        """Verify that a scoped public-preview file is deliverable without returning its bytes."""
        return self._call(
            "public_projection.preview_file",
            "public_surface",
            local_id,
            trip_id,
            lambda s, sub: publication.preview_public_file(trip_id, local_id, s, sub, get_storage()),
            lambda x: {"content_type": x.media_type, "cache_control": x.headers.get("cache-control")},
        )

    def inspect_share_preview_file(self, trip_id: str, link_id: str, local_id: str) -> dict[str, str | None]:
        """Verify that a scoped named-link preview file is deliverable without returning its bytes."""
        return self._call(
            "share_link.preview_file",
            "share_link",
            link_id,
            trip_id,
            lambda s, sub: publication.preview_share_file(trip_id, link_id, local_id, s, sub, get_storage()),
            lambda x: {"content_type": x.media_type, "cache_control": x.headers.get("cache-control")},
        )


# Clients list only these tools plus the two below; every other tool is found
# with ``search_tools`` and run through ``call_tool`` (layered discovery, #196).
# Nearly every session starts by finding a trip and reading its overview.
MCP_ALWAYS_VISIBLE_TOOLS = ("whoami", "list_trips", "get_trip_overview")
MCP_SEARCH_TOOL = "search_tools"
MCP_CALL_TOOL = "call_tool"
MCP_VISIBLE_TOOLS = (*MCP_ALWAYS_VISIBLE_TOOLS, MCP_SEARCH_TOOL, MCP_CALL_TOOL)
# Each result carries the tool's full input schema and Travel's are large
# (``batch_create`` alone is ~16k characters), so a search returns fewer
# results than the siblings' 10.
MCP_SEARCH_MAX_RESULTS = 5


class ToolFailureMiddleware(Middleware):
    """Turn every failure that would surface as a bare protocol error into a correlated tool error.

    FastMCP reports a pydantic error raised by a tool body as ``-32602 Invalid
    request parameters`` and any other unexpected failure as a generic
    ``-32603``; neither names the tool or can be found in the server logs.
    This maps them to an ``isError`` result carrying the MCP request id, logs
    the same id, and audits calls that were refused before ``_call`` ran (for
    example invalid arguments). Only names, types and field paths are logged.

    A tool reached through ``call_tool`` passes through this middleware twice:
    once as itself, where it is audited and reported under its own name, and
    once as the ``call_tool`` proxy, which hands that report on unchanged.
    """

    def __init__(self, backend: TravelMcpBackend) -> None:
        self.backend = backend

    async def on_call_tool(self, context: MiddlewareContext[Any], call_next: Callable[..., Any]) -> Any:
        try:
            return await call_next(context)
        except (NotFoundError, DisabledError):
            raise
        except Exception as error:
            if getattr(error, _REPORTED, False):
                raise
            tool = context.message.name
            request_id = _request_id()
            if tool == MCP_CALL_TOOL and isinstance(error.__cause__, NotFoundError):
                # Like an unknown tool called directly, this is not audited.
                requested = (context.message.arguments or {}).get("name")
                logger.warning("MCP call_tool named an unknown tool request_id=%s tool=%.80r", request_id, requested)
                raise _reported(
                    ToolError(
                        f"Unknown tool: {requested!r}. Use {MCP_SEARCH_TOOL} to find the tool for a task. "
                        f"Reference: {request_id}"
                    )
                ) from None
            audited = getattr(error, _AUDITED, False) or getattr(error.__cause__, _AUDITED, False)
            if not audited:
                await anyio.to_thread.run_sync(
                    self.backend._audit_unexecuted_rejection, tool, context.message.arguments, error
                )
            if isinstance(error, ValidationError):
                fields = _validation_fields(error)
                logger.warning("MCP tool %s failed validation request_id=%s fields=%s", tool, request_id, fields)
                raise _reported(
                    ToolError(
                        f"{tool} failed validation ({fields}); the stored or generated data did not match the API "
                        f"schema. Reference: {request_id}"
                    )
                ) from None
            if isinstance(error, ArgumentValidationError) and isinstance(error.__cause__, ValidationError):
                # FastMCP wraps a bad call's pydantic error and its message echoes the rejected values.
                fields = _validation_fields(error.__cause__)
                logger.warning("MCP tool %s rejected its arguments request_id=%s fields=%s", tool, request_id, fields)
                raise _reported(
                    ToolError(f"{tool} rejected its arguments ({fields}). Reference: {request_id}")
                ) from None
            if isinstance(error, FastMCPError):
                raise _reported(ToolError(f"{error} Reference: {request_id}")) from error
            logger.error("MCP tool %s failed request_id=%s error=%s", tool, request_id, type(error).__name__)
            raise _reported(
                ToolError(f"{tool} hit an unexpected {type(error).__name__}. Reference: {request_id}")
            ) from None


_TOOL_NAMES = tuple(
    name for name in TravelMcpBackend.__dict__ if not name.startswith("_") and callable(getattr(TravelMcpBackend, name))
)

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
        "effect": "read"
        if name.startswith(("get_", "list_", "search_", "reverse_", "preview_", "inspect_", "suggest_", "whoami"))
        else "write",
        "requires_confirmation": name.startswith(("delete_", "revoke_", "unpublish_", "publish_", "set_"))
        or name
        in {
            "create_share_link",
            "update_share_link",
            "activate_share_link",
            "rotate_share_link",
            "approve_media_derivative",
            "complete_media_import_session",
            "merge_locations",
            "merge_areas",
        },
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
        "batch_create",
        "save_location",
        "save_area",
        "upload_media",
        "upload_document",
        "upload_library_document",
        "approve_media_derivative",
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
    {
        "search_places",
        "reverse_geocode_place",
        "suggest_area",
        "start_media_import_session",
        "complete_media_import_session",
    }
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


def _search_result(tools: Sequence[Tool]) -> list[dict[str, Any]]:
    """Each found tool with its callable schema and its capability-manifest entry."""
    return [
        {
            "name": tool.name,
            "description": tool.description,
            "input_schema": tool.parameters,
            **MCP_TOOL_CAPABILITIES.get(tool.name, {}),
        }
        for tool in tools
    ]


MCP_INSTRUCTIONS = (
    "Private Travel owner-management tools. Start with list_trips and get_trip_overview; find every other tool by "
    f"task with {MCP_SEARCH_TOOL} (for example 'merge duplicate locations' or 'share link preview') and run it with "
    f"{MCP_CALL_TOOL}. Each search result says whether the tool reads or writes and whether it requires "
    "confirmation: tools that change who can see something, publish, or delete data need confirm=true, so review "
    "their preview or target first. Long-form text (trip summary, visit summary and notes, reisupdate body and "
    "private notes, stay, route, task, location and emergency-information notes) is Markdown, including tables; "
    "task lists in it are display-only and never create trip tasks. A media caption is inline Markdown only (bold, "
    "italic, links), and a stay's contact_details is plain text whose phone numbers, email and web addresses become "
    "links. Give hotels and transport that are only being compared the status idea: ideas may overlap, cover no "
    "night or journey and are never shared; use planned for the intended stay or route, then cancel or delete the "
    "rejected alternatives."
)


class TravelMcpAuthProvider(KeycloakAuthProvider):
    """Keycloak resource-server auth bound to Travel's canonical MCP URL.

    Clients discover Keycloak directly (RFC 9728) and receive Keycloak tokens,
    so this server only verifies: issuer, signature, expiry, the ``openid``
    scope and the dedicated MCP audience.  It is never an OAuth proxy.  The
    default provider appends the in-app mount path to the base URL, which
    would advertise ``.../mcp/``; the resource identifier a client sends as
    its RFC 8707 ``resource`` must be exactly the configured URL.
    """

    def _get_resource_url(self, path: str | None = None) -> AnyHttpUrl | None:
        return self.base_url


def create_mcp_server(factory: sessionmaker[Session] = SessionLocal) -> FastMCP:
    """Create Travel's MCP server with OIDC verification when configured."""
    auth = None
    if settings.oidc_issuer_url and settings.mcp_resource_url:
        auth = TravelMcpAuthProvider(
            realm_url=settings.oidc_issuer_url,
            base_url=settings.mcp_resource_url,
            audience=settings.mcp_token_audience,
        )
    server = FastMCP(
        "travel",
        version="0.1.0",
        instructions=MCP_INSTRUCTIONS,
        auth=auth,
        transforms=[
            BM25SearchTransform(
                max_results=MCP_SEARCH_MAX_RESULTS,
                always_visible=list(MCP_ALWAYS_VISIBLE_TOOLS),
                search_tool_name=MCP_SEARCH_TOOL,
                call_tool_name=MCP_CALL_TOOL,
                search_result_serializer=_search_result,
            )
        ],
    )
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


def _jwt_segment(segment: str) -> dict[str, Any]:
    decoded = json.loads(base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4)))
    if not isinstance(decoded, dict):
        raise ValueError("JWT segment is not an object")
    return decoded


def _unauthorized_reason(authorization: str | None) -> str:
    """Why a bearer header might have been refused, from unverified claims and never the token itself."""
    if not authorization:
        return "no Authorization header"
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return "Authorization header is not a Bearer token"
    parts = token.strip().split(".")
    if len(parts) != 3:
        return f"bearer token is not a JWT ({len(parts)} segments)"
    try:
        header, claims = _jwt_segment(parts[0]), _jwt_segment(parts[1])
    except (ValueError, binascii.Error):
        return "bearer token has an undecodable JWT header or payload"
    exp = claims.get("exp")
    expiry = f"{int(exp - time.time())}s" if isinstance(exp, int | float) else None
    return (
        f"kid={header.get('kid')!r} alg={header.get('alg')!r} iss={claims.get('iss')!r} "
        f"aud={claims.get('aud')!r} azp={claims.get('azp')!r} expires_in={expiry}"
    )


class UnauthorizedRequestLogger:
    """Log every 401 from the MCP app with a token-free reason.

    The MCP SDK refuses a missing header silently and FastMCP logs most
    verification failures only at DEBUG, so a client's intermittent 401 left
    no trace beyond the access log (#184).
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_logging_401(message: Message) -> None:
            if message["type"] == "http.response.start" and message["status"] == 401:
                headers = {key.lower(): value for key, value in scope["headers"]}
                authorization = headers.get(b"authorization")
                logger.warning(
                    "MCP %s %s rejected with 401: %s",
                    scope["method"],
                    scope["path"],
                    _unauthorized_reason(authorization.decode("latin-1") if authorization else None),
                )
            await send(message)

        await self.app(scope, receive, send_logging_401)


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
    middleware = [StarletteMiddleware(UnauthorizedRequestLogger), *(http_app_kwargs.pop("middleware", None) or [])]
    return server, server.http_app(path="/", stateless_http=True, middleware=middleware, **http_app_kwargs)


def mount_mcp(app: FastAPI, server: FastMCP, mcp_app: StarletteWithLifespan) -> None:
    """Mount the MCP app and publish its RFC 9728 metadata at the host root.

    The metadata lives at ``/.well-known/oauth-protected-resource/<path>``, which a
    mount at ``/mcp`` would otherwise hide at ``/mcp/.well-known/...``, so the
    challenge's ``resource_metadata`` URL would lead nowhere.
    """
    if server.auth is not None:
        app.router.routes.extend(server.auth.get_well_known_routes("/"))
    app.mount("/mcp", mcp_app)


def main() -> None:
    """Run the authenticated local stdio MCP server."""
    create_mcp_server().run()


if __name__ == "__main__":
    main()
