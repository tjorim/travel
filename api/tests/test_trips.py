from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.database import Base, get_session
from app.main import app

engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def override_session() -> Generator[Session]:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def client_for(subject: str) -> TestClient:
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[current_subject] = lambda: subject
    return TestClient(app)


def setup_function() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def teardown_function() -> None:
    app.dependency_overrides.clear()


def create_trip(client: TestClient) -> dict[str, object]:
    response = client.post("/api/v1/trips", json={"title": "Exampleland 2054", "summary": "A selected route."})
    assert response.status_code == 201, response.text
    return response.json()


def test_owner_can_create_edit_and_delete_a_moment() -> None:
    client = client_for("owner-1")
    trip = create_trip(client)
    moment = client.post(
        f"/api/v1/trips/{trip['id']}/moments",
        json={
            "occurred_at": "2054-04-04T10:00:00Z",
            "title": "Arrival",
            "story": "The first selected note.",
            "place": {"display_name": "Taipei", "country_code": "TW"},
            "photo_urls": ["https://images.example.test/arrival.jpg"],
        },
    )
    assert moment.status_code == 201, moment.text
    moment_id = moment.json()["id"]

    changed = client.patch(
        f"/api/v1/trips/{trip['id']}/moments/{moment_id}", json={"title": "Arrival in Taipei"}
    )
    assert changed.status_code == 200
    assert changed.json()["title"] == "Arrival in Taipei"

    without_place = client.patch(f"/api/v1/trips/{trip['id']}/moments/{moment_id}", json={"place": None})
    assert without_place.status_code == 200
    assert without_place.json()["place"] is None

    deleted = client.delete(f"/api/v1/trips/{trip['id']}/moments/{moment_id}")
    assert deleted.status_code == 204


def test_other_subject_cannot_read_or_change_a_trip() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    other = client_for("owner-2")

    assert other.get(f"/api/v1/trips/{trip['id']}").status_code == 404
    assert other.patch(f"/api/v1/trips/{trip['id']}", json={"title": "Nope"}).status_code == 404


def test_crud_requires_authentication_by_default() -> None:
    response = TestClient(app).post("/api/v1/trips", json={"title": "Unauthenticated"})
    assert response.status_code == 401


def test_owner_can_manage_broad_route_stages() -> None:
    client = client_for("owner-1")
    trip = create_trip(client)
    stage = client.post(
        f"/api/v1/trips/{trip['id']}/route-stages",
        json={"position": 0, "label": "First stop", "place": {"display_name": "Taipei", "country_code": "TW"}},
    )
    assert stage.status_code == 201, stage.text
    assert stage.json()["place"] == {"id": stage.json()["place"]["id"], "display_name": "Taipei", "country_code": "TW"}


def test_only_deliberately_published_trips_are_public_and_do_not_leak_owner() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)

    assert owner.get(f"/api/v1/published/trips/{trip['id']}").status_code == 404
    private_publish = owner.patch(
        f"/api/v1/trips/{trip['id']}", json={"publication_state": "published"}
    )
    assert private_publish.status_code == 422

    published = owner.patch(
        f"/api/v1/trips/{trip['id']}",
        json={"visibility": "unlisted", "publication_state": "published"},
    )
    assert published.status_code == 200
    public_id = published.json()["public_id"]

    anonymous = TestClient(app)
    response = anonymous.get(f"/api/v1/published/trips/{public_id}")
    assert response.status_code == 200
    assert response.json()["title"] == "Exampleland 2054"
    assert "owner_subject" not in response.json()
