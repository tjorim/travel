"""Optional real PostgreSQL test of migration 029 (visits ordered by date); uses a disposable database.

Set ``TRAVEL_TEST_DATABASE_URL`` to a server URL (any database on it); the test creates and drops its own."""

import os
from datetime import date, time
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.config import settings
from app.models import Area, Trip, Visit


@pytest.fixture
def database(monkeypatch):
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    name = "visit_order_" + uuid4().hex
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f"CREATE DATABASE {name}"))
    target = make_url(url).set(database=name).render_as_string(hide_password=False)
    monkeypatch.setattr(settings, "database_url", target)
    engine = create_engine(target)
    try:
        # No ini file: env.py would otherwise reconfigure (and silence) the loggers other tests capture.
        config = Config()
        config.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
        yield engine, config
    finally:
        engine.dispose()
        with admin.connect() as connection:
            connection.execute(text(f"DROP DATABASE {name} WITH (FORCE)"))
        admin.dispose()


# (title, position, starts_on, start_time): every visit was converted in one statement, so they share a created_at.
VISITS = [
    ("Idea B", 0, None, None),
    ("Dinner", 1, date(2054, 4, 2), time(19, 0)),
    ("Walk", 2, date(2054, 4, 2), None),
    ("Idea A", 3, None, None),
    ("Museum", 4, date(2054, 4, 1), None),
    ("Breakfast", 5, date(2054, 4, 2), time(8, 0)),
]


def _seed(engine) -> tuple[str, str]:
    with Session(engine) as session:
        trip = Trip(owner_subject="owner-1", title="Exampleland 2054")
        session.add(trip)
        session.flush()
        area = Area(trip_id=trip.id, label="Taipei")
        session.add(area)
        session.flush()
        # Raw SQL: the Visit model describes the head schema, which has no position.
        for title, position, day, at in VISITS:
            session.execute(
                text(
                    'INSERT INTO visits (id, trip_id, "position", area_id, title, starts_on, start_time, status, '
                    "visibility, share_time, created_at) VALUES (:id, :trip, :position, :area, :title, :day, :at, "
                    "'planned', 'private', false, '2026-01-01T00:00:00+00')"
                ),
                {
                    "id": uuid4().hex,
                    "trip": trip.id,
                    "position": position,
                    "area": area.id,
                    "title": title,
                    "day": day,
                    "at": at,
                },
            )
        session.commit()
        return trip.id, area.id


def _titles(engine, trip_id: str) -> list[str | None]:
    with Session(engine) as session:
        return [visit.title for visit in session.get(Trip, trip_id).visits]


def test_upgrade_drops_the_position_and_keeps_ties_in_their_old_order_and_the_downgrade_restores_it(database) -> None:
    engine, config = database
    command.upgrade(config, "028_planning_status")
    trip_id, area_id = _seed(engine)

    command.upgrade(config, "head")
    with engine.connect() as connection:
        columns = set(
            connection.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = 'visits'")
            ).scalars()
        )
        constraints = set(
            connection.execute(text("SELECT conname FROM pg_constraint WHERE conrelid = 'visits'::regclass")).scalars()
        )
    assert "position" not in columns and "uq_visit_position" not in constraints
    # By day, then time (untimed after timed), then the old order among ties; undated last.
    assert _titles(engine, trip_id) == ["Museum", "Breakfast", "Dinner", "Walk", "Idea B", "Idea A"]
    with Session(engine) as session:
        session.add(Visit(trip_id=trip_id, area_id=area_id, title="Newest"))
        session.commit()
    assert _titles(engine, trip_id)[-1] == "Newest"

    command.downgrade(config, "028_planning_status")
    with engine.connect() as connection:
        rows = connection.execute(text('SELECT title, "position" FROM visits ORDER BY "position"')).all()
    assert [row.title for row in rows] == ["Museum", "Breakfast", "Dinner", "Walk", "Idea B", "Idea A", "Newest"]
    assert [row.position for row in rows] == list(range(7))
    with engine.connect() as connection, pytest.raises(IntegrityError):
        connection.execute(text('UPDATE visits SET "position" = 0'))
