import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import maintenance
from app.database import Base
from app.models import ObjectState, OwnerStoredObject, StoredObject, Trip
from app.storage import LocalObjectStorage, lock_object_deletion
from app.storage_reconcile import remove_unreferenced_objects, unreferenced_objects

NOW = datetime(2054, 10, 20, 12, tzinfo=UTC)
OLD = (NOW - timedelta(days=2)).timestamp()
FRESH = (NOW - timedelta(minutes=5)).timestamp()


@pytest.fixture
def session() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as session:
        yield session
    engine.dispose()


def put(storage: LocalObjectStorage, key: str, modified: float) -> Path:
    path = Path(storage.root, *key.split("/"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"bytes")
    os.utime(path, (modified, modified))
    return path


def row(session: Session, key: str, *, state: ObjectState = ObjectState.AVAILABLE, owner: bool = False) -> None:
    fields = {"object_key": key, "sha256": "0" * 64, "byte_size": 5, "content_type": "image/jpeg", "state": state}
    if owner:
        session.add(OwnerStoredObject(owner_subject="owner-1", **fields))
    else:
        trip = Trip(owner_subject="owner-1", title="Synthetic test")
        session.add(trip)
        session.flush()
        session.add(StoredObject(trip_id=trip.id, **fields))
    session.commit()


def test_objects_lists_stored_files_and_skips_dot_entries(tmp_path) -> None:
    storage = LocalObjectStorage(str(tmp_path))
    put(storage, "trip/a", OLD)
    put(storage, "owner/b", OLD)
    put(storage, ".backup-snapshot/trip/a", OLD)
    put(storage, "trip/.hidden", OLD)

    assert sorted(key for key, _ in storage.objects()) == ["owner/b", "trip/a"]
    assert list(LocalObjectStorage(str(tmp_path / "missing")).objects()) == []


def test_only_old_files_without_any_row_are_unreferenced(session, tmp_path) -> None:
    storage = LocalObjectStorage(str(tmp_path))
    row(session, "trip/available")
    row(session, "trip/pending", state=ObjectState.PURGE_PENDING)
    row(session, "owner/document", owner=True)
    for key in ("trip/available", "trip/pending", "owner/document", "trip/orphan", "trip/crashed.tmp"):
        put(storage, key, OLD)
    put(storage, "trip/uploading", FRESH)
    put(storage, ".backup-snapshot/trip/orphan", OLD)

    expected = ["trip/crashed.tmp", "trip/orphan"]
    assert unreferenced_objects(session, storage, older_than=timedelta(hours=24), now=NOW) == expected
    assert remove_unreferenced_objects(session, storage, older_than=timedelta(hours=24), now=NOW) == 2
    assert sorted(key for key, _ in storage.objects()) == [
        "owner/document",
        "trip/available",
        "trip/pending",
        "trip/uploading",
    ]
    assert (tmp_path / ".backup-snapshot/trip/orphan").exists()


def test_object_deletion_lock_is_a_no_op_without_postgresql(session) -> None:
    lock_object_deletion(session)


@pytest.mark.parametrize(
    ("arguments", "expected"),
    [
        ([], "Travel object reconcile completed: unreferenced_objects=1 (dry run)\n"),
        (["--delete"], "Travel object reconcile completed: unreferenced_objects_removed=1\n"),
    ],
)
def test_reconcile_command_counts_unless_asked_to_delete(
    monkeypatch, capsys, session, tmp_path, arguments, expected
) -> None:
    storage = LocalObjectStorage(str(tmp_path))
    now = datetime.now(UTC).timestamp()
    put(storage, "trip/orphan", now - 3 * 3600)
    put(storage, "trip/recent", now - 3600)
    monkeypatch.setattr(maintenance, "SessionLocal", lambda: session)
    monkeypatch.setattr(maintenance, "get_storage", lambda: storage)

    assert maintenance.main(["reconcile-objects", "--older-than-hours", "2", *arguments]) == 0
    assert capsys.readouterr().out == expected
    assert (tmp_path / "trip/orphan").exists() == (arguments == [])
    assert (tmp_path / "trip/recent").exists()


def test_reconcile_command_rejects_a_non_positive_grace_period() -> None:
    with pytest.raises(SystemExit):
        maintenance.main(["reconcile-objects", "--older-than-hours", "0"])
