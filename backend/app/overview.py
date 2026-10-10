"""An owner-only overview of one trip: what it holds and what each audience receives.

It answers "is this trip complete?" (counts per kind) and "what will a
visitor see?" (per audience, from the same projection the visitor is served)
in one read, and flags the easy-to-miss states: an active audience that
receives nothing, shared trip dates, planning words such as "concept" in a
visible label, shared records whose map point is withheld because their area
is not shared, undated visits that duplicate a dated one, visits that restate a route, and locations that only repeat their area.
"""

import math
import re
from collections import Counter
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .access import COLLECTIONS
from .models import DocumentAsset, LinkState, Location, MediaAsset, PublicSurface, ShareLink, SurfaceState, Trip
from .projection import render_projection
from .route_overlap import overlapping_routes, route_title

# Words that mark a record as still being planned. Harmless for the owner, but
# once shared they tell every visitor the trip is not settled.
PLANNING_MARKERS = re.compile(
    r"\b(concept|tbd|todo|to do|tentative|placeholder|draft|undecided|not chosen"
    r"|voorlopig|nog te kiezen|nog niet gekozen|onzeker)\b",
    re.IGNORECASE,
)
_VISIBLE_TEXT = ("title", "label", "summary")
_DELIVERED = ("visits", "places", "stays", "routes", "updates", "media")
# Kinds whose visitor entry carries the area point a map places it at.
_MAPPED = {"visits": "visit", "stays": "stay", "updates": "reisupdate"}


def _visible_texts(value: Any) -> list[str]:
    """Every title, label or summary in a rendered projection, however deeply embedded."""
    found: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key in _VISIBLE_TEXT and isinstance(item, str):
                found.append(item)
            else:
                found.extend(_visible_texts(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(_visible_texts(item))
    return found


def _audience(
    trip: Trip,
    *,
    kind: str,
    audience_id: str | None,
    label: str,
    state: str,
    live: bool,
    scope: dict,
    schema_version: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    document = render_projection(trip, scope, schema_version)
    delivered = {key: len(document[key]) for key in _DELIVERED}
    unmapped = {
        key: sum(1 for item in document[key] if item.get("place") is not None and item["place"]["latitude"] is None)
        for key in _MAPPED
    }
    trip_fields = scope.get("trip", {})
    summary = {
        "kind": kind,
        "id": audience_id,
        "label": label,
        "state": state,
        "live": live,
        "shares_title": document["title"] is not None,
        "shares_summary": document["summary"] is not None,
        "dates_precision": document["dates"]["date_precision"] if document["dates"] else None,
        "scope_items": len(scope.get("items", [])),
        "delivered": delivered,
        "without_map_point": unmapped,
    }
    name = "The public page" if kind == "public" else f"Link {label!r}"
    warnings: list[dict[str, Any]] = []

    def warn(code: str, severity: str, message: str, text: str | None = None) -> None:
        warnings.append(
            {
                "code": code,
                "severity": severity,
                "message": message,
                "audience": label,
                "audience_id": audience_id,
                "text": text,
            }
        )

    if live and not any(delivered.values()):
        shown = [field for field in ("title", "summary") if trip_fields.get(field, True)]
        warn(
            "live_audience_receives_nothing",
            "warning",
            f"{name} is {state} but receives no records"
            + (f", only the trip {' and '.join(shown)}" if shown else "")
            + ". Set records to everyone, or choose custom records for it.",
        )
    if live and summary["dates_precision"]:
        warn(
            "trip_dates_shared",
            "info",
            f"{name} shows the trip dates by {summary['dates_precision']}.",
            summary["dates_precision"],
        )
    for text in sorted(set(_visible_texts(document))):
        if match := PLANNING_MARKERS.search(text):
            warn(
                "planning_marker_visible",
                "warning" if live else "info",
                f"{name} shows {text!r}, which contains the planning word {match.group(0)!r}. "
                "Rename it, and keep its planning state in a visit, stay or route status instead of in the label.",
                text,
            )
    withheld = [f"{count} {_MAPPED[key]}{'s' if count != 1 else ''}" for key, count in unmapped.items() if count]
    if withheld:
        warn(
            "map_point_withheld",
            "warning" if live else "info",
            f"{name} gets {', '.join(withheld)} without a map point: share their area (and give it a dot) to place them.",
            ", ".join(withheld),
        )
    return summary, warnings


def _duplicate_visits(trip: Trip) -> list[dict[str, Any]]:
    """Undated visits at an area that already has a dated one: usually a leftover of an older plan."""
    dated_areas = {visit.area_id for visit in trip.visits if visit.starts_on is not None}
    return [
        {
            "code": "undated_visit_duplicates_dated",
            "severity": "info",
            "audience": None,
            "audience_id": None,
            "kind": "visit",
            "id": visit.id,
            "text": visit.title or visit.area.label,
            "message": f"Undated visit {visit.title or visit.area.label!r} is at {visit.area.label!r}, which already has "
            "a dated visit. Date it, merge it, or delete it.",
        }
        for visit in trip.visits
        if visit.starts_on is None and visit.area_id in dated_areas
    ]


def _visits_restating_routes(trip: Trip) -> list[dict[str, Any]]:
    """Visits that repeat a journey already entered as a route: same day and area, and about the journey."""
    found = []
    for visit in trip.visits:
        for route in overlapping_routes(visit, trip.routes):
            name = visit.title or visit.area.label
            found.append(
                {
                    "code": "visit_restates_route",
                    "severity": "info",
                    "audience": None,
                    "audience_id": None,
                    "kind": "visit",
                    "id": visit.id,
                    "text": name,
                    "message": f"Visit {name!r} looks like the route {route_title(route)!r} on the same day. "
                    "Keep the journey as a route and delete the visit, or make the visit about something else.",
                }
            )
    return found


# A location this close to its area's point, and only repeating it, reads as the same place.
_SAME_PLACE_KM = 1.0
_TRANSPORT_CODE = re.compile(r"^[A-Z]{3}$")


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def _only_repeats_its_area(location: Location) -> bool:
    """A transport-code label (AMS, TPE), or a bare city entry: no OSM object, no address, just the city's name."""
    if location.label and _TRANSPORT_CODE.match(location.label):
        return True
    return (
        location.osm_element_id is None
        and not location.address_line1
        and bool(location.locality)
        and (location.display_name or location.locality).strip().lower() == location.locality.strip().lower()
    )


def _locations_repeating_areas(trip: Trip) -> list[dict[str, Any]]:
    """Locations that show up as a second place next to the area they sit in.

    An area is a cluster (a city or region); a station or airport is a location inside it. An area
    named after one place, with that place as its only content, lists it twice. Only a warning:
    nothing is hidden or changed, and a hotel near the city centre is not flagged."""
    areas = {area.id: area for area in trip.areas if area.latitude is not None and area.longitude is not None}
    found = []
    for location in trip.locations:
        area = areas.get(location.area_id)
        if area is None or location.latitude is None or location.longitude is None:
            continue
        if area.latitude is None or area.longitude is None:
            continue
        if _distance_km(area.latitude, area.longitude, location.latitude, location.longitude) > _SAME_PLACE_KM:
            continue
        if not _only_repeats_its_area(location):
            continue
        name = location.label or location.display_name or location.locality or "Naamloze locatie"
        found.append(
            {
                "code": "location_repeats_area",
                "severity": "info",
                "audience": None,
                "audience_id": None,
                "kind": "location",
                "id": location.id,
                "text": name,
                "message": f"Location {name!r} sits at the same place as its area {area.label!r}, so both show as places. "
                "Name the area after the city or region and keep the location for the exact place, "
                "or delete or merge the location if the area says enough.",
            }
        )
    return found


def trip_overview(session: Session, trip: Trip) -> dict[str, Any]:
    """Counts, per-audience delivery and review warnings for one owned trip. Changes nothing."""
    counts: dict[str, Any] = {f"{kind}s": len(records(trip)) for kind, records in COLLECTIONS.items()}
    counts["visits_undated"] = sum(1 for visit in trip.visits if visit.starts_on is None)
    counts["routes_undated"] = sum(1 for route in trip.routes if route.departs_on is None)
    counts["trip_tasks"] = len(trip.trip_tasks)
    counts["trip_tasks_open"] = sum(1 for task in trip.trip_tasks if task.completed_at is None)
    for key, model in (("media_assets", MediaAsset), ("documents", DocumentAsset)):
        counts[key] = session.scalar(
            select(func.count()).select_from(model).where(model.trip_id == trip.id, model.deleted_at.is_(None))
        )
    visibility = {
        kind: dict(Counter(item.visibility.value for item in COLLECTIONS[kind](trip))) for kind in COLLECTIONS
    }

    audiences: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    surface = session.get(PublicSurface, trip.id)
    public_state = surface.state.value if surface is not None else SurfaceState.UNPUBLISHED.value
    summary, found = _audience(
        trip,
        kind="public",
        audience_id=None,
        label="public",
        state=public_state,
        live=surface is not None and surface.state == SurfaceState.PUBLISHED,
        scope=surface.scope if surface is not None else {},
        schema_version="travel/public-trip@1",
    )
    audiences.append(summary)
    warnings.extend(found)
    links = session.scalars(
        select(ShareLink)
        .where(ShareLink.trip_id == trip.id, ShareLink.state.in_([LinkState.DRAFT, LinkState.ACTIVE]))
        .order_by(ShareLink.created_at)
    )
    for link in links:
        summary, found = _audience(
            trip,
            kind="share_link",
            audience_id=link.id,
            label=link.label,
            state=link.state.value,
            live=link.state == LinkState.ACTIVE,
            scope=link.scope,
            schema_version="travel/unlisted-trip@1",
        )
        audiences.append(summary)
        warnings.extend(found)
    warnings.extend(_duplicate_visits(trip))
    warnings.extend(_visits_restating_routes(trip))
    warnings.extend(_locations_repeating_areas(trip))
    return {
        "trip_id": trip.id,
        "title": trip.title,
        "starts_on": trip.starts_on,
        "ends_on": trip.ends_on,
        "counts": counts,
        "visibility": visibility,
        "audiences": audiences,
        "warnings": warnings,
    }
