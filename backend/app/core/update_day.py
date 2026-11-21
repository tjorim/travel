"""The local calendar day of a reisupdate: the one rule every surface follows.

An update is stored as one UTC instant (``occurred_at``) with no zone of its own. The zone it is read in is, in order:

1. the time zone of the update's own area (its location's area wins);
2. else the zone of the trip's stay or visit whose days are nearest to the update's UTC date (a stay or visit that
   covers the day wins, then the closest one; a tie goes to the earlier one), because an update written in a place
   that has no area of its own was written where the traveller was;
3. else UTC, only for a trip that has no zoned area on any dated stay or visit at all.

The day is the calendar date of the instant in that zone, so an update written at 07:00 in Taipei stays on its
Taipei day instead of the UTC day before. A zone name this server cannot resolve counts as no zone. Changing an
area's zone, or the dates or area of a stay or visit, can therefore move the days of the updates that follow it.

The visitor projection (``story_date``, the ``days`` number, "N days later"), the owner's lists and edit form, the
change summaries, the PDF and the export all call this module; none of them reads ``occurred_at.date()``.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


@lru_cache(maxsize=256)
def _zone(name: str | None) -> ZoneInfo | None:
    """The named IANA zone, or ``None`` when there is none to use: unnamed, unknown or unreadable."""
    if not name:
        return None
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError, ValueError, OSError:
        return None


def local_day(instant: datetime, zone: str | None) -> date:
    """The calendar date of ``instant`` in the zone ``zone`` (UTC when it is missing or invalid).

    SQLite hands back stored UTC instants without an offset, so a naive value is read as UTC."""
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=UTC)
    return instant.astimezone(_zone(zone) or UTC).date()


@dataclass(frozen=True)
class ZoneSpan:
    """The days (first to last, both inclusive) a stay or visit covers, and the zone of its area."""

    first: date
    last: date
    zone: str


def zone_span(first: date | None, last: date | None, zone: str | None) -> ZoneSpan | None:
    """A span, or ``None`` when the stay or visit has no day or its area has no zone this server can resolve."""
    if first is None or (name := usable_zone(zone)) is None:
        return None
    return ZoneSpan(first, max(first, last or first), name)


def stay_span(check_in: date, check_out: date, zone: str | None) -> ZoneSpan | None:
    """A stay covers the nights ``check_in <= d < check_out``: the check-out morning is not one of them."""
    return zone_span(check_in, check_out - timedelta(days=1), zone)


def collect_spans(spans: Iterable[ZoneSpan | None]) -> tuple[ZoneSpan, ...]:
    return tuple(span for span in spans if span is not None)


def zone_spans(trip: Any) -> tuple[ZoneSpan, ...]:
    """The zoned days of a trip's stays and visits (``trip.stays`` and ``trip.visits`` must be readable)."""
    return collect_spans(
        [stay_span(stay.check_in_date, stay.check_out_date, stay.area.timezone) for stay in trip.stays]
        + [zone_span(visit.starts_on, visit.ends_on, visit.area.timezone) for visit in trip.visits]
    )


def fallback_zone(instant: datetime, spans: tuple[ZoneSpan, ...]) -> str | None:
    """The zone of the span nearest the UTC date of ``instant``: one covering it, else the closest by days."""
    day = local_day(instant, None)

    def key(span: ZoneSpan) -> tuple[int, date, str]:
        distance = (
            0 if span.first <= day <= span.last else min(abs((day - span.first).days), abs((day - span.last).days))
        )
        return distance, span.first, span.zone

    return min(spans, key=key).zone if spans else None


def usable_zone(name: str | None) -> str | None:
    """``name`` when this server can resolve it as a zone, else ``None``."""
    return name if _zone(name) is not None else None


def area_zone(update: Any) -> str | None:
    """The zone name of the area a ``TravelUpdate`` belongs to, if it has a usable one."""
    area = update.area
    return usable_zone(area.timezone) if area is not None else None


def _spans_of(update: Any, spans: tuple[ZoneSpan, ...] | None) -> tuple[ZoneSpan, ...]:
    if spans is not None:
        return spans
    return zone_spans(update.trip) if update.trip is not None else ()


def at_wall_clock(wall_clock: datetime, zone: str) -> datetime:
    """The UTC instant at which a clock in ``zone`` reads ``wall_clock`` (an offset-less value).

    A time the zone skips (the hour a clock springs forward over) reads as an hour later, and a repeated one as its
    first occurrence."""
    return wall_clock.replace(tzinfo=_zone(zone) or UTC).astimezone(UTC)


def update_zone(update: Any, spans: tuple[ZoneSpan, ...] | None = None) -> str:
    """The zone a ``TravelUpdate`` is read in: its area's, else the trip's nearest, else ``UTC``.

    Pass the trip's ``zone_spans`` when reading many updates; without them they are read from the update's trip."""
    zone = area_zone(update)
    if zone is None:
        zone = fallback_zone(update.occurred_at, _spans_of(update, spans))
    return zone or "UTC"


def update_day(update: Any, spans: tuple[ZoneSpan, ...] | None = None) -> date:
    """The local calendar day of a ``TravelUpdate``, from its instant and its zone (see ``update_zone``)."""
    return local_day(update.occurred_at, update_zone(update, spans))
