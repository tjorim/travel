"""Server-side rendering of the deliberately small public-share contract.

The scope is an allowlist of both resources and fields. This module never
serializes an ORM model wholesale: adding a private canonical column cannot
make it past these explicit renderers by accident.
"""

from typing import Any

from .models import DerivativePurpose, DerivativeReviewState, Place, PlaceKind, Trip


class ScopeError(ValueError):
    """The scope is not safe to render for this trip."""


# These are schema fields, not ORM attributes. Keeping the list here beside
# the renderer makes an unknown field fail closed on every scope write.
ALLOWED_FIELDS = {
    # ``navigation`` only grants a server endpoint the ability to construct a
    # city-level Google Maps target. It never serializes a provider id, point,
    # or external URL into a projection.
    "route_stage": {"position", "label", "place", "navigation"},
    "broad_place": {"label", "country_code", "region", "latitude", "longitude", "navigation"},
    "broad_route": {"label", "geometry", "date_precision"},
    "moment_excerpt": {"title", "body", "date_precision", "story_date", "place", "navigation"},
    "broad_stay_card": {"title", "date_precision", "place", "navigation"},
    # The sole shareable representation of an exact place is this opaque
    # capability marker. Its OSM ref, address, coordinates, viewport and
    # display snapshot remain absent from the projection.
    "exact_place": {"navigation"},
    "media_derivative": {"image", "caption", "alt_text", "width", "height", "focal_x", "focal_y", "moment"},
    "document_derivative": {"title", "file"},
}


def _share_place(place: Place | None) -> dict[str, Any] | None:
    """Embed only a broad-place's deliberately authored safe fields."""
    if place is None:
        return None
    return {
        "label": place.label,
        "country_code": place.country_code,
        "region": place.region,
        "latitude": place.latitude,
        "longitude": place.longitude,
    }


def _selected(values: dict[str, Any], fields: list[str]) -> dict[str, Any]:
    return {field: values[field] for field in fields if field in values}


def _resources(trip: Trip) -> dict[str, dict[str, Any]]:
    """Index each shareable kind from trip-scoped relationships only."""
    broad_places: dict[str, Place] = {item.id: item for item in trip.places if item.kind == PlaceKind.BROAD}
    for stage in trip.route_stages:
        broad_places[stage.place.id] = stage.place
    for excerpt in trip.moment_excerpts:
        if excerpt.broad_place is not None:
            broad_places[excerpt.broad_place.id] = excerpt.broad_place
    for card in trip.broad_stay_cards:
        broad_places[card.place.id] = card.place
    return {
        "route_stage": {item.id: item for item in trip.route_stages},
        "exact_place": {item.id: item for item in trip.places if item.kind.value == "exact"},
        "broad_place": broad_places,
        "broad_route": {item.id: item for item in trip.broad_routes},
        "moment_excerpt": {item.id: item for item in trip.moment_excerpts},
        "broad_stay_card": {item.id: item for item in trip.broad_stay_cards},
        "media_derivative": {item.id: item for item in trip.media_derivatives},
        "document_derivative": {item.id: item for item in trip.document_derivatives},
    }


def _validate_item(kind: str, item_id: str, fields: list[str], resources: dict[str, dict[str, Any]]) -> Any:
    invalid_fields = set(fields) - ALLOWED_FIELDS[kind]
    if invalid_fields:
        raise ScopeError(f"Field {sorted(invalid_fields)[0]} is not allowed for {kind}")
    item = resources[kind].get(item_id)
    if item is None:
        raise ScopeError(f"{kind.replace('_', ' ').capitalize()} {item_id} is not part of this trip")
    if kind in {"media_derivative", "document_derivative"} and item.review_state != DerivativeReviewState.APPROVED:
        raise ScopeError(f"{kind.replace('_', ' ').capitalize()} {item_id} has not been approved")
    if kind == "media_derivative" and item.media_asset.deleted_at is not None:
        raise ScopeError(f"Media derivative {item_id} belongs to a deleted media asset")
    if kind == "media_derivative" and item.purpose != DerivativePurpose.SHARE:
        raise ScopeError(f"Media derivative {item_id} is not a share derivative")
    if kind == "document_derivative" and item.document_asset.deleted_at is not None:
        raise ScopeError(f"Document derivative {item_id} belongs to a deleted document")
    return item


def validate_scope(trip: Trip, scope: dict) -> None:
    """Ensure every scope item belongs to this trip and is share-safe."""
    resources = _resources(trip)
    seen: set[tuple[str, str]] = set()
    for item in scope.get("items", []):
        kind = item.get("kind")
        if kind not in ALLOWED_FIELDS:
            # Pydantic rejects this on API writes; retain the guard for old or
            # manually persisted JSON so delivery fails closed too.
            raise ScopeError(f"Resource kind {kind} is not allowed in a share scope")
        identity = (kind, item.get("id", ""))
        if identity in seen:
            raise ScopeError(f"{kind.replace('_', ' ').capitalize()} {identity[1]} is selected more than once")
        seen.add(identity)
        _validate_item(kind, item.get("id", ""), item.get("fields", []), resources)


def _render_item(kind: str, item: Any, fields: list[str], local_id: str) -> dict[str, Any]:
    """Render an item using only its requested, contract-approved fields."""
    values: dict[str, Any]
    if kind == "route_stage":
        values = {"position": item.position, "label": item.label, "place": _share_place(item.place)}
    elif kind == "broad_place":
        values = _share_place(item) or {}
    elif kind == "broad_route":
        values = {"label": item.label, "geometry": item.geometry, "date_precision": item.date_precision.value}
    elif kind == "moment_excerpt":
        date_value = item.story_date
        safe_date = (date_value.isoformat()[:{"day": 10, "month": 7, "year": 4}[item.date_precision.value]]
                     if date_value else None)
        values = {"title": item.title, "body": item.body, "date_precision": item.date_precision.value,
                  "story_date": safe_date, "place": _share_place(item.broad_place)}
    elif kind == "broad_stay_card":
        values = {"title": item.title, "date_precision": item.date_precision.value, "place": _share_place(item.place)}
    elif kind == "media_derivative":
        # The projection-local file marker discloses no object key, original
        # asset, or canonical derivative id.
        values = {"image": {"id": local_id}, "caption": item.caption, "alt_text": item.alt_text,
                  "width": item.width, "height": item.height, "focal_x": item.focal_x, "focal_y": item.focal_y}
    elif kind == "document_derivative":
        values = {"title": item.document_asset.title, "file": {"id": local_id}}
    else:  # exact_place; navigation is represented in a separate collection.
        values = {}
    return {"id": local_id, **_selected(values, fields)}


def render_projection(trip: Trip, scope: dict, schema_version: str) -> dict:
    """Render one complete public or unlisted document from its live scope."""
    validate_scope(trip, scope)
    resources = _resources(trip)
    projection: dict[str, Any] = {
        "schema_version": schema_version,
        "title": trip.title if scope.get("trip", {}).get("title", True) else None,
        "summary": trip.summary if scope.get("trip", {}).get("summary", True) else None,
        "route_stages": [], "places": [], "moments": [], "stays": [], "media": [], "documents": [], "route": [],
        "navigation": [],
    }
    destinations = {
        "route_stage": "route_stages", "broad_place": "places", "moment_excerpt": "moments", "broad_stay_card": "stays",
        "media_derivative": "media", "document_derivative": "documents", "broad_route": "route",
    }
    selected_moments = {
        selection["id"]: f"moment-{resources['moment_excerpt'][selection['id']].share_id}"
        for selection in scope.get("items", []) if selection["kind"] == "moment_excerpt"
    }
    for index, scope_item in enumerate(scope.get("items", [])):
        kind = scope_item["kind"]
        item = resources[kind][scope_item["id"]]
        local_id = selected_moments[scope_item["id"]] if kind == "moment_excerpt" else f"{kind}-{index + 1}"
        rendered = _render_item(kind, item, scope_item.get("fields", []), local_id)
        if kind == "media_derivative" and "moment" in scope_item.get("fields", []) and item.moment_excerpt_id in selected_moments:
            rendered["moment"] = selected_moments[item.moment_excerpt_id]
        if "navigation" in scope_item.get("fields", []):
            projection["navigation"].append({"id": local_id})
        if kind == "exact_place":
            continue
        if kind == "route_stage":
            rendered["_sort_position"] = item.position
        projection[destinations[kind]].append(rendered)
    projection["route_stages"].sort(key=lambda item: item.pop("_sort_position"))
    projection["moments"].sort(key=lambda item: (item.get("story_date") is None, item.get("story_date") or ""))
    return projection


def scoped_file(trip: Trip, scope: dict, local_id: str) -> tuple[str, Any] | None:
    """Resolve a projection-local file marker only while its field remains shared."""
    validate_scope(trip, scope)
    for index, selection in enumerate(scope.get("items", [])):
        kind = selection["kind"]
        field = {"media_derivative": "image", "document_derivative": "file"}.get(kind)
        if field in selection.get("fields", []) and local_id == f"{kind}-{index + 1}":
            return kind, _resources(trip)[kind][selection["id"]].object
    return None
