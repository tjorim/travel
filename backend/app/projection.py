"""Server-side rendering of the deliberately small public-share contract.

What an audience receives is decided by each record's ``visibility`` (see
``access``): everything set to ``everyone``, plus the ``custom`` records that
audience's scope lists. Every kind has a fixed allowlist of output fields. This
module never serializes an ORM model wholesale: adding a private canonical
column cannot make it past these explicit renderers by accident.
"""

import hashlib
from typing import Any

from .access import COLLECTIONS, find_record, is_delivered, sharing_blocker
from .models import Place, PlaceKind, Trip, Visibility
from .navigation import broad_navigation_url, google_maps_url


class ScopeError(ValueError):
    """The scope is not safe to render for this trip."""


_PRECISION_LENGTH = {"day": 10, "month": 7, "year": 4}


def _safe_date(value: Any, precision: str) -> str | None:
    """Truncate an ISO date to the precision the owner chose to share."""
    return value.isoformat()[: _PRECISION_LENGTH[precision]] if value else None


def _share_place(place: Place | None) -> dict[str, Any] | None:
    """Embed only an area's deliberately authored safe fields."""
    if place is None:
        return None
    return {
        "label": place.label,
        "country_code": place.country_code,
        "region": place.region,
        "latitude": place.latitude,
        "longitude": place.longitude,
    }


def _share_shared_place(place: Place) -> dict[str, Any]:
    """A shared place: an area's label and region, or a spot's public name.

    A spot shows its owner-chosen public name, city, country and point. Its
    address is added only when the owner chose to share it. Its notes, provider
    ids and display name (which usually contains the address) are never shown.
    """
    if place.kind == PlaceKind.BROAD:
        return _share_place(place) or {}
    values: dict[str, Any] = {
        "label": place.label,
        "country_code": place.country_code,
        "region": place.locality,
        "latitude": place.latitude,
        "longitude": place.longitude,
    }
    if place.share_address:
        address = {
            "line1": place.address_line1, "line2": place.address_line2, "postal_code": place.postal_code,
            "locality": place.locality, "admin_area": place.admin_area,
        }
        values["address"] = {key: value for key, value in address.items() if value}
    return values


def _embedded_spot(spot: Place | None, context: dict[str, Any]) -> dict[str, Any] | None:
    """The exact place of an update or stay, only when this audience receives that spot."""
    if spot is None or spot.id not in context["places"]:
        return None
    return {"id": local_id("place", spot), **_share_shared_place(spot)}


def _share_transport_endpoint(place: Place) -> dict[str, Any]:
    """Show a leg's endpoint as its area, never copied spot city text."""
    return _share_place(place.area) or {"label": "Unassigned", "country_code": place.country_code, "region": None,
                                         "latitude": None, "longitude": None}


def _share_transport_map_point(place: Place | None, transport_kind: str) -> dict[str, Any] | None:
    """A transport endpoint on the map, only when that place is itself shared."""
    if place is None or place.latitude is None or place.longitude is None:
        return None
    return {
        "label": place.label or "Vervoerspunt",
        "country_code": place.country_code,
        "latitude": place.latitude,
        "longitude": place.longitude,
        "kind": "airport" if transport_kind == "flight" else "place",
    }


def local_id(kind: str, record: Any) -> str:
    """A projection-local id, stable across requests and not reversible.

    It discloses no canonical id and no object key. A reisupdate keeps its own
    share id, which visitors may bookmark.
    """
    if kind == "travel_update":
        return f"update-{record.share_id}"
    return f"{kind}-{hashlib.sha256(record.id.encode()).hexdigest()[:12]}"


def _chosen(scope: dict) -> dict[str, set[str]]:
    chosen: dict[str, set[str]] = {kind: set() for kind in COLLECTIONS}
    for item in scope.get("items", []):
        if item.get("kind") in chosen:
            chosen[item["kind"]].add(item.get("id", ""))
    return chosen


def delivered(trip: Trip, scope: dict) -> dict[str, list[Any]]:
    """The records this audience receives, by kind, in display order."""
    chosen = _chosen(scope)
    result = {
        kind: [item for item in COLLECTIONS[kind](trip) if is_delivered(kind, item, chosen[kind])]
        for kind in COLLECTIONS
    }
    # A photo attached to a delivered reisupdate travels with it; approval
    # remains the gate, its own visibility only governs loose gallery photos.
    updates = {update.id for update in result["travel_update"]}
    result["media_derivative"] = [
        item for item in trip.media_derivatives
        if sharing_blocker("media_derivative", item) is None
        and (item.travel_update_id in updates or is_delivered("media_derivative", item, chosen["media_derivative"]))
    ]
    result["route_stage"].sort(key=lambda item: item.position)
    result["travel_update"].sort(key=lambda item: item.occurred_at)
    result["transport_leg"].sort(key=lambda item: item.departs_at)
    result["stay"].sort(key=lambda item: item.check_in_date)
    return result


def validate_scope(trip: Trip, scope: dict) -> None:
    """Ensure every listed record belongs to this trip, is ``custom`` and can be shared.

    Called when a scope is written. Delivery never fails on a record that has
    since changed: it simply is not delivered.
    """
    seen: set[tuple[str, str]] = set()
    for item in scope.get("items", []):
        kind, record_id = item.get("kind"), item.get("id", "")
        if kind not in COLLECTIONS:
            raise ScopeError(f"Resource kind {kind} is not allowed in a share scope")
        if (kind, record_id) in seen:
            raise ScopeError(f"{kind.replace('_', ' ').capitalize()} {record_id} is selected more than once")
        seen.add((kind, record_id))
        record = find_record(trip, kind, record_id)
        if record is None:
            raise ScopeError(f"{kind.replace('_', ' ').capitalize()} {record_id} is not part of this trip")
        if record.visibility != Visibility.CUSTOM:
            raise ScopeError(
                f"{kind.replace('_', ' ').capitalize()} {record_id} is {record.visibility.value}; "
                "only a record set to custom can be chosen per audience"
            )
        if blocker := sharing_blocker(kind, record):
            raise ScopeError(blocker)


def _render(kind: str, item: Any, identifier: str, context: dict[str, Any]) -> dict[str, Any]:
    """Render one record with its fixed, contract-approved fields."""
    values: dict[str, Any]
    if kind == "place":
        values = _share_shared_place(item)
    elif kind == "route_stage":
        values = {"position": item.position, "label": item.label, "summary": item.summary, "place": _share_place(item.place)}
    elif kind == "broad_route":
        values = {"label": item.label, "geometry": item.geometry, "date_precision": item.date_precision.value}
    elif kind == "stay":
        precision = item.share_date_precision.value
        values = {
            "title": item.area.label, "place": _share_place(item.area), "date_precision": precision,
            "starts_on": _safe_date(item.check_in_date, precision), "ends_on": _safe_date(item.check_out_date, precision),
        }
        if spot := _embedded_spot(item.place, context):
            values["spot"] = spot
    elif kind == "travel_update":
        values = {"title": item.title, "body": item.body, "date_precision": item.date_precision.value,
                  "story_date": _safe_date(item.occurred_at.date(), item.date_precision.value),
                  "place": _share_place(item.area)}
        if spot := _embedded_spot(item.place, context):
            values["spot"] = spot
    elif kind == "media_derivative":
        # The projection-local file marker discloses no object key, original
        # asset, or canonical derivative id.
        values = {"image": {"id": identifier}, "caption": item.caption, "alt_text": item.alt_text,
                  "width": item.width, "height": item.height, "focal_x": item.focal_x, "focal_y": item.focal_y}
        if item.travel_update_id in context["updates"]:
            values["update"] = context["updates"][item.travel_update_id]
    elif kind == "document_derivative":
        values = {"title": item.document_asset.title, "file": {"id": identifier}}
    else:  # transport_leg
        places = context["places"]
        values = {
            "kind": item.kind.value, "status": item.status.value,
            "departure": _share_transport_endpoint(item.departure_place),
            "arrival": _share_transport_endpoint(item.arrival_place),
            "departs_at": item.departs_at.isoformat(), "arrives_at": item.arrives_at.isoformat(),
            "departure_timezone": item.departure_timezone, "arrival_timezone": item.arrival_timezone,
            "carrier": item.carrier, "service_reference": item.service_reference,
        }
        points = {
            "departure": _share_transport_map_point(item.departure_place if item.departure_place_id in places else None, item.kind.value),
            "arrival": _share_transport_map_point(item.arrival_place if item.arrival_place_id in places else None, item.kind.value),
        }
        if any(points.values()):
            values["map"] = points
    return {"id": identifier, **values}


def shared_trip_dates(trip: Trip, scope: dict) -> dict[str, Any] | None:
    """The trip's travel dates, only at the precision the scope selects."""
    precision = scope.get("trip", {}).get("dates")
    if precision not in _PRECISION_LENGTH or (trip.starts_on is None and trip.ends_on is None):
        return None
    return {
        "starts_on": _safe_date(trip.starts_on, precision),
        "ends_on": _safe_date(trip.ends_on, precision),
        "date_precision": precision,
    }


_DESTINATIONS = {
    "route_stage": "route_stages", "place": "places", "stay": "stays", "travel_update": "updates",
    "media_derivative": "media", "document_derivative": "documents", "broad_route": "route",
    "transport_leg": "transport",
}


def render_projection(trip: Trip, scope: dict, schema_version: str) -> dict:
    """Render one complete public or unlisted document from its live scope."""
    records = delivered(trip, scope)
    context = {
        "updates": {item.id: local_id("travel_update", item) for item in records["travel_update"]},
        "places": {item.id for item in records["place"]},
    }
    projection: dict[str, Any] = {
        "schema_version": schema_version,
        "title": trip.title if scope.get("trip", {}).get("title", True) else None,
        "summary": trip.summary if scope.get("trip", {}).get("summary", True) else None,
        "dates": shared_trip_dates(trip, scope),
        "route_stages": [], "places": [], "updates": [], "stays": [], "media": [], "documents": [], "route": [],
        "transport": [], "navigation": [],
    }
    for kind, destination in _DESTINATIONS.items():
        for item in records[kind]:
            identifier = local_id(kind, item)
            projection[destination].append(_render(kind, item, identifier, context))
            # A shared place is also a destination someone may navigate to.
            if kind == "place" and _navigation_target(item) is not None:
                projection["navigation"].append({"id": identifier})
    return projection


def _navigation_target(place: Place) -> str | None:
    """Where a shared place sends someone: a spot's point, or an area's name."""
    if place.kind == PlaceKind.BROAD:
        return broad_navigation_url(place)
    if place.latitude is not None and place.longitude is not None:
        return google_maps_url(f"{place.latitude:.7f},{place.longitude:.7f}")
    return None


def scoped_navigation_url(trip: Trip, scope: dict, identifier: str) -> str | None:
    """Resolve a projection-local navigation marker among the delivered places."""
    for place in delivered(trip, scope)["place"]:
        if local_id("place", place) == identifier:
            return _navigation_target(place)
    return None


def scoped_file(trip: Trip, scope: dict, identifier: str) -> tuple[str, Any] | None:
    """Resolve a projection-local file marker among the delivered files."""
    records = delivered(trip, scope)
    for kind in ("media_derivative", "document_derivative"):
        for item in records[kind]:
            if local_id(kind, item) == identifier:
                return kind, item.object
    return None
