from collections.abc import Generator
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.database import Base, get_session
from app.main import app
from app.models import OwnerStoredObject
from app.storage import LocalObjectStorage, get_storage

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def override_session() -> Generator[Session]:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def client_for(subject: str, tmp_path: Path) -> TestClient:
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[current_subject] = lambda: subject
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    return TestClient(app)


def setup_function() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def teardown_function() -> None:
    app.dependency_overrides.clear()


def create_trip(client: TestClient, title: str = "Exampleland 2054") -> dict:
    response = client.post("/api/trips", json={"title": title, "summary": "Private."})
    assert response.status_code == 201, response.text
    return response.json()


def upload_library_document(
    client: TestClient, contents: bytes = b"private passport copy", linked_trip_id: str | None = None
) -> dict:
    data = {"title": "Passport copy", "document_kind": "other"}
    if linked_trip_id is not None:
        data["linked_trip_id"] = linked_trip_id
    response = client.post(
        "/api/library/documents/uploads",
        data=data,
        files={"file": ("passport.txt", contents, "text/plain")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_library_document_upload_list_and_delete_are_owner_only(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    document = upload_library_document(owner)

    assert document["original_filename"] == "passport.txt"
    assert document["file_url"] == f"/api/library/documents/{document['id']}/original"
    assert document["linked_trip_id"] is None
    assert "object_key" not in document
    assert owner.get(document["file_url"]).content == b"private passport copy"
    assert len(owner.get("/api/library/documents").json()) == 1

    other = client_for("owner-2", tmp_path)
    assert other.get("/api/library/documents").json() == []
    assert other.get(f"/api/library/documents/{document['id']}").status_code == 404
    assert other.get(document["file_url"]).status_code == 404
    assert other.delete(f"/api/library/documents/{document['id']}").status_code == 404

    owner = client_for("owner-1", tmp_path)
    assert owner.delete(f"/api/library/documents/{document['id']}").status_code == 204
    assert owner.get("/api/library/documents").json() == []
    assert owner.get(f"/api/library/documents/{document['id']}").status_code == 404
    assert [path for path in tmp_path.rglob("*") if path.is_file()] == []
    with TestingSessionLocal() as session:
        assert session.query(OwnerStoredObject).count() == 0


def test_library_document_can_be_created_and_updated_without_a_dummy_trip(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    document = upload_library_document(owner)
    assert document["linked_trip_id"] is None

    updated = owner.patch(f"/api/library/documents/{document['id']}", json={"title": "Passport copy (renewed)"})
    assert updated.status_code == 200
    assert updated.json()["title"] == "Passport copy (renewed)"
    assert updated.json()["linked_trip_id"] is None


def test_library_document_can_be_optionally_linked_to_an_owned_trip(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    document = upload_library_document(owner, linked_trip_id=trip["id"])
    assert document["linked_trip_id"] == trip["id"]

    listed = owner.get(f"/api/library/documents?linked_trip_id={trip['id']}").json()
    assert [item["id"] for item in listed] == [document["id"]]

    cleared = owner.patch(f"/api/library/documents/{document['id']}", json={"linked_trip_id": None})
    assert cleared.status_code == 200
    assert cleared.json()["linked_trip_id"] is None


def test_library_document_cannot_be_linked_to_another_owners_trip(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    other = client_for("owner-2", tmp_path)
    other_trip = create_trip(other)

    owner = client_for("owner-1", tmp_path)
    upload = owner.post(
        "/api/library/documents/uploads",
        data={"title": "Insurance policy", "document_kind": "other", "linked_trip_id": other_trip["id"]},
        files={"file": ("policy.txt", b"policy contents", "text/plain")},
    )
    assert upload.status_code == 404

    document = upload_library_document(owner)
    relink = owner.patch(f"/api/library/documents/{document['id']}", json={"linked_trip_id": other_trip["id"]})
    assert relink.status_code == 404
