from collections.abc import Generator
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.database import Base, get_session
from app.main import app
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


def create_trip(client: TestClient) -> dict:
    response = client.post("/api/v1/trips", json={"title": "Exampleland 2054", "summary": "Private."})
    assert response.status_code == 201, response.text
    return response.json()


def upload_document(client: TestClient, trip_id: str, contents: bytes = b"private booking details") -> dict:
    response = client.post(
        f"/api/v1/trips/{trip_id}/documents/uploads",
        data={"title": "Airport hotel booking", "document_kind": "booking"},
        files={"file": ("confirmation.txt", contents, "text/plain")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_document_upload_list_and_delete_are_owner_only(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    document = upload_document(owner, trip["id"])

    assert document["original_filename"] == "confirmation.txt"
    assert document["file_url"] == f"/api/v1/trips/{trip['id']}/documents/{document['id']}/original"
    assert "object_key" not in document
    assert owner.get(document["file_url"]).content == b"private booking details"
    assert len(owner.get(f"/api/v1/trips/{trip['id']}/documents").json()) == 1

    other = client_for("owner-2", tmp_path)
    assert other.get(f"/api/v1/trips/{trip['id']}/documents").status_code == 404
    assert other.get(document["file_url"]).status_code == 404

    owner = client_for("owner-1", tmp_path)
    assert owner.delete(f"/api/v1/trips/{trip['id']}/documents/{document['id']}").status_code == 204
    assert owner.get(f"/api/v1/trips/{trip['id']}/documents").json() == []


def test_redacted_derivative_is_new_pending_and_requires_owner_approval(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    document = upload_document(owner, trip["id"])

    created = owner.post(
        f"/api/v1/trips/{trip['id']}/documents/{document['id']}/derivatives",
        files={
            "file": ("redacted.txt", b"Booking: [redacted]", "text/plain"),
            "redaction_manifest": ("manifest.json", b'{"redactions":["guest"]}', "application/json"),
        },
    )
    assert created.status_code == 201, created.text
    derivative = created.json()
    assert derivative["review_state"] == "pending"
    assert derivative["file_url"].endswith(f"/derivatives/{derivative['id']}/file")
    assert owner.get(derivative["file_url"]).content == b"Booking: [redacted]"
    assert "original_object_id" not in derivative
    assert "redaction_manifest_object_id" not in derivative

    approved = owner.post(
        f"/api/v1/trips/{trip['id']}/documents/{document['id']}/derivatives/{derivative['id']}/approve"
    )
    assert approved.status_code == 200
    assert approved.json()["review_state"] == "approved"

    # The storage deduplication layer must never turn the original into a
    # derivative merely because a client re-uploads the same bytes.
    original_as_derivative = owner.post(
        f"/api/v1/trips/{trip['id']}/documents/{document['id']}/derivatives",
        files={
            "file": ("not-redacted.txt", b"private booking details", "text/plain"),
            "redaction_manifest": ("manifest.json", b'{"redactions":[]}', "application/json"),
        },
    )
    assert original_as_derivative.status_code == 422


def test_document_derivative_has_no_public_delivery_route(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    document = upload_document(owner, trip["id"])
    derivative = owner.post(
        f"/api/v1/trips/{trip['id']}/documents/{document['id']}/derivatives",
        files={
            "file": ("redacted.txt", b"safe copy", "text/plain"),
            "redaction_manifest": ("manifest.json", b"{}", "application/json"),
        },
    ).json()

    # The only delivery URL is owner-authenticated. No public/unlisted
    # projection route is registered in this delivery phase.
    other = client_for("owner-2", tmp_path)
    assert other.get(derivative["file_url"]).status_code == 404
    assert other.get(f"/api/v1/public/documents/{derivative['id']}").status_code == 404
