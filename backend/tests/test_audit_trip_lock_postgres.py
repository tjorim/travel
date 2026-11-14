"""Optional real PostgreSQL test: deleting a trip and writing a sharing event with owner text are serialised (#364).

Set ``TRAVEL_TEST_DATABASE_URL`` to a server URL (any database on it); the test creates and drops its own."""

import os
import threading
import time
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.audit import record_audit_event
from app.database import Base
from app.errors import RecordNotFound
from app.models import AuditEvent, AuditEventKind, AuditTargetType, Trip
from app.services.trips import delete_trip, lock_trip


@pytest.fixture
def engine():
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    name = "audit_trip_lock_" + uuid4().hex
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f"CREATE DATABASE {name}"))
    target = make_url(url).set(database=name).render_as_string(hide_password=False)
    engine = create_engine(target)
    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()
        with admin.connect() as connection:
            connection.execute(text(f"DROP DATABASE {name} WITH (FORCE)"))
        admin.dispose()


def _trip(engine) -> str:
    with Session(engine) as session:
        trip = Trip(owner_subject="owner-1", title="Exampleland 2054")
        session.add(trip)
        session.commit()
        return trip.id


def _write_label(session: Session, trip_id: str) -> None:
    record_audit_event(
        session,
        trip_id=trip_id,
        actor_subject="owner-1",
        kind=AuditEventKind.SHARE_LINK_CREATE,
        target_type=AuditTargetType.SHARE_LINK,
        target_id="link-1",
        details={"label": "Secret Family Label"},
    )


def _delete_in_thread(engine, trip_id: str, failures: list) -> threading.Thread:
    def run() -> None:
        try:
            with Session(engine) as session:
                delete_trip(session, "owner-1", trip_id)
                session.commit()
        except BaseException as error:  # noqa: BLE001 - reported to the test
            failures.append(error)

    thread = threading.Thread(target=run)
    thread.start()
    return thread


def test_a_label_written_while_the_trip_is_being_deleted_is_scrubbed_with_it(engine) -> None:
    trip_id = _trip(engine)
    failures: list = []
    with Session(engine) as writer:
        lock_trip(writer, trip_id, "owner-1")
        _write_label(writer, trip_id)
        deleter = _delete_in_thread(engine, trip_id, failures)
        time.sleep(1)
        assert deleter.is_alive()  # waits for the writer's lock instead of scrubbing past its uncommitted row
        writer.commit()
    deleter.join(timeout=30)
    assert not deleter.is_alive() and not failures
    with Session(engine) as session:
        rows = list(session.scalars(select(AuditEvent).where(AuditEvent.trip_id == trip_id)))
        assert len(rows) == 1 and rows[0].details == {}
        assert session.get(Trip, trip_id) is None


def test_a_writer_that_arrives_after_the_delete_finds_no_trip(engine) -> None:
    trip_id = _trip(engine)
    failures: list = []
    with Session(engine) as deleter_session:
        delete_trip(deleter_session, "owner-1", trip_id)

        def write() -> None:
            try:
                with Session(engine) as session:
                    lock_trip(session, trip_id, "owner-1")
                    _write_label(session, trip_id)
                    session.commit()
            except BaseException as error:  # noqa: BLE001 - reported to the test
                failures.append(error)

        writer = threading.Thread(target=write)
        writer.start()
        time.sleep(1)
        assert writer.is_alive()  # waits for the delete's lock
        deleter_session.commit()
    writer.join(timeout=30)
    assert len(failures) == 1 and isinstance(failures[0], RecordNotFound)
    with Session(engine) as session:
        assert list(session.scalars(select(AuditEvent).where(AuditEvent.trip_id == trip_id))) == []
