"""Optional real PostgreSQL test of migration 022 (the sharing preset label); uses a disposable database.

Set ``TRAVEL_TEST_DATABASE_URL`` to a server URL (any database on it); the test creates and drops its own."""

import json
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
from app.models import (
    AuditEvent,
    AuditEventKind,
    AuditTargetType,
    Collection,
    CollectionAuditEvent,
    CollectionMember,
    LinkState,
    PublicSurface,
    ShareLink,
    Trip,
)

PREVIOUS = "021_alternative_groups"
TABLES = ("public_surfaces", "share_links", "collection_members")


@pytest.fixture
def database(monkeypatch):
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    name = "preset_label_" + uuid4().hex
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


SCOPES = {
    "public_surfaces": {"defaults": {"date_precision": "month"}, "items": []},
    "share_links": {"items": [{"kind": "travel_update", "id": "u1"}], "exclude": [{"kind": "visit", "id": "v1"}]},
    "collection_members": {"trip": {"title": True}},  # no `defaults` at all: a legacy scope
}


def _seed(engine) -> dict[str, str]:
    """A trip with every audience kind at the previous revision, whose scopes the migration must not touch."""
    with Session(engine) as session:
        trip = Trip(owner_subject="owner-1", title="Exampleland 2054")
        session.add(trip)
        session.flush()
        collection = Collection(owner_subject="owner-1", label="Family", state=LinkState.DRAFT)
        session.add(collection)
        session.flush()
        # Raw SQL: the models describe the head schema, which has the label columns this revision adds.
        ids = {"trip": trip.id, "link": uuid4().hex, "collection": collection.id, "member": uuid4().hex}
        for statement, values in (
            (
                "INSERT INTO public_surfaces (trip_id, slug, state, revision, scope) "
                "VALUES (:trip, :slug, 'unpublished', 1, CAST(:scope AS json))",
                {"trip": trip.id, "slug": uuid4().hex, "scope": json.dumps(SCOPES["public_surfaces"])},
            ),
            (
                "INSERT INTO share_links (id, trip_id, label, series_id, state, revision, scope) "
                "VALUES (:id, :trip, 'Friends', 's', 'draft', 1, CAST(:scope AS json))",
                {"id": ids["link"], "trip": trip.id, "scope": json.dumps(SCOPES["share_links"])},
            ),
            (
                "INSERT INTO collection_members (id, collection_id, trip_id, revision, scope) "
                "VALUES (:id, :collection, :trip, 1, CAST(:scope AS json))",
                {
                    "id": ids["member"],
                    "collection": collection.id,
                    "trip": trip.id,
                    "scope": json.dumps(SCOPES["collection_members"]),
                },
            ),
        ):
            session.execute(text(statement), values)
        # Raw SQL: the kind is a PostgreSQL enum at this revision.
        session.execute(
            text(
                "INSERT INTO audit_events (id, trip_id, actor_subject, kind, target_type, target_id, details) "
                "VALUES (:id, :trip, 'owner-1', 'public_projection.publish', 'public_surface', :trip, CAST('{}' AS json))"
            ),
            {"id": uuid4().hex, "trip": trip.id},
        )
        session.add(
            CollectionAuditEvent(
                owner_subject="owner-1",
                actor_subject="owner-1",
                collection_id=collection.id,
                kind="collection.create",
                details={},
            )
        )
        session.commit()
        return ids


def _scopes(engine) -> dict[str, dict]:
    with engine.connect() as connection:
        return {
            table: connection.execute(text(f"SELECT scope FROM {table}")).scalar_one()
            for table in TABLES  # noqa: S608
        }


def _columns(engine, table: str) -> set[str]:
    with engine.connect() as connection:
        return set(
            connection.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = :table"), {"table": table}
            )
            .scalars()
            .all()
        )


def test_the_label_columns_are_added_nullable_and_the_downgrade_removes_what_depends_on_them(database) -> None:
    engine, config = database
    command.upgrade(config, PREVIOUS)
    ids = _seed(engine)
    assert _scopes(engine) == SCOPES
    for table in TABLES:
        assert not {"applied_preset", "applied_preset_at"} & _columns(engine, table)

    command.upgrade(config, "head")
    # Existing rows keep their scope exactly and carry no label, so every audience delivers what it did.
    assert _scopes(engine) == SCOPES
    for table in TABLES:
        assert {"applied_preset", "applied_preset_at"} <= _columns(engine, table)
    with engine.connect() as connection:
        for table in TABLES:
            row = connection.execute(text(f"SELECT applied_preset, applied_preset_at FROM {table}")).one()  # noqa: S608
            assert tuple(row) == (None, None)

    # The label and the new audit vocabulary work.
    with Session(engine) as session:
        for model, key in ((PublicSurface, ids["trip"]), (ShareLink, ids["link"]), (CollectionMember, ids["member"])):
            row = session.get(model, key)
            row.applied_preset = "story_only"
        session.add(
            AuditEvent(
                trip_id=ids["trip"],
                actor_subject="owner-1",
                kind=AuditEventKind.SHARE_LINK_PRESET_APPLY,
                target_type=AuditTargetType.SHARE_LINK,
                target_id=ids["link"],
                details={"preset": "story_only"},
            )
        )
        session.add(
            CollectionAuditEvent(
                owner_subject="owner-1",
                actor_subject="owner-1",
                collection_id=ids["collection"],
                kind="collection.member_preset_apply",
                details={"preset": "story_only"},
            )
        )
        session.commit()
    with engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM audit_events")).scalar_one() == 2

    # Down: the columns go, the rows that use the new kind go, every other row and every scope stays.
    command.downgrade(config, PREVIOUS)
    for table in TABLES:
        assert not {"applied_preset", "applied_preset_at"} & _columns(engine, table)
    assert _scopes(engine) == SCOPES
    with engine.connect() as connection:
        assert connection.execute(text("SELECT kind FROM audit_events")).scalars().all() == [
            "public_projection.publish"
        ]
        assert connection.execute(text("SELECT kind FROM collection_audit_events")).scalars().all() == [
            "collection.create"
        ]

    # Down to base and up again: the round trip is clean.
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    for table in TABLES:
        assert {"applied_preset", "applied_preset_at"} <= _columns(engine, table)
