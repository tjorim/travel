"""The local calendar day of a reisupdate: the one rule every surface follows.

An update is stored as one UTC instant (``occurred_at``) with no zone of its own. The day it belongs to is
the calendar day of that instant in the time zone of the update's area, so an update written at 07:00 in Taipei
stays on its Taipei day instead of the UTC day before. An area without a zone (or with a name this server cannot
resolve) falls back to the instant's UTC date. Changing an area's zone therefore moves the days of its updates.

The visitor projection (``story_date``, the ``days`` number, "N days later"), the owner's own labels, the
change summaries, the PDF and the export all call this module; none of them reads ``occurred_at.date()``.
"""

from datetime import UTC, date, datetime
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


def update_zone(update: Any) -> str | None:
    """The zone name of the area a ``TravelUpdate`` belongs to, if any."""
    area = update.area
    return area.timezone if area is not None else None


def update_day(update: Any) -> date:
    """The local calendar day of a ``TravelUpdate``, from its instant and its area's zone."""
    return local_day(update.occurred_at, update_zone(update))
