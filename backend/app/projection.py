"""Server-side rendering of the deliberately small public-share contract.

What an audience receives is decided by each record's ``visibility`` (see
``access``): everything set to ``everyone``, plus the ``custom`` records that
audience's scope lists. Every kind has a fixed allowlist of output fields. This
module never serializes an ORM model wholesale: adding a private canonical
column cannot make it past these explicit renderers by accident.
"""

import hashlib
from datetime import date, datetime, time
from typing import Any

from .access import COLLECTIONS, find_record, is_delivered, sharing_blocker
from .models import Area, Location, Trip, Visibility
from .navigation import area_navigation_url, google_maps_url


class ScopeError(ValueError):
    """The scope is not safe to render for this trip."""


_PRECISION_LENGTH = {"day": 10, "month": 7, "year": 4}


def _safe_date(value: Any, precision: str) -> str | None:
    """Truncate an ISO date to the precision the owner chose to share."""
    return value.isoformat()[: _PRECISION_LENGTH[precision]] if value else None


def _share_place(place: Area | None, shared_areas: set[str] | None = None) -> dict[str, Any] | None:
    """Embed only an area's deliberately authored safe fields."""
    if place is None:
        return None
    return {
        "label": place.label,
        "country_code": place.country_code,
        "region": place.region,
        "latitude": round(place.latitude, 2) if (shared_areas is None or place.id in shared_areas) and place.latitude is not None and place.longitude is not None else None,
        "longitude": round(place.longitude, 2) if (shared_areas is None or place.id in shared_areas) and place.latitude is not None and place.longitude is not None else None,
    }


def _share_shared_place(place: Area | Location) -> dict[str, Any]:
    """A shared area (its label and region) or location (its public name).

    A location shows its owner-chosen public name, city, country and point. Its
    address is added only when the owner chose to share it. Its notes, provider
    ids and display name (which usually contains the address) are never shown.
    """
    if isinstance(place, Area):
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


def _embedded_location(location: Location | None, context: dict[str, Any]) -> dict[str, Any] | None:
    """The location of an update or stay, only when this audience receives that location."""
    if location is None or location.id not in context["locations"]:
        return None
    return {"id": local_id("location", location), **_share_shared_place(location)}


def _share_route_map_point(place: Location | None, mode: str) -> dict[str, Any] | None:
    """A route end on the map, only when that location is itself shared."""
    if place is None or place.latitude is None or place.longitude is None:
        return None
    return {
        "label": place.label or "Vervoerspunt",
        "country_code": place.country_code,
        "latitude": place.latitude,
        "longitude": place.longitude,
        "kind": "airport" if mode == "flight" else "place",
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
    result["visit"].sort(key=lambda item: (item.starts_on is None, item.starts_on or date.min, item.start_time or time.min, item.position))
    result["travel_update"].sort(key=lambda item: item.occurred_at)
    result["route"].sort(key=lambda item: (item.departs_at is None, item.departs_at.replace(tzinfo=None) if item.departs_at else datetime.min, item.created_at.replace(tzinfo=None)))
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
    if kind in {"area", "location"}:
        values = _share_shared_place(item)
    elif kind == "visit":
        precision = item.share_date_precision.value
        shared_location = _embedded_location(item.location, context)
        values = {
            "title": item.title or (shared_location or {}).get("label") or item.area.label,
            "summary": item.summary, "place": _share_place(item.area, context["areas"]), "date_precision": precision,
        }
        if item.starts_on is not None:
            values["starts_on"] = _safe_date(item.starts_on, precision)
            values["ends_on"] = _safe_date(item.ends_on, precision) if item.ends_on is not None else None
            # A time is private unless the owner also chose to show it, and only means something on a full date.
            if item.share_time and precision == "day" and item.start_time is not None:
                values["start_time"] = item.start_time.strftime("%H:%M")
                values["end_time"] = item.end_time.strftime("%H:%M") if item.end_time is not None else None
                # The times are local at the visit, so a viewer far away can read them in their own time.
                values["timezone"] = item.area.timezone
        if shared_location:
            values["location"] = shared_location
    elif kind == "route":
        locations = context["locations"]
        values = {
            "mode": item.mode.value, "status": item.status.value, "label": item.label,
            "departure": _share_place(item.departure_area, context["areas"]), "arrival": _share_place(item.arrival_area, context["areas"]),
            "carrier": item.carrier, "service_reference": item.service_reference,
        }
        if item.departs_at is not None and item.arrives_at is not None:
            values.update(
                departs_at=item.departs_at.isoformat(), arrives_at=item.arrives_at.isoformat(),
                departure_timezone=item.departure_timezone, arrival_timezone=item.arrival_timezone,
            )
        if item.geometry is not None:
            values["geometry"] = item.geometry
        points = {
            "departure": _share_route_map_point(
                item.departure_location if item.departure_location_id in locations else None, item.mode.value
            ),
            "arrival": _share_route_map_point(
                item.arrival_location if item.arrival_location_id in locations else None, item.mode.value
            ),
        }
        if any(points.values()):
            values["map"] = points
    elif kind == "stay":
        precision = item.share_date_precision.value
        values = {
            "title": item.area.label, "place": _share_place(item.area, context["areas"]), "date_precision": precision,
            "starts_on": _safe_date(item.check_in_date, precision), "ends_on": _safe_date(item.check_out_date, precision),
        }
        if location := _embedded_location(item.location, context):
            values["location"] = location
    elif kind == "travel_update":
        values = {"title": item.title, "body": item.body, "date_precision": item.date_precision.value,
                  "story_date": _safe_date(item.occurred_at.date(), item.date_precision.value),
                  "place": _share_place(item.area, context["areas"])}
        if location := _embedded_location(item.location, context):
            values["location"] = location
    elif kind == "media_derivative":
        # The projection-local file marker discloses no object key, original
        # asset, or canonical derivative id.
        marker = ({"video": {"id": identifier}, "poster": {"id": f"{identifier}-poster"},
                   "duration_seconds": item.duration_seconds} if item.media_asset.media_kind.value == "video"
                  else {"image": {"id": identifier}})
        values = {**marker, "caption": item.caption, "alt_text": item.alt_text,
                  "width": item.width, "height": item.height, "focal_x": item.focal_x, "focal_y": item.focal_y}
        if item.travel_update_id in context["updates"]:
            values["update"] = context["updates"][item.travel_update_id]
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
    "visit": "visits", "area": "places", "location": "places", "stay": "stays", "travel_update": "updates",
    "media_derivative": "media", "route": "routes",
}


def render_projection(trip: Trip, scope: dict, schema_version: str) -> dict:
    """Render one complete public or unlisted document from its live scope."""
    records = delivered(trip, scope)
    context = {
        "updates": {item.id: local_id("travel_update", item) for item in records["travel_update"]},
        "locations": {item.id for item in records["location"]},
        "areas": {item.id for item in records["area"]},
    }
    projection: dict[str, Any] = {
        "schema_version": schema_version,
        "title": trip.title if scope.get("trip", {}).get("title", True) else None,
        "summary": trip.summary if scope.get("trip", {}).get("summary", True) else None,
        "dates": shared_trip_dates(trip, scope),
        "visits": [], "places": [], "updates": [], "stays": [], "media": [], "routes": [],
        "navigation": [],
    }
    for kind, destination in _DESTINATIONS.items():
        for item in records[kind]:
            identifier = local_id(kind, item)
            projection[destination].append(_render(kind, item, identifier, context))
            # A shared place is also a destination someone may navigate to.
            if kind in {"area", "location"} and _navigation_target(item) is not None:
                projection["navigation"].append({"id": identifier})
    return projection


def _navigation_target(place: Area | Location) -> str | None:
    """Where a shared place sends someone: a location's point, or an area's name."""
    if isinstance(place, Area):
        return area_navigation_url(place)
    if place.latitude is not None and place.longitude is not None:
        return google_maps_url(f"{place.latitude:.7f},{place.longitude:.7f}")
    return None


def scoped_navigation_url(trip: Trip, scope: dict, identifier: str) -> str | None:
    """Resolve a projection-local navigation marker among the delivered places."""
    records = delivered(trip, scope)
    for kind in ("area", "location"):
        for place in records[kind]:
            if local_id(kind, place) == identifier:
                return _navigation_target(place)
    return None


def scoped_file(trip: Trip, scope: dict, identifier: str) -> tuple[str, Any] | None:
    """Resolve a projection-local file marker among the delivered files."""
    records = delivered(trip, scope)
    for kind in ("media_derivative",):
        for item in records[kind]:
            if local_id(kind, item) == identifier:
                return kind, item.object
            if local_id(kind, item) + "-poster" == identifier and item.poster_object is not None:
                return kind, item.poster_object
    return None
