"""Optional real PostgreSQL test of migration 030 (a travel update's share_date_precision); uses a disposable database.

Set ``TRAVEL_TEST_DATABASE_URL`` to a server URL (any database on it); the test creates and drops its own."""

import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from alembic import command
from app.config import settings
from app.models import DatePrecision, TravelUpdate, Trip

PREVIOUS = "029_visit_order"


@pytest.fixture
def database(monkeypatch):
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    name = "update_precision_" + uuid4().hex
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


def _columns(engine) -> set[str]:
    with engine.connect() as connection:
        return set(
            connection.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = 'travel_updates'")
            ).scalars()
        )


def test_upgrade_renames_the_column_keeping_each_value_and_the_downgrade_restores_it(database) -> None:
    engine, config = database
    command.upgrade(config, PREVIOUS)
    assert "date_precision" in _columns(engine)
    with Session(engine) as session:
        trip = Trip(owner_subject="owner-1", title="Exampleland 2054")
        session.add(trip)
        session.flush()
        for precision in ("day", "month", "year"):
            # Raw SQL: the model describes the head schema, whose column has the new name.
            session.execute(
                text(
                    "INSERT INTO travel_updates (id, share_id, trip_id, occurred_at, date_precision, title, body, "
                    "visibility) VALUES (:id, :share, :trip, '2054-04-04T10:00:00+00', :precision, :title, '', "
                    "'private')"
                ),
                {"id": uuid4().hex, "share": uuid4().hex, "trip": trip.id, "precision": precision, "title": precision},
            )
        session.commit()
        trip_id = trip.id

    command.upgrade(config, "head")
    columns = _columns(engine)
    assert "share_date_precision" in columns and "date_precision" not in columns
    with Session(engine) as session:
        updates = session.get(Trip, trip_id).travel_updates
        assert {update.title: update.share_date_precision for update in updates} == {
            "day": DatePrecision.DAY,
            "month": DatePrecision.MONTH,
            "year": DatePrecision.YEAR,
        }
        assert all(isinstance(update, TravelUpdate) for update in updates)

    command.downgrade(config, PREVIOUS)
    columns = _columns(engine)
    assert "date_precision" in columns and "share_date_precision" not in columns
    with engine.connect() as connection:
        rows = connection.execute(text("SELECT title, date_precision::text FROM travel_updates")).all()
    assert {row[0]: row[1] for row in rows} == {"day": "day", "month": "month", "year": "year"}
