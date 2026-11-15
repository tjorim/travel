"""Optional real PostgreSQL test of migration 034 (Dutch and English texts, #376); uses a disposable database.

Set ``TRAVEL_TEST_DATABASE_URL`` to a server URL (any database on it); the test creates and drops its own."""

import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

from alembic import command
from app.config import settings

PREVIOUS = "033_one_document_model"


@pytest.fixture
def database(monkeypatch):
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    name = "bilingual_" + uuid4().hex
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


def _seed(engine) -> str:
    """One trip holding every text field at the previous revision (raw SQL: the models describe the head schema)."""
    trip, area, location, update = (uuid4().hex for _ in range(4))
    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO trips (id, owner_subject, title, summary) VALUES (:id, 'owner-1', 'Rondreis', 'Kort')"),
            {"id": trip},
        )
        connection.execute(
            text("INSERT INTO areas (id, trip_id, visibility, label) VALUES (:id, :trip, 'private', 'Brussel')"),
            {"id": area, "trip": trip},
        )
        connection.execute(
            text("INSERT INTO areas (id, trip_id, visibility) VALUES (:id, :trip, 'private')"),
            {"id": uuid4().hex, "trip": trip},
        )
        connection.execute(
            text(
                "INSERT INTO locations (id, trip_id, area_id, visibility, label, share_address) "
                "VALUES (:id, :trip, :area, 'private', 'Station', false)"
            ),
            {"id": location, "trip": trip, "area": area},
        )
        connection.execute(
            text(
                "INSERT INTO visits (id, trip_id, area_id, title, summary, status, visibility, share_time) "
                "VALUES (:id, :trip, :area, 'Museum', 'Mooi', 'planned', 'private', false)"
            ),
            {"id": uuid4().hex, "trip": trip, "area": area},
        )
        connection.execute(
            text(
                "INSERT INTO routes (id, trip_id, mode, status, label, departure_area_id, arrival_area_id, visibility) "
                "VALUES (:id, :trip, 'train', 'planned', 'Trein', :area, :area, 'private')"
            ),
            {"id": uuid4().hex, "trip": trip, "area": area},
        )
        for identifier, body in ((update, "Een dag"), (uuid4().hex, "")):
            connection.execute(
                text(
                    "INSERT INTO travel_updates (id, share_id, trip_id, occurred_at, share_date_precision, title, body, "
                    "visibility) VALUES (:id, :share, :trip, now(), 'day', 'Dag een', :body, 'private')"
                ),
                {"id": identifier, "share": uuid4().hex, "trip": trip, "body": body},
            )
        connection.execute(
            text(
                "INSERT INTO collections (id, owner_subject, label, title, state, rotations) "
                "VALUES (:id, 'owner-1', 'Familie', 'Reizen', 'draft', 0)"
            ),
            {"id": uuid4().hex},
        )
    return trip


def _values(engine, sql: str) -> list[tuple]:
    with engine.connect() as connection:
        return [tuple(row) for row in connection.execute(text(sql))]


def test_existing_text_moves_to_dutch_and_the_downgrade_restores_the_content_language(database) -> None:
    engine, config = database
    command.upgrade(config, PREVIOUS)
    trip = _seed(engine)

    command.upgrade(config, "head")
    assert _values(engine, "SELECT content_language, title_nl, title_en, summary_nl, summary_en FROM trips") == [
        ("nl", "Rondreis", None, "Kort", None)
    ]
    assert _values(engine, "SELECT label_nl, label_en FROM areas ORDER BY label_nl NULLS LAST") == [
        ("Brussel", None),
        (None, None),
    ]
    assert _values(engine, "SELECT label_nl, label_en FROM locations") == [("Station", None)]
    assert _values(engine, "SELECT title_nl, title_en, summary_nl, summary_en FROM visits") == [
        ("Museum", None, "Mooi", None)
    ]
    assert _values(engine, "SELECT label_nl, label_en FROM routes") == [("Trein", None)]
    # An empty body is no text in either language.
    assert _values(engine, "SELECT title_nl, body_nl FROM travel_updates ORDER BY body_nl NULLS LAST") == [
        ("Dag een", "Een dag"),
        ("Dag een", None),
    ]
    assert _values(engine, "SELECT content_language, title_nl, title_en FROM collections") == [("nl", "Reizen", None)]

    # A trip needs a title in at least one language, and a content language the application knows.
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(text("UPDATE trips SET title_nl = NULL WHERE id = :id"), {"id": trip})
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(text("UPDATE trips SET content_language = 'de' WHERE id = :id"), {"id": trip})

    # Write English texts and mark the trip as English: the downgrade keeps the content language's text, else the other.
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE trips SET content_language = 'en', title_en = 'Round trip', title_nl = NULL, summary_nl = 'Kort' "
                "WHERE id = :id"
            ),
            {"id": trip},
        )
        connection.execute(text("UPDATE visits SET title_en = 'Museum visit'"))
        connection.execute(text("UPDATE areas SET label_en = 'Brussels' WHERE label_nl = 'Brussel'"))
    command.downgrade(config, PREVIOUS)
    assert _values(engine, "SELECT title, summary FROM trips") == [("Round trip", "Kort")]
    assert _values(engine, "SELECT title, summary FROM visits") == [("Museum visit", "Mooi")]
    assert _values(engine, "SELECT label FROM areas ORDER BY label NULLS LAST") == [("Brussels",), (None,)]
    assert _values(engine, "SELECT body FROM travel_updates ORDER BY body") == [("",), ("Een dag",)]
    assert _values(engine, "SELECT title FROM collections") == [("Reizen",)]

    command.upgrade(config, "head")
    assert _values(engine, "SELECT content_language, title_nl, title_en FROM trips") == [("nl", "Round trip", None)]
