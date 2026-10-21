"""Optional real PostgreSQL test of the object deletion lock; uses a disposable schema."""

import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.library.service import purge_owner_objects
from app.media.service import _purge_pending_objects
from app.models import ObjectState, OwnerStoredObject, StoredObject, Trip
from app.storage import OBJECT_DELETION_LOCK, LocalObjectStorage


@pytest.fixture
def postgres(tmp_path):
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    schema = "deletion_test_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f"CREATE SCHEMA {schema}"))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        Base.metadata.create_all(engine)
        yield sessionmaker(bind=engine), LocalObjectStorage(str(tmp_path / "objects")), admin
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f"DROP SCHEMA {schema} CASCADE"))
        admin.dispose()


@pytest.mark.parametrize("owner", [False, True])
def test_purge_waits_for_a_backup_holding_the_deletion_lock(postgres, owner) -> None:
    sessions, storage, admin = postgres
    storage.put("objects/a", b"bytes")
    fields = {
        "object_key": "objects/a",
        "sha256": "0" * 64,
        "byte_size": 5,
        "content_type": "image/jpeg",
        "state": ObjectState.PURGE_PENDING,
    }
    with sessions() as session:
        if owner:
            stored = OwnerStoredObject(owner_subject="owner-1", **fields)
        else:
            trip = Trip(owner_subject="owner-1", title="Synthetic test")
            session.add(trip)
            session.flush()
            stored = StoredObject(trip_id=trip.id, **fields)
        session.add(stored)
        session.commit()
        object_id = stored.id

    def purge() -> int:
        with sessions() as session:
            if owner:
                return purge_owner_objects(session, storage, object_ids=[object_id])
            return _purge_pending_objects(session, storage, object_ids=[object_id])

    # The apps backup takes the same key as a session lock (apps#245).
    with admin.connect() as backup, ThreadPoolExecutor(max_workers=1) as pool:
        backup.execute(text("SELECT pg_advisory_lock(:key)"), {"key": OBJECT_DELETION_LOCK})
        purged = pool.submit(purge)
        with pytest.raises(TimeoutError):
            purged.result(timeout=1)
        assert storage.exists("objects/a")
        backup.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": OBJECT_DELETION_LOCK})
        assert purged.result(timeout=10) == 1
    assert not storage.exists("objects/a")
