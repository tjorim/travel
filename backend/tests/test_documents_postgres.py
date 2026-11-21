"""Optional real PostgreSQL tests of the one document model (#368): uniqueness, locking and the trip delete.

Set ``TRAVEL_TEST_DATABASE_URL`` to a server URL (any database on it); the tests create and drop their own."""

import os
import threading
import time
from collections.abc import Generator
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.auth import current_subject
from app.core.errors import Refusal
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models import DocumentAsset, ObjectState, StayDocumentAsset, StoredObject
from app.schemas import DocumentUpdate
from app.services.documents.ingest import trip_documents
from app.services.documents.service import update_document
from app.services.media.ingest import store_uploaded_object
from app.services.storage import LocalObjectStorage, get_storage
from app.services.storage_reconcile import unreferenced_objects


@pytest.fixture
def engine():
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    name = "documents_" + uuid4().hex
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


def _owner(engine, tmp_path: Path) -> TestClient:
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    storage = LocalObjectStorage(str(tmp_path))

    def override() -> Generator[Session]:
        with factory() as session:
            yield session

    app.dependency_overrides[get_session] = override
    app.dependency_overrides[current_subject] = lambda: "owner-1"
    app.dependency_overrides[get_storage] = lambda: storage
    return TestClient(app)


def _upload(owner: TestClient, trip_id: str | None, contents: bytes = b"the same bytes") -> dict:
    data = {"title": "Policy", "document_kind": "other"} | ({"trip_id": trip_id} if trip_id else {})
    response = owner.post("/api/documents/uploads", data=data, files={"file": ("policy.txt", contents, "text/plain")})
    assert response.status_code in (200, 201), response.text
    return response.json()


def test_deleting_a_trip_unfiles_documents_that_share_a_file_whatever_the_order(engine, tmp_path) -> None:
    owner = _owner(engine, tmp_path)
    trips = [owner.post("/api/trips", json={"title": f"Exampleland {number}"}).json() for number in range(3)]
    unfiled = _upload(owner, None)
    filed = [_upload(owner, trip["id"]) for trip in trips]

    # The foreign key does it on PostgreSQL (SET NULL) and the service does it explicitly: both must fit.
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM trips WHERE id = :id"), {"id": trips[0]["id"]})
    assert owner.delete(f"/api/trips/{trips[1]['id']}").status_code == 204
    assert owner.delete(f"/api/trips/{trips[2]['id']}").status_code == 204

    with Session(engine) as session:
        documents = session.scalars(select(DocumentAsset)).all()
        assert {document.id for document in documents} == {unfiled["id"], *(item["id"] for item in filed)}
        assert {document.trip_id for document in documents} == {None}
        assert session.scalar(select(func.count()).select_from(StoredObject)) == 1


def test_two_first_uploads_of_the_same_bytes_end_with_one_object_and_a_reclaimable_file(engine, tmp_path) -> None:
    """A rival upload commits its row between this one's lookup and its insert."""
    sessions = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    class RacingStorage(LocalObjectStorage):
        rival: str | None = None

        def put(self, key, data):
            super().put(key, data)
            if self.rival is None:
                with sessions() as other:
                    rival = store_uploaded_object(
                        other, LocalObjectStorage(str(tmp_path / "rival")), owner_subject="owner-1",
                        data=b"racing bytes", content_type="text/plain",
                    )  # fmt: skip
                    other.commit()
                    self.rival = rival.id

    storage = RacingStorage(str(tmp_path / "main"))
    with sessions() as session:
        stored = store_uploaded_object(
            session, storage, owner_subject="owner-1", data=b"racing bytes", content_type="text/plain"
        )
        session.commit()
        assert stored.id == storage.rival and stored.state == ObjectState.AVAILABLE
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(StoredObject)) == 1
        # The bytes this upload wrote under its own key are named by no row: `reconcile-objects` removes them.
        lost = unreferenced_objects(session, storage, older_than=timedelta(0))
        assert len(lost) == 1 and lost[0].startswith("owner/")


def _stay_with_document(owner: TestClient) -> tuple[str, str, str]:
    trip = owner.post("/api/trips", json={"title": "Exampleland 2054"}).json()
    area = owner.post(f"/api/trips/{trip['id']}/areas", json={"label": "Taipei", "country_code": "TW"}).json()
    stay = owner.post(
        f"/api/trips/{trip['id']}/stays",
        json={"area_id": area["id"], "check_in_date": "2054-04-01", "check_out_date": "2054-04-05"},
    ).json()
    return trip["id"], stay["id"], _upload(owner, trip["id"])["id"]


def _in_thread(work) -> tuple[threading.Thread, list[BaseException]]:
    failures: list[BaseException] = []

    def run() -> None:
        try:
            work()
        except BaseException as error:  # noqa: BLE001 - reported to the test
            failures.append(error)

    thread = threading.Thread(target=run)
    thread.start()
    return thread, failures


def test_a_move_waits_for_an_attachment_being_written_and_then_refuses(engine, tmp_path) -> None:
    owner = _owner(engine, tmp_path)
    trip_id, stay_id, document_id = _stay_with_document(owner)

    with Session(engine) as attaching:
        [asset] = trip_documents(attaching, trip_id, [document_id])  # the shared lock, held until the commit

        def move() -> None:
            with Session(engine) as session:
                update_document(session, "owner-1", document_id, DocumentUpdate(trip_id=None))
                session.commit()

        thread, failures = _in_thread(move)
        time.sleep(0.5)
        assert thread.is_alive()  # the move waits for the attachment instead of missing it
        attaching.add(StayDocumentAsset(stay_id=stay_id, document_asset_id=asset.id))
        attaching.commit()
    thread.join(timeout=10)

    assert len(failures) == 1 and isinstance(failures[0], Refusal)
    assert failures[0].code == "detach_the_document_from_stays_and_routes_before_moving_it"
    with Session(engine) as session:
        document = session.get(DocumentAsset, document_id)
        assert document is not None and document.trip_id == trip_id


def test_an_attachment_waits_for_a_move_in_progress_and_then_refuses(engine, tmp_path) -> None:
    owner = _owner(engine, tmp_path)
    trip_id, _, document_id = _stay_with_document(owner)

    with Session(engine) as moving:
        update_document(moving, "owner-1", document_id, DocumentUpdate(trip_id=None))  # the row lock, uncommitted

        def attach() -> None:
            with Session(engine) as session:
                trip_documents(session, trip_id, [document_id])

        thread, failures = _in_thread(attach)
        time.sleep(0.5)
        assert thread.is_alive()  # the attachment waits for the move instead of validating the old filing
        moving.commit()
    thread.join(timeout=10)

    assert len(failures) == 1 and isinstance(failures[0], Refusal)
    assert failures[0].code == "one_or_more_documents_are_unavailable_for_this_trip"
