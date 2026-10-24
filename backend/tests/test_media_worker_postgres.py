"""Optional real PostgreSQL locking tests; each run uses an isolated disposable schema."""

import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Event
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from test_media_worker import outputs

from app.database import Base
from app.media import service, worker
from app.models import DerivativePurpose, MediaDerivative, MediaWorkerJob, StoredObject, Trip
from app.storage import LocalObjectStorage


@pytest.fixture
def postgres(tmp_path):
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    schema = "worker_test_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f"CREATE SCHEMA {schema}"))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        Base.metadata.create_all(engine)
        sessions = sessionmaker(bind=engine)
        storage = LocalObjectStorage(str(tmp_path / "objects"))
        with sessions() as session:
            trip = Trip(owner_subject="owner-1", title="Synthetic test")
            session.add(trip)
            session.commit()
            asset, _ = service.direct_upload(
                session,
                storage,
                trip_id=trip.id,
                filename="clip.mov",
                content_type="video/quicktime",
                data=b"synthetic original",
            )
            derivative = service.queue_video_derivative(
                session, media_asset=asset, purpose=DerivativePurpose.SHARE, remove_audio=True
            )
            job = session.scalar(select(MediaWorkerJob))
            job.worker_id = "a" * 32
            job.state = "running"
            job.next_attempt_at = datetime.now(UTC) - timedelta(seconds=1)
            session.commit()
            derivative_id = derivative.id
        yield sessions, storage, derivative_id
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f"DROP SCHEMA {schema} CASCADE"))
        admin.dispose()


def test_locked_job_is_skipped_by_second_dispatcher(postgres):
    sessions, storage, _ = postgres
    with sessions() as first, sessions() as second:
        assert first.scalar(select(MediaWorkerJob).with_for_update()) is not None
        assert not worker.dispatch_one(second, storage, None)


def test_delete_waiting_for_import_removes_both_committed_outputs(postgres, tmp_path):
    sessions, storage, derivative_id = postgres
    data, evidence = outputs(tmp_path, True)
    downloading, release, deleting = Event(), Event(), Event()

    class Client:
        def job(self, *args):
            return {"id": "a" * 32, "state": "succeeded", "artifacts": evidence}

        def download(self, worker_id, name, artifact):
            downloading.set()
            assert release.wait(10)
            return data[name]

    def dispatch():
        with sessions() as session:
            return worker.dispatch_one(session, storage, Client())

    def delete():
        with sessions() as session:
            # Load before import commit; this identity must be refreshed after waiting on the job lock.
            derivative = session.get(MediaDerivative, derivative_id)
            assert derivative.object_id is None
            deleting.set()
            service.delete_media_derivative(session, storage, derivative=derivative)

    with ThreadPoolExecutor(max_workers=2) as pool:
        dispatched = pool.submit(dispatch)
        assert downloading.wait(10)
        deleted = pool.submit(delete)
        assert deleting.wait(10)
        release.set()
        assert dispatched.result(timeout=15)
        deleted.result(timeout=15)
    with sessions() as session:
        assert session.get(MediaDerivative, derivative_id) is None
        assert len(list(session.scalars(select(StoredObject)))) == 1
        job = session.scalar(select(MediaWorkerJob))
        assert job.derivative_id is None and job.state == "ack"
    assert not list(storage.root.glob("worker-*/*"))
