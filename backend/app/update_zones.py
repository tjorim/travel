"""Read a trip's zoned stay and visit days from the database, for the surfaces that do not load the whole trip.

The rule itself lives in ``app.update_day``; this module only feeds it with two small queries."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Area, Stay, Visit
from .update_day import ZoneSpan, collect_spans, stay_span, zone_span


def trip_zone_spans(session: Session, trip_id: str) -> tuple[ZoneSpan, ...]:
    """The zoned days of one trip's stays and visits (see ``app.update_day.update_zone``)."""
    stays = session.execute(
        select(Stay.check_in_date, Stay.check_out_date, Area.timezone)
        .join(Area, Area.id == Stay.area_id)
        .where(Stay.trip_id == trip_id, Area.timezone.is_not(None))
    )
    visits = session.execute(
        select(Visit.starts_on, Visit.ends_on, Area.timezone)
        .join(Area, Area.id == Visit.area_id)
        .where(Visit.trip_id == trip_id, Visit.starts_on.is_not(None), Area.timezone.is_not(None))
    )
    return collect_spans(
        [stay_span(check_in, check_out, zone) for check_in, check_out, zone in stays]
        + [zone_span(first, last, zone) for first, last, zone in visits]
    )
