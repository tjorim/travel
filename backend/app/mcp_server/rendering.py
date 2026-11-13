"""How a tool shapes what it returns: the declared API representation, compact list rows and share URLs."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from urllib.parse import quote

from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel

from ..config import settings


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
        "title",
        "kind",
        "status",
        "starts_on",
        "ends_on",
        "start_time",
        "end_time",
        "visibility",
        "share_date_precision",
    ),
    "stay": (
        "id",
        "check_in_date",
        "check_out_date",
        "status",
        "property_name",
        "visibility",
        "share_date_precision",
    ),
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


def _share_url(token: str | None) -> str:
    """Build the visitor URL that corresponds to an unlisted capability.

    MCP has no browser request or current page URL, so this must use the
    configured visitor PWA origin rather than returning a relative path or an
    API URL.  The token is URL-safe today, but quote it defensively because it
    is a capability and must remain one path segment.
    """
    if token is None:
        raise ValueError("The share link has no capability token")
    return f"{str(settings.public_app_url).rstrip('/')}/share/{quote(token, safe='')}"
