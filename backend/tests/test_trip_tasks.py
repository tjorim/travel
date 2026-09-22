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


def create_trip(client: TestClient, title: str = "Exampleland 2054") -> dict:
    response = client.post("/api/trips", json={"title": title, "summary": "A private trip."})
    assert response.status_code == 201, response.text
    return response.json()


def task_payload(**overrides) -> dict:
    payload = {"title": "Book Taroko Gorge shuttle", "notes": "Still waiting on a reply.", "due_date": "2054-03-01"}
    payload.update(overrides)
    return payload


def create_task(client: TestClient, trip_id: str, **overrides) -> dict:
    response = client.post(f"/api/trips/{trip_id}/trip-tasks", json=task_payload(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


def test_owner_can_create_edit_list_and_delete_a_trip_task(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    task = create_task(owner, trip["id"])
    assert task["title"] == "Book Taroko Gorge shuttle"
    assert task["due_date"] == "2054-03-01"
    assert task["completed_at"] is None
    assert owner.get(f"/api/trips/{trip['id']}/trip-tasks").json() == [task]
    assert owner.get(f"/api/trips/{trip['id']}/trip-tasks/{task['id']}").json() == task

    changed = owner.patch(
        f"/api/trips/{trip['id']}/trip-tasks/{task['id']}", json={"title": "Book Taroko shuttle (revised)"}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["title"] == "Book Taroko shuttle (revised)"
    # Unedited fields survive a partial PATCH.
    assert changed.json()["notes"] == "Still waiting on a reply."

    assert owner.delete(f"/api/trips/{trip['id']}/trip-tasks/{task['id']}").status_code == 204
    assert owner.get(f"/api/trips/{trip['id']}/trip-tasks").json() == []


def test_a_task_can_be_completed_and_reopened(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    task = create_task(owner, trip["id"])

    completed = owner.patch(f"/api/trips/{trip['id']}/trip-tasks/{task['id']}", json={"completed": True})
    assert completed.status_code == 200, completed.text
    assert completed.json()["completed_at"] is not None

    reopened = owner.patch(f"/api/trips/{trip['id']}/trip-tasks/{task['id']}", json={"completed": False})
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["completed_at"] is None


def test_missing_optional_fields_are_accepted(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    task = create_task(owner, trip["id"], notes=None, due_date=None)
    assert task["notes"] is None
    assert task["due_date"] is None

    response = owner.post(f"/api/trips/{trip['id']}/trip-tasks", json={})
    assert response.status_code == 422


def test_other_subject_cannot_read_or_change_a_trip_task(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    task = create_task(owner, trip["id"])
    other = client_for("owner-2", tmp_path)

    assert other.post(f"/api/trips/{trip['id']}/trip-tasks", json=task_payload()).status_code == 404
    assert other.get(f"/api/trips/{trip['id']}/trip-tasks").status_code == 404
    assert other.get(f"/api/trips/{trip['id']}/trip-tasks/{task['id']}").status_code == 404
    assert other.patch(
        f"/api/trips/{trip['id']}/trip-tasks/{task['id']}", json={"completed": True}
    ).status_code == 404
    assert other.delete(f"/api/trips/{trip['id']}/trip-tasks/{task['id']}").status_code == 404


def test_a_trip_task_can_never_be_selected_into_a_public_or_unlisted_projection(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    task = create_task(owner, trip["id"])

    scoped = owner.put(
        f"/api/trips/{trip['id']}/public-projection",
        json={
            "schema_version": "travel/share-scope@1",
            "trip": {"title": True, "summary": True},
            "items": [{"kind": "trip_task", "id": task["id"], "fields": []}],
        },
    )
    assert scoped.status_code == 422, scoped.text

    published = owner.put(
        f"/api/trips/{trip['id']}/public-projection",
        json={"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": []},
    )
    assert published.status_code == 200, published.text
    result = owner.post(f"/api/trips/{trip['id']}/public-projection/publish")
    assert result.status_code == 200, result.text

    delivered = TestClient(app).get(f"/api/public/trips/{result.json()['slug']}")
    assert delivered.status_code == 200, delivered.text
    encoded_delivery = delivered.text
    for private_value in ("Book Taroko Gorge shuttle", "Still waiting on a reply."):
        assert private_value not in encoded_delivery
