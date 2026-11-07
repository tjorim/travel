"""Server-side rendering of the deliberately small public-share contract.

What an audience receives is decided by each record's ``visibility`` (see
``access``): everything set to ``everyone``, plus the ``custom`` records that
audience's scope lists. Every kind has a fixed allowlist of output fields. This
module never serializes an ORM model wholesale: adding a private canonical
column cannot make it past these explicit renderers by accident.
"""

import hashlib
from datetime import UTC, date, datetime, time
from typing import Any

from .access import COLLECTIONS, find_record, is_delivered, sharing_blocker
from .errors import ServiceError
from .exclusions import EXCLUDE_KEY, hidden_records, is_excludable, stored_exclusions
from .markdown import markdown_text, render_inline, render_markdown
from .models import Area, Location, MediaDerivative, MediaKind, Trip, Visibility
from .navigation import area_navigation_url, google_maps_url
from .precision import PRECISION_LENGTH, audience_precision, coarser, effective_precision, own_value, route_precision


class ScopeError(ServiceError):
    """The scope is not safe to render for this trip."""


def _safe_date(value: Any, precision: str) -> str | None:
    """Truncate an ISO date to the precision the owner chose to share."""
    return value.isoformat()[: PRECISION_LENGTH[precision]] if value else None


def _utc_instant(value: datetime) -> datetime:
    # SQLite returns stored UTC instants without an offset; a visitor's browser
    # must never read them as its own local time.
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _share_place(place: Area | None, shared_areas: set[str] | None = None) -> dict[str, Any] | None:
    """Embed only an area's deliberately authored safe fields."""
    if place is None:
        return None
    return {
        "label": place.label,
        "country_code": place.country_code,
        "region": place.region,
        "latitude": round(place.latitude, 2)
        if (shared_areas is None or place.id in shared_areas)
        and place.latitude is not None
        and place.longitude is not None
        else None,
        "longitude": round(place.longitude, 2)
        if (shared_areas is None or place.id in shared_areas)
        and place.latitude is not None
        and place.longitude is not None
        else None,
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
            "line1": place.address_line1,
            "line2": place.address_line2,
            "postal_code": place.postal_code,
            "locality": place.locality,
            "admin_area": place.admin_area,
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


def delivered(trip: Trip, scope: dict, *, with_exclusions: bool = True) -> dict[str, list[Any]]:
    """The records this audience receives, by kind, in display order.

    The one place that decides it: every document, file, navigation target, collection entry and
    owner check reads this. ``with_exclusions=False`` is only for the owner's review of what the
    scope's exclusions hide (see ``exclusion_review``); never for a visitor."""
    chosen = _chosen(scope)
    result = {
        kind: [item for item in COLLECTIONS[kind](trip) if is_delivered(kind, item, chosen[kind])]
        for kind in COLLECTIONS
    }
    # An audience's exclusions, and the records that depend on them, come out before anything is derived from
    # what is left: the update a photo travels with, the places a document may name.
    hidden = hidden_records(trip, scope) if with_exclusions else None
    if hidden:
        for kind in ("area", "location", "visit", "stay", "route", "travel_update"):
            result[kind] = [item for item in result[kind] if item.id not in hidden.ids(kind)]
    # A photo attached to a delivered reisupdate travels with it; approval
    # remains the gate, its own visibility only governs loose gallery photos.
    updates = {update.id for update in result["travel_update"]}
    result["media_derivative"] = [
        item
        for item in trip.media_derivatives
        if sharing_blocker("media_derivative", item) is None
        and (item.travel_update_id in updates or is_delivered("media_derivative", item, chosen["media_derivative"]))
        and not (hidden and item.id in hidden.ids("media_derivative"))
    ]
    result["visit"].sort(
        key=lambda item: (
            item.starts_on is None,
            item.starts_on or date.min,
            item.start_time or time.min,
            item.position,
        )
    )
    result["travel_update"].sort(key=lambda item: item.occurred_at)
    # By day; within a day, day-only routes follow the timed ones, as in the owner Agenda.
    result["route"].sort(
        key=lambda item: (
            item.departs_on is None,
            item.departs_on or date.min,
            item.departs_at is None,
            item.departs_at.replace(tzinfo=None) if item.departs_at else datetime.min,
            item.created_at.replace(tzinfo=None),
        )
    )
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
            raise ScopeError(f"Resource kind {kind} is not allowed in a share scope", code="scope_kind_invalid")
        if (kind, record_id) in seen:
            raise ScopeError(
                f"{kind.replace('_', ' ').capitalize()} {record_id} is selected more than once", code="scope_duplicate"
            )
        seen.add((kind, record_id))
        record = find_record(trip, kind, record_id)
        if record is None:
            raise ScopeError(
                f"{kind.replace('_', ' ').capitalize()} {record_id} is not part of this trip", code="scope_unavailable"
            )
        if record.visibility != Visibility.CUSTOM:
            raise ScopeError(
                f"{kind.replace('_', ' ').capitalize()} {record_id} is {record.visibility.value}; "
                "only a record set to custom can be chosen per audience",
                code="scope_requires_custom",
            )
        if blocker := sharing_blocker(kind, record):
            raise ScopeError(str(blocker), code=blocker.code)


def prepare_scope(trip: Trip, scope: dict, stored: dict | None = None, *, allow_exclusions: bool = True) -> dict:
    """Validate a submitted scope and return it as it is stored.

    The listed ``custom`` records are checked by ``validate_scope``. The exclusions are then settled:

    * the public view is the baseline and cannot exclude anything (``allow_exclusions=False``);
    * an id that is not part of this trip is refused, unless the audience already stores it (a stale
      entry for a record since deleted, which this write simply drops);
    * an entry whose record the baseline no longer reaches (not ``everyone`` any more) is dropped;
    * the rest is stored sorted, so the same set always has the same fingerprint, and ``exclude`` is
      left out entirely when nothing is excluded, so every scope without exclusions is stored as before.
    """
    validate_scope(trip, scope)
    entries = scope.get(EXCLUDE_KEY) or []
    document = {key: value for key, value in scope.items() if key != EXCLUDE_KEY}
    if not entries:
        return document
    if not allow_exclusions:
        raise ScopeError(
            "The public view is the baseline: it cannot exclude records. Exclude them on a hidden link instead",
            code="scope_exclusion_not_allowed",
        )
    already = set(stored_exclusions(stored or {}))
    kept: set[tuple[str, str]] = set()
    for item in entries:
        kind, record_id = item.get("kind"), item.get("id", "")
        if kind not in COLLECTIONS:
            raise ScopeError(f"Resource kind {kind} is not allowed in a share scope", code="scope_kind_invalid")
        if (kind, record_id) in kept:
            raise ScopeError(
                f"{kind.replace('_', ' ').capitalize()} {record_id} is excluded more than once", code="scope_duplicate"
            )
        record = find_record(trip, kind, record_id)
        if record is None:
            if (kind, record_id) not in already:
                raise ScopeError(
                    f"{kind.replace('_', ' ').capitalize()} {record_id} is not part of this trip",
                    code="scope_unavailable",
                )
            kept.add((kind, record_id))  # remembered only to catch a duplicate; dropped below
            continue
        kept.add((kind, record_id))
        if is_excludable(trip, kind, record):
            document.setdefault(EXCLUDE_KEY, []).append({"kind": kind, "id": record_id})
    if EXCLUDE_KEY in document:
        document[EXCLUDE_KEY].sort(key=lambda item: (item["kind"], item["id"]))
    return document


def _render(kind: str, item: Any, identifier: str, context: dict[str, Any]) -> dict[str, Any]:
    """Render one record with its fixed, contract-approved fields."""
    values: dict[str, Any]
    if kind in {"area", "location"}:
        values = _share_shared_place(item)
    elif kind == "visit":
        precision = effective_precision(own_value(item), context["date_precision"])
        shared_location = _embedded_location(item.location, context)
        values = {
            "title": item.title or (shared_location or {}).get("label") or item.area.label,
            "summary": item.summary,
            "summary_html": render_markdown(item.summary),
            "place": _share_place(item.area, context["areas"]),
            "date_precision": precision,
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
            "mode": item.mode.value,
            "status": item.status.value,
            "label": item.label,
            "departure": _share_place(item.departure_area, context["areas"]),
            "arrival": _share_place(item.arrival_area, context["areas"]),
            "carrier": item.carrier,
            "service_reference": item.service_reference,
        }
        # A route's day follows the audience's date setting (a day when it sets none). An exact instant would
        # give the day away, so the times are shared only to an audience that may read days.
        precision = route_precision(context["date_precision"])
        if item.departs_on is not None:
            values["departs_on"] = _safe_date(item.departs_on, precision)
            values["date_precision"] = precision
        if precision == "day" and item.departs_at is not None and item.arrives_at is not None:
            values.update(
                departs_at=_utc_instant(item.departs_at).isoformat(),
                arrives_at=_utc_instant(item.arrives_at).isoformat(),
                departure_timezone=item.departure_timezone,
                arrival_timezone=item.arrival_timezone,
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
        precision = effective_precision(own_value(item), context["date_precision"])
        values = {
            "title": item.area.label,
            "place": _share_place(item.area, context["areas"]),
            "date_precision": precision,
            "starts_on": _safe_date(item.check_in_date, precision),
            "ends_on": _safe_date(item.check_out_date, precision),
        }
        if location := _embedded_location(item.location, context):
            values["location"] = location
    elif kind == "travel_update":
        precision = coarser(item.date_precision.value, context["date_precision"]) or item.date_precision.value
        values = {
            "title": item.title,
            "body": item.body,
            "body_html": render_markdown(item.body),
            "date_precision": precision,
            "story_date": _safe_date(item.occurred_at.date(), precision),
            "place": _share_place(item.area, context["areas"]),
        }
        if location := _embedded_location(item.location, context):
            values["location"] = location
    elif kind == "media_derivative":
        # The projection-local file marker discloses no object key, original
        # asset, or canonical derivative id.
        marker = (
            {
                "video": {"id": identifier},
                "poster": {"id": f"{identifier}-poster"},
                "duration_seconds": item.duration_seconds,
            }
            if item.media_asset.media_kind.value == "video"
            else {"image": {"id": identifier}}
        )
        values = {
            **marker,
            "caption": item.caption,
            "caption_html": render_inline(item.caption),
            "alt_text": item.alt_text,
            "width": item.width,
            "height": item.height,
            "focal_x": item.focal_x,
            "focal_y": item.focal_y,
        }
        if item.travel_update_id in context["updates"]:
            values["update"] = context["updates"][item.travel_update_id]
    return {"id": identifier, **values}


def shared_trip_dates(trip: Trip, scope: dict) -> dict[str, Any] | None:
    """The trip's travel dates, only at the precision the scope selects.

    The audience's own date precision also caps them: the coarser of the two applies."""
    chosen = scope.get("trip", {}).get("dates")
    if chosen not in PRECISION_LENGTH or (trip.starts_on is None and trip.ends_on is None):
        return None
    precision = coarser(chosen, audience_precision(scope)) or chosen
    return {
        "starts_on": _safe_date(trip.starts_on, precision),
        "ends_on": _safe_date(trip.ends_on, precision),
        "date_precision": precision,
    }


_DESTINATIONS = {
    "visit": "visits",
    "area": "places",
    "location": "places",
    "stay": "stays",
    "travel_update": "updates",
    "media_derivative": "media",
    "route": "routes",
}


def _cover(trip: Trip, received: list[MediaDerivative]) -> str | None:
    """The trip's chosen cover, only if this audience already receives that photo.

    Nominating a cover never delivers it: a copy that is private, unapproved,
    detached from a shared update or deleted is simply not among ``received``,
    so the audience gets no cover and no way to request its file.
    """
    for item in received:
        if item.is_cover and item.media_asset.media_kind == MediaKind.PHOTO:
            return local_id("media_derivative", item)
    return None


def render_projection(trip: Trip, scope: dict, schema_version: str) -> dict:
    """Render one complete public or unlisted document from its live scope."""
    records = delivered(trip, scope)
    context = {
        "updates": {item.id: local_id("travel_update", item) for item in records["travel_update"]},
        "locations": {item.id for item in records["location"]},
        "areas": {item.id for item in records["area"]},
        # The audience's own cap on every date; the coarser of it and a record's own value is shown.
        "date_precision": audience_precision(scope),
    }
    # Markdown fields carry their source, sanitized HTML for display, and, for
    # the trip summary shown on cards, a one-line plain-text preview.
    summary = trip.summary if scope.get("trip", {}).get("summary", True) else None
    projection: dict[str, Any] = {
        "schema_version": schema_version,
        "title": trip.title if scope.get("trip", {}).get("title", True) else None,
        "summary": summary,
        "summary_html": render_markdown(summary),
        "summary_text": markdown_text(summary),
        "dates": shared_trip_dates(trip, scope),
        "cover": _cover(trip, records["media_derivative"]),
        "visits": [],
        "places": [],
        "updates": [],
        "stays": [],
        "media": [],
        "routes": [],
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
