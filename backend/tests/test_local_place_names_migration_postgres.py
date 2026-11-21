"""Optional real PostgreSQL test of migration 035 (local place names, #376); uses a disposable database.

Set ``TRAVEL_TEST_DATABASE_URL`` to a server URL (any database on it); the test creates and drops its own."""

import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DataError

from alembic import command
from app.core.config import settings

PREVIOUS = "034_bilingual_texts"


@pytest.fixture
def database(monkeypatch):
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    name = "local_names_" + uuid4().hex
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


def _seed(engine) -> tuple[str, str]:
    """An area and a location at the previous revision (raw SQL: the models describe the head schema)."""
    trip, area, location = (uuid4().hex for _ in range(3))
    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO trips (id, owner_subject, title_nl) VALUES (:id, 'owner-1', 'Rondreis')"), {"id": trip}
        )
        connection.execute(
            text("INSERT INTO areas (id, trip_id, visibility, label_nl) VALUES (:id, :trip, 'private', 'Taipei')"),
            {"id": area, "trip": trip},
        )
        connection.execute(
            text(
                "INSERT INTO locations (id, trip_id, area_id, visibility, label_nl, share_address) "
                "VALUES (:id, :trip, :area, 'private', 'Station', false)"
            ),
            {"id": location, "trip": trip, "area": area},
        )
    return area, location


def _values(engine, sql: str) -> list[tuple]:
    with engine.connect() as connection:
        return [tuple(row) for row in connection.execute(text(sql))]


def test_a_local_name_is_nullable_on_existing_rows_bounded_and_the_downgrade_drops_it(database) -> None:
    engine, config = database
    command.upgrade(config, PREVIOUS)
    area, location = _seed(engine)

    command.upgrade(config, "head")
    # Nothing reads differently: existing places start without a local name.
    assert _values(engine, "SELECT label_nl, local_name FROM areas") == [("Taipei", None)]
    assert _values(engine, "SELECT label_nl, local_name FROM locations") == [("Station", None)]

    with engine.begin() as connection:
        connection.execute(text("UPDATE areas SET local_name = '台北' WHERE id = :id"), {"id": area})
        connection.execute(text("UPDATE locations SET local_name = '台北車站' WHERE id = :id"), {"id": location})
    assert _values(engine, "SELECT local_name FROM areas") == [("台北",)]
    # The column is as long as the labels are, counted in characters.
    with engine.begin() as connection:
        connection.execute(text("UPDATE areas SET local_name = :name"), {"name": "字" * 120})
    with pytest.raises(DataError), engine.begin() as connection:
        connection.execute(text("UPDATE areas SET local_name = :name"), {"name": "字" * 121})

    command.downgrade(config, PREVIOUS)
    columns = _values(
        engine,
        "SELECT table_name FROM information_schema.columns "
        "WHERE column_name = 'local_name' AND table_schema = 'public'",
    )
    assert columns == []
    # The rest of the rows is untouched by the way down and back up.
    assert _values(engine, "SELECT label_nl FROM areas") == [("Taipei",)]
    command.upgrade(config, "head")
    assert _values(engine, "SELECT local_name FROM areas") == [(None,)]
    command.downgrade(config, "base")
