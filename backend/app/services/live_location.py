"""Live location: the owner's sessions and tracks, and what an audience is shown of them.

Visitor delivery calls only ``current_for_audience``. Everything else here is owner-only: tracks never reach a
visitor, an export of a trip or a preview other than the current, rounded and delayed position.

An audience is named by one key in code and on the wire: ``public`` for the public view, or the id of a hidden link
(``Audience.live_location_key``; a collection member has none, so live location is never shown to one, decision 244).
``AudienceRef`` turns it into the kind and referenced id a ``LiveSessionAudience`` row stores."""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import ColumnElement, and_, delete, select
from sqlalchemy.orm import Session

from ..audience import PUBLIC_KEY, Audience, Reach, audiences_of_trip
from ..errors import Conflict, RecordNotFound, Refusal, TooManyRequests
from ..models import (
    LiveAudienceKind,
    LivePoint,
    LivePrecision,
    LiveSession,
    LiveSessionAudience,
    Trip,
)
from ..schemas import (
    CurrentLocation,
    LivePointResponse,
    LivePositionAccepted,
    LivePositionInput,
    LiveSessionConfigure,
    LiveSessionCreate,
    LiveSessionResponse,
    LiveTrackPage,
)
from .trips import owned_trip

PUBLIC = PUBLIC_KEY
SESSION_LIMIT = 20
DIGITS = {LivePrecision.EXACT: None, LivePrecision.KM1: 2, LivePrecision.KM10: 1}


def now() -> datetime:
    return datetime.now(UTC)


def aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


@dataclass(frozen=True)
class AudienceRef:
    """An audience as its kind plus the record it names (the public view names none)."""

    kind: LiveAudienceKind
    link_id: str | None = None

    @classmethod
    def parse(cls, key: str) -> AudienceRef:
        return cls(LiveAudienceKind.PUBLIC) if key == PUBLIC else cls(LiveAudienceKind.LINK, key)

    @classmethod
    def of(cls, setting: LiveSessionAudience) -> AudienceRef:
        return cls(setting.kind, setting.share_link_id)

    @property
    def key(self) -> str:
        return PUBLIC if self.link_id is None else self.link_id

    @property
    def matches(self) -> ColumnElement[bool]:
        """The rows of ``LiveSessionAudience`` that are this audience."""
        if self.link_id is None:
            return LiveSessionAudience.kind == LiveAudienceKind.PUBLIC
        return and_(
            LiveSessionAudience.kind == LiveAudienceKind.LINK, LiveSessionAudience.share_link_id == self.link_id
        )


def forget_audience(session: Session, audience: Audience) -> None:
    """Remove the live-location setting of an audience that stops being one: an unpublished public view, or a link
    that was revoked, expired or rotated. (A deleted link takes its settings with it by ``ON DELETE CASCADE``.)
    The caller commits. The tracks and the session's own state are untouched. An audience live location cannot
    name (a collection member) has no setting to remove."""
    if audience.live_location_key is None:
        return
    session_ids = select(LiveSession.id).where(LiveSession.trip_id == audience.trip_id)
    session.execute(
        delete(LiveSessionAudience)
        .where(LiveSessionAudience.session_id.in_(session_ids), AudienceRef.parse(audience.live_location_key).matches)
        .execution_options(synchronize_session="fetch")
    )


def current_for_audience(
    session: Session, trip_id: str, audience: str, *, rows: list[LiveSession] | None = None
) -> list[dict]:
    """The one function that turns a live location into what an audience receives: the latest accepted point at or
    before the delay's cutoff, rounded to the audience's precision. Visitor callers enforce active scope gates;
    owner previews are private. Never used by exports."""
    result = []
    clock = now()
    query = (
        select(LiveSession, LiveSessionAudience)
        .join(LiveSessionAudience, LiveSessionAudience.session_id == LiveSession.id)
        .where(LiveSession.trip_id == trip_id, LiveSession.enabled.is_(True), AudienceRef.parse(audience).matches)
        .order_by(LiveSession.id)
    )
    if rows is not None:
        query = query.where(LiveSession.id.in_([row.id for row in rows]))
    for row, setting in session.execute(query):
        point = session.get(LivePoint, row.current_id) if row.current_id else None
        if point is None:
            continue
        source_expires = aware(point.observed_at) + timedelta(hours=24)
        if clock >= source_expires:
            continue
        delay = setting.delay_seconds
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
        digits = DIGITS[setting.precision]
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
                "precision": setting.precision.value,
            }
        )
    return result


# --- Owner sessions ---------------------------------------------------------------------------------------------


def owned_session(session: Session, subject: str, trip_id: str, session_id: str, *, lock: bool = False) -> LiveSession:
    owned_trip(session, trip_id, subject)
    query = select(LiveSession).where(LiveSession.id == session_id, LiveSession.trip_id == trip_id)
    result = session.scalar(query.with_for_update() if lock else query)
    if result is None:
        raise RecordNotFound("Session not found")
    return result


def point_response(point: LivePoint) -> LivePointResponse:
    return LivePointResponse(
        id=point.id, observed_at=aware(point.observed_at), latitude=point.latitude, longitude=point.longitude
    )


def session_response(session: Session, row: LiveSession) -> LiveSessionResponse:
    settings = {AudienceRef.of(setting).key: setting for setting in row.audiences}
    point = session.get(LivePoint, row.current_id) if row.current_id else None
    return LiveSessionResponse(
        id=row.id,
        source=row.source,
        enabled=row.enabled,
        audiences={key: setting.precision.value for key, setting in settings.items()},
        delays={key: setting.delay_seconds for key, setting in settings.items()},
        previews={
            key: [CurrentLocation(**shown) for shown in current_for_audience(session, row.trip_id, key, rows=[row])]
            for key in settings
        },
        current=point_response(point) if point else None,
        stale=bool(point and now() - aware(point.observed_at) > timedelta(hours=1)),
        created_at=aware(row.created_at),
        updated_at=aware(row.updated_at),
    )


def list_sessions(session: Session, subject: str, trip_id: str) -> list[LiveSessionResponse]:
    owned_trip(session, trip_id, subject)
    rows = session.scalars(select(LiveSession).where(LiveSession.trip_id == trip_id).order_by(LiveSession.created_at))
    return [session_response(session, row) for row in rows]


def create_session(session: Session, subject: str, trip_id: str, data: LiveSessionCreate) -> LiveSessionResponse:
    owned_trip(session, trip_id, subject)
    session.execute(select(Trip.id).where(Trip.id == trip_id).with_for_update())
    # Bound per-trip configuration, without a global in-memory owner registry.
    if (
        len(list(session.scalars(select(LiveSession.id).where(LiveSession.trip_id == trip_id).limit(SESSION_LIMIT))))
        >= SESSION_LIMIT
    ):
        raise Conflict("Session limit reached", code="live_session_limit")
    row = LiveSession(trip_id=trip_id, source=data.source)
    session.add(row)
    session.flush()
    session.refresh(row)
    return session_response(session, row)


def configure_session(
    session: Session, subject: str, trip_id: str, session_id: str, data: LiveSessionConfigure
) -> LiveSessionResponse:
    row = owned_session(session, subject, trip_id, session_id, lock=True)
    if data.delays is not None and data.delays.keys() - data.audiences.keys():
        raise Refusal("Delay for an audience that is not selected", code="live_delay_audience", field="delays")
    requested = {AudienceRef.parse(key): precision for key, precision in data.audiences.items()}
    link_ids = {ref.link_id for ref in requested if ref.link_id is not None}
    if link_ids:
        # A link that has not delivered anything yet (a draft) may be prepared in advance; a revoked or expired one
        # is gone. Only an audience live location can name qualifies.
        usable = {
            audience.live_location_key
            for audience in audiences_of_trip(session, trip_id, Reach.OPEN)
            if audience.live_location_key is not None
        }
        if link_ids - usable:
            raise Refusal("Unknown or unavailable audience", code="live_audience_unavailable", field="audiences")
    saved = {AudienceRef.of(setting): setting for setting in row.audiences}
    for ref, setting in saved.items():
        if ref not in requested:
            row.audiences.remove(setting)
    for ref, precision in requested.items():
        setting = saved.get(ref)
        if setting is None:
            setting = LiveSessionAudience(kind=ref.kind, share_link_id=ref.link_id, delay_seconds=0)
            row.audiences.append(setting)
        setting.precision = LivePrecision(precision)
        if data.delays is not None and ref.key in data.delays:
            setting.delay_seconds = data.delays[ref.key]
    if row.enabled != data.enabled:
        row.current_id = None
    row.enabled = data.enabled
    session.flush()
    session.refresh(row)
    return session_response(session, row)


def delete_session(session: Session, subject: str, trip_id: str, session_id: str) -> None:
    row = owned_session(session, subject, trip_id, session_id, lock=True)
    session.delete(row)


# --- Positions and tracks (owner only) --------------------------------------------------------------------------


def accept_position(
    session: Session, subject: str, trip_id: str, session_id: str, data: LivePositionInput
) -> LivePositionAccepted:
    row = owned_session(session, subject, trip_id, session_id, lock=True)
    if not row.enabled:
        raise Conflict("Session disabled", code="live_disabled")
    timestamp = aware(data.observed_at)
    clock = now()
    if not clock - timedelta(minutes=5) <= timestamp <= clock + timedelta(seconds=30):
        raise Refusal("Position outside freshness window", code="live_timestamp")
    if row.watermark is not None and timestamp <= aware(row.watermark):
        point = session.get(LivePoint, row.current_id) if row.current_id else None
        if (
            point
            and timestamp == aware(point.observed_at)
            and (data.latitude, data.longitude) == (point.latitude, point.longitude)
        ):
            return LivePositionAccepted(accepted=False)
        raise Conflict("Position already superseded", code="live_order")
    if row.accepted_at and clock - aware(row.accepted_at) < timedelta(seconds=30):
        raise TooManyRequests("Update too frequent", code="live_rate_limit", headers={"Retry-After": "30"})
    point = LivePoint(session_id=row.id, observed_at=timestamp, latitude=data.latitude, longitude=data.longitude)
    session.add(point)
    session.flush()
    row.current_id, row.watermark, row.accepted_at = point.id, timestamp, clock
    return LivePositionAccepted(accepted=True)


def track_page(
    session: Session, subject: str, trip_id: str, session_id: str, *, after: str, limit: int
) -> LiveTrackPage:
    row = owned_session(session, subject, trip_id, session_id)
    points = list(
        session.scalars(
            select(LivePoint)
            .where(LivePoint.session_id == row.id, LivePoint.id > after)
            .order_by(LivePoint.id)
            .limit(limit + 1)
        )
    )
    return LiveTrackPage(
        points=[point_response(p) for p in points[:limit]],
        next=points[limit - 1].id if len(points) > limit else None,
    )


def track_points(session: Session, subject: str, trip_id: str, session_id: str) -> Iterator[LivePointResponse]:
    """Every point of a session in order, for the owner's explicit export; never a story export or projection.
    The session is checked before the first point is read, so a refusal precedes the response."""
    row = owned_session(session, subject, trip_id, session_id)

    def points() -> Iterator[LivePointResponse]:
        for point in session.scalars(
            select(LivePoint)
            .where(LivePoint.session_id == row.id)
            .order_by(LivePoint.id)
            .execution_options(yield_per=500)
        ):
            yield point_response(point)

    return points()


def delete_tracks(session: Session, subject: str, trip_id: str, session_id: str) -> None:
    row = owned_session(session, subject, trip_id, session_id, lock=True)
    row.current_id = None
    session.flush()
    session.execute(delete(LivePoint).where(LivePoint.session_id == row.id))
