"""Optional real PostgreSQL test: a scope edit reads the stored scope under the row lock (#360).

Set ``TRAVEL_TEST_DATABASE_URL`` to a server URL (any database on it); the test creates and drops its own."""

import os
import threading
import time
from collections.abc import Generator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.auth import current_subject
from app.database import Base, get_session
from app.main import app
from app.models import ShareLink
from app.schemas import ShareScopeInput
from app.services import audiences
from app.services.trips import owned_trip


@pytest.fixture
def engine():
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    name = "audience_edit_lock_" + uuid4().hex
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f"CREATE DATABASE {name}"))
    target = make_url(url).set(database=name).render_as_string(hide_password=False)
    engine = create_engine(target)
    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
        with admin.connect() as connection:
            connection.execute(text(f"DROP DATABASE {name} WITH (FORCE)"))
        admin.dispose()


def _owner(engine) -> TestClient:
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    def override() -> Generator[Session]:
        with factory() as session:
            yield session

    app.dependency_overrides[get_session] = override
    app.dependency_overrides[current_subject] = lambda: "owner-1"
    return TestClient(app)


def test_an_edit_that_waits_for_a_concurrent_exclusion_keeps_it(engine) -> None:
    owner = _owner(engine)
    trip = owner.post("/api/trips", json={"title": "Exampleland 2054"}).json()
    update = owner.post(
        f"/api/trips/{trip['id']}/travel-updates",
        json={
            "occurred_at": "2054-04-04T10:00:00Z",
            "share_date_precision": "day",
            "title": "Shared story",
            "body": "A safe note.",
            "visibility": "everyone",
        },
    ).json()
    link = owner.post(f"/api/trips/{trip['id']}/share-links", json={"label": "Family", "scope": {}}).json()
    exclusion = {"kind": "travel_update", "id": update["id"]}

    loaded, proceed = threading.Event(), threading.Event()
    failures: list[BaseException] = []

    def label_edit() -> None:
        """An edit that loaded the link before the exclusion committed, and sends no exclusions of its own."""
        try:
            with Session(engine) as session:
                audience = audiences.owned_link(session, "owner-1", trip["id"], link["id"])
                loaded.set()
                proceed.wait(timeout=10)
                loaded_trip = owned_trip(session, trip["id"], "owner-1", load_relations=True)
                audiences.edit_scope(
                    session, "owner-1", audience, loaded_trip, ShareScopeInput(items=[]), if_match=None
                )
                session.commit()
        except BaseException as error:  # noqa: BLE001 - reported to the test
            failures.append(error)

    thread = threading.Thread(target=label_edit)
    thread.start()
    assert loaded.wait(timeout=10)
    with Session(engine) as other:
        row = other.get(ShareLink, link["id"])
        assert row is not None
        other.refresh(row, with_for_update=True)
        row.scope = {**row.scope, "exclude": [exclusion]}
        other.flush()
        proceed.set()
        time.sleep(0.5)
        assert thread.is_alive()  # the edit waits for the row instead of reading the older scope
        other.commit()
    thread.join(timeout=10)

    assert not failures, failures
    with Session(engine) as session:
        stored = session.get(ShareLink, link["id"])
        assert stored is not None
        assert stored.scope.get("exclude") == [exclusion]
