"""Optional real PostgreSQL test of migration 032 (live-location audiences as rows); uses a disposable database.

Set ``TRAVEL_TEST_DATABASE_URL`` to a server URL (any database on it); the test creates and drops its own."""

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.config import settings
from app.models import LinkState, ShareLink, Trip


@pytest.fixture
def database(monkeypatch):
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    name = "live_audiences_" + uuid4().hex
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


def _seed(engine) -> dict:
    """One trip with a link per state, and two sessions whose JSON dictionaries name them (and one that is gone)."""
    with Session(engine) as session:
        trip = Trip(owner_subject="owner-1", title="Exampleland 2054")
        other = Trip(owner_subject="owner-1", title="Elsewhere 2054")
        session.add_all([trip, other])
        session.flush()
        links = {
            state: ShareLink(trip_id=trip.id, label=state.value, series_id=uuid4().hex, state=state)
            for state in LinkState
        }
        foreign = ShareLink(trip_id=other.id, label="Foreign", series_id=uuid4().hex, state=LinkState.ACTIVE)
        session.add_all([*links.values(), foreign])
        session.flush()
        ids = {state: link.id for state, link in links.items()}
        full = {
            "public": "1km",
            ids[LinkState.ACTIVE]: "exact",
            ids[LinkState.DRAFT]: "10km",
            ids[LinkState.REVOKED]: "exact",
            ids[LinkState.EXPIRED]: "exact",
            "deleted-link": "exact",
            foreign.id: "exact",
        }
        delays = {"public": 900, ids[LinkState.ACTIVE]: 86400, ids[LinkState.REVOKED]: 3600}
        points = {"one": uuid4().hex, "two": uuid4().hex}
        now = datetime(2054, 4, 2, 10, tzinfo=UTC)
        for name, session_id, audiences, current in (
            ("full", "a" * 32, full, points["one"]),
            ("bare", "b" * 32, {}, "dangling" + "0" * 24),
        ):
            session.execute(
                text(
                    "INSERT INTO live_sessions (id, trip_id, source, enabled, current_id, audiences, delays) "
                    "VALUES (:id, :trip, :source, true, :current, CAST(:audiences AS json), CAST(:delays AS json))"
                ),
                {
                    "id": session_id,
                    "trip": trip.id,
                    "source": "person." + name,
                    "current": current,
                    "audiences": json.dumps(audiences),
                    "delays": json.dumps(delays if name == "full" else {}),
                },
            )
        session.execute(
            text(
                "INSERT INTO live_points (id, session_id, observed_at, latitude, longitude) "
                "VALUES (:id, :session, :at, 12.345678, 45.678912)"
            ),
            {"id": points["one"], "session": "a" * 32, "at": now},
        )
        session.commit()
        return {"trip": trip.id, "links": ids, "foreign": foreign.id, "point": points["one"]}


def _audiences(engine) -> dict[tuple[str, str], tuple[str, int]]:
    with engine.connect() as connection:
        return {
            (row.session_id, row.share_link_id or "public"): (row.precision, row.delay_seconds)
            for row in connection.execute(
                text("SELECT session_id, share_link_id, precision::text, delay_seconds FROM live_session_audiences")
            )
        }


def _constraints(engine, table: str) -> set[str]:
    with engine.connect() as connection:
        return set(
            connection.execute(
                text("SELECT conname FROM pg_constraint WHERE conrelid = CAST(:table AS regclass)"), {"table": table}
            ).scalars()
        )


def test_upgrade_moves_the_json_audiences_into_rows_and_the_downgrade_writes_them_back(database) -> None:
    engine, config = database
    command.upgrade(config, "031_audit_alignment")
    seeded = _seed(engine)
    links = seeded["links"]

    command.upgrade(config, "head")
    # The public view and every link that can still deliver (or is a draft) keep their precision and delay; the
    # revoked, expired, deleted and foreign ones were stale and are not carried over.
    assert _audiences(engine) == {
        ("a" * 32, "public"): ("1km", 900),
        ("a" * 32, links[LinkState.ACTIVE]): ("exact", 86400),
        ("a" * 32, links[LinkState.DRAFT]): ("10km", 0),
    }
    with engine.connect() as connection:
        columns = set(
            connection.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = 'live_sessions'")
            ).scalars()
        )
        sessions = connection.execute(text("SELECT id, current_id, created_at FROM live_sessions ORDER BY id")).all()
    assert {"created_at", "updated_at", "current_id"} <= columns and not {"audiences", "delays"} & columns
    # A current point that exists stays; one that did not is cleared, so the foreign key can hold.
    assert [(row.id, row.current_id) for row in sessions] == [("a" * 32, seeded["point"]), ("b" * 32, None)]
    assert all(row.created_at is not None for row in sessions)
    assert {"uq_live_points_session_observed", "ck_live_points_latitude", "ck_live_points_longitude"} <= _constraints(
        engine, "live_points"
    )
    assert {"ck_areas_latitude", "ck_areas_longitude"} <= _constraints(engine, "areas")
    assert {"ck_locations_latitude", "ck_locations_viewport_longitudes"} <= _constraints(engine, "locations")

    command.downgrade(config, "031_audit_alignment")
    with engine.connect() as connection:
        rows = {
            row.id: (row.audiences, row.delays)
            for row in connection.execute(text("SELECT id, audiences, delays FROM live_sessions"))
        }
        names = _constraints(engine, "live_points")
        types = set(
            connection.execute(text("SELECT typname FROM pg_type WHERE typname LIKE 'travel_live_%'")).scalars()
        )
    assert rows == {
        "a" * 32: (
            {"public": "1km", links[LinkState.ACTIVE]: "exact", links[LinkState.DRAFT]: "10km"},
            {"public": 900, links[LinkState.ACTIVE]: 86400, links[LinkState.DRAFT]: 0},
        ),
        "b" * 32: ({}, {}),
    }
    assert {
        "live_points_session_id_observed_at_key",
        "live_points_latitude_check",
        "live_points_longitude_check",
    } <= names
    assert not types

    # Up again: nothing was lost on the way down and back.
    command.upgrade(config, "head")
    assert len(_audiences(engine)) == 3

    # The database ties a setting to its link and a session to its point.
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM share_links WHERE id = :id"), {"id": links[LinkState.DRAFT]})
        connection.execute(text("DELETE FROM live_points WHERE id = :id"), {"id": seeded["point"]})
    assert ("a" * 32, links[LinkState.DRAFT]) not in _audiences(engine)
    assert len(_audiences(engine)) == 2
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT current_id FROM live_sessions WHERE id = :id"), {"id": "a" * 32}).scalar()
            is None
        )
    with engine.connect() as connection, pytest.raises(IntegrityError):
        connection.execute(
            text(
                "INSERT INTO live_session_audiences (id, session_id, kind, precision) "
                "VALUES ('x', :session, 'public', 'exact')"
            ),
            {"session": "a" * 32},
        )


def test_the_whole_chain_downgrades_to_base_and_upgrades_again(database) -> None:
    engine, config = database
    command.upgrade(config, "head")
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    assert "live_session_audiences" in set(inspect(engine).get_table_names())
