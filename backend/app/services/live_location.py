"""What a live location shows an audience: the newest delayed, rounded, still-fresh position of each session."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import LivePoint, LiveSession


def now() -> datetime:
    return datetime.now(UTC)


def aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def current_for_audience(
    session: Session, trip_id: str, audience: str, *, rows: list[LiveSession] | None = None
) -> list[dict]:
    """Visitor callers enforce active scope gates; owner previews are private. Never used by exports."""
    result = []
    clock = now()
    for row in (
        rows
        if rows is not None
        else session.scalars(select(LiveSession).where(LiveSession.trip_id == trip_id, LiveSession.enabled.is_(True)))
    ):
        precision = row.audiences.get(audience)
        point = session.get(LivePoint, row.current_id) if row.current_id else None
        if not row.enabled or precision not in {"exact", "1km", "10km"} or point is None:
            continue
        source_expires = aware(point.observed_at) + timedelta(hours=24)
        if clock >= source_expires:
            continue
        delay = row.delays.get(audience, 0)
        cutoff = clock - timedelta(seconds=delay)
        # The unique (session_id, observed_at) index supports this bounded reverse scan.
        point = session.scalar(
            select(LivePoint)
            .where(LivePoint.session_id == row.id, LivePoint.observed_at <= cutoff)
            .order_by(LivePoint.observed_at.desc())
            .limit(1)
        )
        if point is None:
            continue
        age = cutoff - aware(point.observed_at)
        if age > timedelta(hours=24):
            continue
        digits = {"exact": None, "1km": 2, "10km": 1}[precision]
        result.append(
            {
                "latitude": round(point.latitude, digits) if digits is not None else point.latitude,
                "longitude": round(point.longitude, digits) if digits is not None else point.longitude,
                "observed_at": aware(point.observed_at).isoformat(),
                "stale": age > timedelta(hours=1),
                "delay_seconds": delay,
                "expires_at": min(
                    source_expires, aware(point.observed_at) + timedelta(seconds=delay, hours=24, milliseconds=1)
                ).isoformat(),
                "precision": precision,
            }
        )
    return result
