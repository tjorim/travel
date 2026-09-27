"""An owner-only overview of one trip: what it holds and what each audience receives.

It answers "is this trip complete?" (counts per kind) and "what will a
visitor see?" (per audience, from the same projection the visitor is served)
in one read, and flags the easy-to-miss states: an active audience that
receives nothing, shared trip dates, planning words such as "concept" in a
visible label, shared records whose map point is withheld because their area
is not shared, and undated visits that duplicate a dated one.
"""

import re
from collections import Counter
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .access import COLLECTIONS
from .models import DocumentAsset, LinkState, MediaAsset, PublicSurface, ShareLink, SurfaceState, Trip
from .projection import render_projection

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
