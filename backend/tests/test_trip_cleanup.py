"""Synthetic trip cleanup regression, exercised on SQLite and optional PostgreSQL."""

import os
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.config import settings
from app.database import get_session
from app.errors import Refusal, service_error_handler
from app.mcp_server import TravelMcpBackend
from app.media.service import purge_deleted_media
from app.models import (
    Base,
    DocumentAsset,
    DocumentKind,
    ObjectState,
    OwnerDocument,
    OwnerStoredObject,
    StoredObject,
    Trip,
)
from app.routers import trips
from app.storage import LocalObjectStorage


@pytest.fixture(params=["sqlite", "postgres"])
def database(request):
    admin = None
    if request.param == "postgres":
        url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
        if not url:
            pytest.skip("local PostgreSQL test URL not configured")
        schema = "trip_cleanup_" + uuid4().hex
        admin = create_engine(url)
        with admin.begin() as connection:
            connection.execute(text(f"CREATE SCHEMA {schema}"))
        engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    else:
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

        @event.listens_for(engine, "connect")
        def foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    yield sessionmaker(engine)
    engine.dispose()
    if admin:
        with admin.begin() as connection:
            connection.execute(text(f"DROP SCHEMA {schema} CASCADE"))
        admin.dispose()


@pytest.fixture
def inventory(database, tmp_path):
    storage = LocalObjectStorage(str(tmp_path))
    storage.put("synthetic/document", b"document")
    storage.put("synthetic/library", b"library")
    with database() as session:
        trip = Trip(owner_subject="owner", title="Synthetic")
        session.add(trip)
        session.flush()
        fields = {"sha256": "0" * 64, "byte_size": 8, "content_type": "application/pdf", "state": ObjectState.AVAILABLE}
        stored = StoredObject(trip_id=trip.id, object_key="synthetic/document", **fields)
        library = OwnerStoredObject(owner_subject="owner", object_key="synthetic/library", **fields)
        session.add_all([stored, library])
        session.flush()
        session.add(
            DocumentAsset(
                trip_id=trip.id, original_object_id=stored.id, title="Synthetic", document_kind=DocumentKind.OTHER
            )
        )
        linked = OwnerDocument(
            owner_subject="owner",
            original_object_id=library.id,
            linked_trip_id=trip.id,
            title="Synthetic library",
            document_kind=DocumentKind.OTHER,
        )
        session.add(linked)
        session.commit()
        return storage, trip.id, stored.id, linked.id


@pytest.mark.parametrize("transport", ["http", "mcp"])
def test_trip_deletion_keeps_retryable_inventory(database, inventory, monkeypatch, transport):
    storage, trip_id, object_id, linked_id = inventory
    if transport == "http":
        app = FastAPI()
        app.add_exception_handler(Refusal, service_error_handler)
        app.include_router(trips.router)

        def session_dependency():
            with database() as session:
                yield session

        app.dependency_overrides[get_session] = session_dependency
        app.dependency_overrides[current_subject] = lambda: "owner"
        with TestClient(app) as client:
            assert client.delete(f"/trips/{trip_id}").status_code == 204
            assert client.get(f"/trips/{trip_id}").status_code == 404
    else:
        monkeypatch.setattr(settings, "environment", "development")
        monkeypatch.setattr(settings, "mcp_development_subject", "owner")
        assert TravelMcpBackend(database).delete_trip(trip_id, confirm=True) == {"status": "deleted"}
    with database() as session:
        assert session.get(Trip, trip_id) is None
        pending = session.get(StoredObject, object_id)
        assert pending is not None
        assert pending.state == ObjectState.PURGE_PENDING
        assert pending.trip_id is None
        assert session.get(OwnerDocument, linked_id).linked_trip_id is None
        assert storage.exists("synthetic/document")
        real_delete = storage.delete

        def failed_delete(key):
            raise OSError("synthetic failure")

        monkeypatch.setattr(storage, "delete", failed_delete)
        with pytest.raises(OSError):
            purge_deleted_media(session, storage, older_than=timedelta(days=30))
        session.rollback()
        assert session.get(StoredObject, object_id).state == ObjectState.PURGE_PENDING
        assert storage.exists("synthetic/document")
        monkeypatch.setattr(storage, "delete", real_delete)
        assert purge_deleted_media(session, storage, older_than=timedelta(days=30)) == 1
        assert list(session.scalars(select(StoredObject))) == []
        assert not storage.exists("synthetic/document")
        assert storage.exists("synthetic/library")


def test_failed_commit_preserves_trip_and_files(database, inventory, monkeypatch):
    storage, trip_id, object_id, _ = inventory
    with database() as session:

        def failed_commit():
            raise RuntimeError("synthetic commit failure")

        monkeypatch.setattr(session, "commit", failed_commit)
        with pytest.raises(RuntimeError, match="synthetic commit"):
            trips.delete_trip(trip_id, session, "owner")
        session.rollback()
    with database() as session:
        assert session.get(Trip, trip_id) is not None
        stored = session.get(StoredObject, object_id)
        assert stored.trip_id == trip_id
        assert stored.state == ObjectState.AVAILABLE
        assert storage.exists("synthetic/document")


def test_detached_inventory_enters_pending_state_before_purge(database, inventory, monkeypatch):
    storage, _, object_id, _ = inventory
    with database() as session:
        # Model a retained inventory row missed by the deletion snapshot.
        # The associated document is removed first, as it is on trip deletion.
        document = session.scalar(select(DocumentAsset).where(DocumentAsset.original_object_id == object_id))
        session.delete(document)
        session.get(StoredObject, object_id).trip_id = None
        session.commit()
    real_delete = storage.delete

    def checked_delete(key):
        with database() as observer:
            assert observer.get(StoredObject, object_id).state == ObjectState.PURGE_PENDING
        real_delete(key)

    monkeypatch.setattr(storage, "delete", checked_delete)
    with database() as session:
        assert purge_deleted_media(session, storage, older_than=timedelta(days=30)) == 1
