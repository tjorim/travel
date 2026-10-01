"""Visits that only restate a route already on the trip.

Transport between areas is a route; a visit is a stop. An older timeline, or a
day plan written later, can enter the same journey as a visit ("Vertrek EX101"),
so the trip shows it twice. This finds such visits, conservatively: a match
needs the same day, the same area *and* evidence that the visit is about the
journey. A real visit at an airport or station on a travel day has no such
evidence and is left alone. Nothing here blocks or changes a record.
"""

import re
from collections.abc import Iterable
from datetime import date, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .models import Route, RouteMode, RouteStatus, Visit

# A visit longer than this is a stay or a work period, never a single journey.
MAX_JOURNEY_DAYS = 2
# Words in a title that name a kind of journey. Deliberately not "aankomst", "vertrek" or "station":
# "Aankomst hotel" and "Station bekijken" are real visits.
_MODE_WORDS = {
    RouteMode.FLIGHT: ("vlucht", "terugvlucht", "flight", "vliegtuig", "vliegveld", "luchthaven", "airport"),
    RouteMode.TRAIN: ("trein", "train", "eurostar", "thalys", "hsr", "intercity"),
    RouteMode.BUS: ("bus",),
    RouteMode.FERRY: ("veerboot", "ferry"),
}


def _squash(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def _words(text: str | None) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", (text or "").lower()))


def _local_day(moment, timezone: str | None) -> date:
    try:
        zone = ZoneInfo(timezone) if timezone else None
    except (ZoneInfoNotFoundError, ValueError):
        zone = None
    return (moment.astimezone(zone) if zone else moment).date()


def route_days(route: Route) -> set[date]:
    """The local days a route touches: the day it leaves and the day it arrives."""
    days: set[date] = set()
    if route.departs_on is not None:
        days.add(route.departs_on)
    elif route.departs_at is not None:
        days.add(_local_day(route.departs_at, route.departure_timezone))
    if route.arrives_at is not None:
        days.add(_local_day(route.arrives_at, route.arrival_timezone))
    return days


def route_title(route: Route) -> str:
    return route.label or f"{route.departure_area.label} → {route.arrival_area.label}"


def _about_the_journey(visit: Visit, route: Route) -> bool:
    title, text = visit.title or "", f"{visit.title or ''} {visit.summary or ''}"
    squashed_text, squashed_title = _squash(text), _squash(title)
    if len(reference := _squash(route.service_reference)) >= 3 and reference in squashed_text:
        return True
    if len(carrier := _squash(route.carrier)) >= 4 and carrier in squashed_text:
        return True
    label = _squash(route.label)
    if len(label) >= 6 and squashed_title and (label in squashed_title or squashed_title in label):
        return True
    return bool(_words(title) & set(_MODE_WORDS.get(route.mode, ())))


def overlapping_routes(visit: Visit, routes: Iterable[Route]) -> list[Route]:
    """The routes this visit probably restates; empty for an undated, long or unrelated visit."""
    if visit.starts_on is None:
        return []
    last = visit.ends_on or visit.starts_on
    if (last - visit.starts_on) > timedelta(days=MAX_JOURNEY_DAYS - 1):
        return []
    days = {visit.starts_on + timedelta(days=offset) for offset in range((last - visit.starts_on).days + 1)}
    return [
        route
        for route in routes
        if route.status not in (RouteStatus.IDEA, RouteStatus.CANCELLED)
        and visit.area_id in (route.departure_area_id, route.arrival_area_id)
        and days & route_days(route)
        and _about_the_journey(visit, route)
    ]
