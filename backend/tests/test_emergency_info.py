from collections.abc import Generator

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


def client_for(subject: str, tmp_path) -> TestClient:
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[current_subject] = lambda: subject
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    return TestClient(app)


def setup_function() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def teardown_function() -> None:
    app.dependency_overrides.clear()


def entry_payload(**overrides) -> dict:
    payload = {"kind": "contact", "label": "Mom", "value": "+32 470 00 00 00", "notes": "Primary emergency contact."}
    payload.update(overrides)
    return payload


def create_entry(client: TestClient, **overrides) -> dict:
    response = client.post("/api/library/emergency-info", json=entry_payload(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


def test_owner_can_create_edit_list_and_delete_an_emergency_info_entry(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)

    entry = create_entry(owner)
    assert entry["kind"] == "contact"
    assert entry["label"] == "Mom"
    assert owner.get("/api/library/emergency-info").json() == [entry]
    assert owner.get(f"/api/library/emergency-info/{entry['id']}").json() == entry

    changed = owner.patch(f"/api/library/emergency-info/{entry['id']}", json={"value": "+32 470 11 11 11"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["value"] == "+32 470 11 11 11"
    # Unedited fields survive a partial PATCH.
    assert changed.json()["label"] == "Mom"

    assert owner.delete(f"/api/library/emergency-info/{entry['id']}").status_code == 204
    assert owner.get("/api/library/emergency-info").json() == []


def test_emergency_info_covers_contact_number_and_medical_note_kinds(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)

    contact = create_entry(owner, kind="contact", label="Mom", value="+32 470 00 00 00")
    number = create_entry(owner, kind="number", label="Local embassy", value="+886 2 0000 0000")
    note = create_entry(owner, kind="medical_note", label="Allergy", value="Penicillin", notes="Carries an EpiPen.")

    listed = owner.get("/api/library/emergency-info").json()
    assert {item["id"] for item in listed} == {contact["id"], number["id"], note["id"]}


def test_owner_list_starts_empty_without_creating_a_dummy_trip(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    assert owner.get("/api/library/emergency-info").json() == []


def test_other_subject_cannot_read_or_change_an_emergency_info_entry(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    entry = create_entry(owner)
    other = client_for("owner-2", tmp_path)

    assert other.get("/api/library/emergency-info").json() == []
    assert other.get(f"/api/library/emergency-info/{entry['id']}").status_code == 404
    assert other.patch(f"/api/library/emergency-info/{entry['id']}", json={"label": "Hijacked"}).status_code == 404
    assert other.delete(f"/api/library/emergency-info/{entry['id']}").status_code == 404
