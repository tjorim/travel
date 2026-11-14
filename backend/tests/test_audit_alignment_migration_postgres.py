"""Optional real PostgreSQL test of migration 031 (the audit tables, #364); uses a disposable database.

Set ``TRAVEL_TEST_DATABASE_URL`` to a server URL (any database on it); the test creates and drops its own."""

import json
import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from alembic import command
from app.config import settings

PREVIOUS = "030_update_share_date_precision"


@pytest.fixture
def database(monkeypatch):
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    name = "audit_alignment_" + uuid4().hex
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


def _insert_sharing(connection, trip: str, kind: str, target_type: str, target: str) -> None:
    connection.execute(
        text(
            "INSERT INTO audit_events (id, trip_id, actor_subject, kind, target_type, target_id, details) "
            "VALUES (:id, :trip, 'owner-1', :kind, :target_type, :target, CAST('{}' AS json))"
        ),
        {"id": uuid4().hex, "trip": trip, "kind": kind, "target_type": target_type, "target": target},
    )


def _insert_activity(connection, action: str, details: dict, trip: str) -> None:
    connection.execute(
        text(
            "INSERT INTO mcp_audit_events (id, owner_subject, action, resource_type, trip_id, result, details) "
            "VALUES (:id, 'owner-1', :action, 'trip', :trip, 'success', CAST(:details AS json))"
        ),
        {"id": uuid4().hex, "action": action, "trip": trip, "details": json.dumps(details)},
    )


def _seed(engine) -> str:
    """A trip with sharing, collection and owner activity events at the previous revision."""
    trip = uuid4().hex
    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO trips (id, owner_subject, title) VALUES (:id, 'owner-1', 'Exampleland 2054')"),
            {"id": trip},
        )
        _insert_sharing(connection, trip, "public_projection.publish", "public_surface", trip)
        _insert_sharing(connection, trip, "audience.preset_apply", "public_surface", trip)
        _insert_sharing(connection, trip, "audience.preset_apply", "share_link", "link-1")
        _insert_sharing(connection, trip, "alternative_group.choose", "alternative_group", "group-1")
        _insert_activity(connection, "trip.get", {}, trip)
        _insert_activity(connection, "trip.export", {"schema_version": 1, "transport": "http"}, trip)
        _insert_activity(connection, "trip.delete", {"error": "Refused"}, trip)
        connection.execute(
            text(
                "INSERT INTO collection_audit_events (id, owner_subject, actor_subject, collection_id, kind, details) "
                "VALUES (:id, 'owner-1', 'owner-1', 'collection-1', 'collection.create', CAST('{}' AS json))"
            ),
            {"id": uuid4().hex},
        )
    return trip


def _types(engine) -> set[str]:
    with engine.connect() as connection:
        return set(
            connection.execute(
                text(
                    "SELECT typname FROM pg_type WHERE typname IN ('travel_audit_event_kind', 'travel_audit_target_type')"
                )
            ).scalars()
        )


def _tables(engine) -> set[str]:
    with engine.connect() as connection:
        return set(
            connection.execute(
                text(
                    "SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%audit_events' "
                    "OR table_name = 'owner_activity_events'"
                )
            ).scalars()
        )


def _sharing(engine) -> list[tuple[str, str]]:
    with engine.connect() as connection:
        return sorted(tuple(row) for row in connection.execute(text("SELECT kind, target_type FROM audit_events")))


def test_upgrade_keeps_the_rows_and_a_trip_deletion_no_longer_removes_sharing_events(database) -> None:
    engine, config = database
    command.upgrade(config, PREVIOUS)
    trip = _seed(engine)
    assert _types(engine) == {"travel_audit_event_kind", "travel_audit_target_type"}

    command.upgrade(config, "head")
    assert _types(engine) == set()
    assert "mcp_audit_events" not in _tables(engine) and "owner_activity_events" in _tables(engine)
    with engine.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT data_type FROM information_schema.columns WHERE table_name = 'audit_events' AND column_name = 'kind'"
                )
            ).scalar_one()
            == "character varying"
        )
        rows = connection.execute(
            text("SELECT action, transport, details FROM owner_activity_events ORDER BY action")
        ).all()
    # The transport leaves ``details``; a row that never recorded one was an MCP call.
    assert [(action, transport, details) for action, transport, details in rows] == [
        ("trip.delete", "mcp", {"error": "Refused"}),
        ("trip.export", "http", {"schema_version": 1}),
        ("trip.get", "mcp", {}),
    ]
    # The preset kind is named after what it targeted; every other row is unchanged.
    assert _sharing(engine) == [
        ("alternative_group.choose", "alternative_group"),
        ("public_projection.preset_apply", "public_surface"),
        ("public_projection.publish", "public_surface"),
        ("share_link.preset_apply", "share_link"),
    ]
    # A kind the older schema never had needs no migration, and deleting the trip leaves its sharing events.
    with engine.begin() as connection:
        _insert_sharing(connection, trip, "feed.future_kind", "public_surface", trip)
        connection.execute(text("DELETE FROM trips WHERE id = :id"), {"id": trip})
    assert len(_sharing(engine)) == 5
    with engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM owner_activity_events")).scalar_one() == 3
        assert connection.execute(text("SELECT count(*) FROM collection_audit_events")).scalar_one() == 1


def test_downgrade_restores_the_enums_the_cascade_and_the_transport_then_the_round_trip_is_clean(database) -> None:
    engine, config = database
    command.upgrade(config, PREVIOUS)
    trip = _seed(engine)
    command.upgrade(config, "head")
    orphan = uuid4().hex
    with engine.begin() as connection:
        _insert_sharing(connection, orphan, "share_link.create", "share_link", "link-2")  # its trip is gone
        _insert_sharing(connection, trip, "feed.future_kind", "public_surface", trip)  # unknown to older code

    command.downgrade(config, PREVIOUS)
    assert _types(engine) == {"travel_audit_event_kind", "travel_audit_target_type"}
    assert "mcp_audit_events" in _tables(engine) and "owner_activity_events" not in _tables(engine)
    assert _sharing(engine) == [
        ("alternative_group.choose", "alternative_group"),
        ("audience.preset_apply", "public_surface"),
        ("audience.preset_apply", "share_link"),
        ("public_projection.publish", "public_surface"),
    ]
    with engine.connect() as connection:
        details = connection.execute(text("SELECT action, details FROM mcp_audit_events ORDER BY action")).all()
    assert {action: detail["transport"] for action, detail in details} == {
        "trip.delete": "mcp",
        "trip.export": "http",
        "trip.get": "mcp",
    }
    # The cascade is back: deleting the trip removes its sharing events again.
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM trips WHERE id = :id"), {"id": trip})
    assert _sharing(engine) == []

    command.downgrade(config, "base")
    command.upgrade(config, "head")
    assert _types(engine) == set()
