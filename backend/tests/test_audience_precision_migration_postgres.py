"""Optional real PostgreSQL test of migration 019 (audience date precision); uses a disposable database.

Set ``TRAVEL_TEST_DATABASE_URL`` to a server URL (any database on it); the test creates and drops its own."""

import os
from datetime import date
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from alembic import command
from app.config import settings
from app.models import Area, DatePrecision, Location, PublicSurface, ShareLink, Stay, Trip, Visit


@pytest.fixture
def database(monkeypatch):
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    name = "audience_precision_" + uuid4().hex
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


def _seed(engine) -> dict[str, str]:
    """A trip at the previous revision: every record has an explicit precision, as every live record does."""
    with Session(engine) as session:
        trip = Trip(owner_subject="owner-1", title="Exampleland 2054")
        session.add(trip)
        session.flush()
        area = Area(trip_id=trip.id, label="Taipei")
        session.add(area)
        session.flush()
        location = Location(trip_id=trip.id, area_id=area.id, label="Taipei")
        session.add(location)
        session.flush()
        records = {
            "visit_month": Visit(
                trip_id=trip.id, position=0, area_id=area.id, share_date_precision=DatePrecision.MONTH
            ),
            "visit_day": Visit(trip_id=trip.id, position=1, area_id=area.id, share_date_precision=DatePrecision.DAY),
            "stay_year": Stay(
                trip_id=trip.id,
                location_id=location.id,
                check_in_date=date(2054, 4, 1),
                check_out_date=date(2054, 4, 3),
                share_date_precision=DatePrecision.YEAR,
            ),
        }
        session.add_all(records.values())
        session.add(PublicSurface(trip_id=trip.id, scope={"items": []}))
        session.commit()
        return {"trip": trip.id, **{key: record.id for key, record in records.items()}}


def _precision(engine, table: str, record_id: str) -> str | None:
    with engine.connect() as connection:
        return connection.execute(
            text(f"SELECT share_date_precision::text FROM {table} WHERE id = :id"), {"id": record_id}
        ).scalar_one()


def test_upgrade_keeps_every_explicit_value_and_the_downgrade_never_widens(database) -> None:
    engine, config = database
    command.upgrade(config, "018_collections")
    ids = _seed(engine)

    command.upgrade(config, "head")
    assert [_precision(engine, "visits", ids["visit_month"]), _precision(engine, "visits", ids["visit_day"])] == [
        "month",
        "day",
    ]
    assert _precision(engine, "stays", ids["stay_year"]) == "year"

    # After the upgrade a record can follow the audience, and an audience can cap its dates.
    with Session(engine) as session:
        session.get(Visit, ids["visit_month"]).share_date_precision = None
        session.add(
            ShareLink(trip_id=ids["trip"], label="Family", series_id="", scope={"defaults": {"date_precision": "year"}})
        )
        session.commit()
    assert _precision(engine, "visits", ids["visit_month"]) is None

    command.downgrade(config, "018_collections")
    # A followed record falls back to the old default; an explicit value is held to the coarsest audience cap,
    # because the older code ignores the audience setting.
    assert _precision(engine, "visits", ids["visit_month"]) == "year"
    assert _precision(engine, "visits", ids["visit_day"]) == "year"
    assert _precision(engine, "stays", ids["stay_year"]) == "year"
    with engine.connect() as connection:
        nullable = connection.execute(
            text(
                "SELECT is_nullable FROM information_schema.columns "
                "WHERE table_name = 'visits' AND column_name = 'share_date_precision'"
            )
        ).scalar_one()
    assert nullable == "NO"

    command.upgrade(config, "head")
    command.downgrade(config, "base")
