from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.database import Base, get_session
from app.main import app
from app.models import MediaAsset, MediaKind, ObjectState, StoredObject

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
            "place": {"locality": "Taipei", "country_code": "TW"},
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


def test_moment_media_attachments_are_explicit_owner_only_references() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    with TestingSessionLocal() as session:
        stored = StoredObject(
            trip_id=trip["id"], object_key="owner-only/sunrise.jpg", sha256="a" * 64,
            byte_size=1, content_type="image/jpeg", state=ObjectState.AVAILABLE,
        )
        session.add(stored)
        session.flush()
        asset = MediaAsset(
            trip_id=trip["id"], original_object_id=stored.id, media_kind=MediaKind.PHOTO, raw_metadata={},
        )
        session.add(asset)
        session.commit()
        asset_id = asset.id

    created = owner.post(
        f"/api/v1/trips/{trip['id']}/moments",
        json={
            "occurred_at": "2054-04-04T10:00:00Z", "title": "Arrival", "story": "A private note.",
            "media_asset_ids": [asset_id],
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["media_asset_ids"] == [asset_id]

    cleared = owner.patch(f"/api/v1/trips/{trip['id']}/moments/{created.json()['id']}", json={"media_asset_ids": []})
    assert cleared.status_code == 200
    assert cleared.json()["media_asset_ids"] == []

    rejected = owner.post(
        f"/api/v1/trips/{trip['id']}/moments",
        json={
            "occurred_at": "2054-04-04T10:00:00Z", "title": "Nope", "story": "A private note.",
            "media_asset_ids": [asset_id, "missing-asset"],
        },
    )
    assert rejected.status_code == 422


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
        json={"position": 0, "label": "First stop", "place": {"label": "Taipei", "country_code": "TW"}},
    )
    assert stage.status_code == 201, stage.text
    assert stage.json()["place"] == {
        "id": stage.json()["place"]["id"],
        "kind": "broad",
        "label": "Taipei",
        "country_code": "TW",
        "region": None,
        "latitude": None,
        "longitude": None,
    }


def test_owner_can_select_reorder_and_remove_broad_route_stages() -> None:
    client = client_for("owner-1")
    trip = create_trip(client)
    broad_places = [
        client.post(
            f"/api/v1/trips/{trip['id']}/places/broad",
            json={"label": label, "country_code": "TW"},
        ).json()
        for label in ("Taipei", "Tainan", "Kaohsiung")
    ]
    stages = [
        client.post(
            f"/api/v1/trips/{trip['id']}/route-stages",
            json={"position": index, "broad_place_id": place["id"]},
        ).json()
        for index, place in enumerate(broad_places)
    ]

    moved = client.patch(
        f"/api/v1/trips/{trip['id']}/route-stages/{stages[2]['id']}", json={"position": 0}
    )
    assert moved.status_code == 200, moved.text
    ordered = client.get(f"/api/v1/trips/{trip['id']}").json()["route_stages"]
    assert [(item["position"], item["place"]["label"]) for item in ordered] == [
        (0, "Kaohsiung"), (1, "Taipei"), (2, "Tainan")
    ]

    assert client.delete(f"/api/v1/trips/{trip['id']}/route-stages/{stages[0]['id']}").status_code == 204
    after_remove = client.get(f"/api/v1/trips/{trip['id']}").json()["route_stages"]
    assert [item["position"] for item in after_remove] == [0, 1]
    added = client.post(
        f"/api/v1/trips/{trip['id']}/route-stages",
        json={"position": 2, "broad_place_id": broad_places[0]["id"], "label": "Finale"},
    )
    assert added.status_code == 201, added.text
    assert added.json()["place"]["id"] == broad_places[0]["id"]


def test_owner_can_manage_a_moment_excerpt_independent_of_its_source_moment() -> None:
    client = client_for("owner-1")
    trip = create_trip(client)
    stage = client.post(
        f"/api/v1/trips/{trip['id']}/route-stages",
        json={"position": 0, "label": "First stop", "place": {"label": "Taipei", "country_code": "TW"}},
    )
    broad_place_id = stage.json()["place"]["id"]
    moment = client.post(
        f"/api/v1/trips/{trip['id']}/moments",
        json={"occurred_at": "2054-04-04T10:00:00Z", "title": "Arrival", "story": "The first selected note."},
    )
    moment_id = moment.json()["id"]

    excerpt = client.post(
        f"/api/v1/trips/{trip['id']}/moment-excerpts",
        json={
            "source_moment_id": moment_id,
            "broad_place_id": broad_place_id,
            "date_precision": "day",
            "title": "Arrival in Taipei",
            "body": "A public-safe retelling.",
        },
    )
    assert excerpt.status_code == 201, excerpt.text
    excerpt_id = excerpt.json()["id"]

    assert client.delete(f"/api/v1/trips/{trip['id']}/moments/{moment_id}").status_code == 204

    changed = client.patch(
        f"/api/v1/trips/{trip['id']}/moment-excerpts/{excerpt_id}", json={"title": "Arrival, revised"}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["title"] == "Arrival, revised"

    deleted = client.delete(f"/api/v1/trips/{trip['id']}/moment-excerpts/{excerpt_id}")
    assert deleted.status_code == 204


def test_other_subject_cannot_read_or_change_a_moment_excerpt() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    excerpt = owner.post(
        f"/api/v1/trips/{trip['id']}/moment-excerpts",
        json={"date_precision": "month", "title": "A trip highlight", "body": "Text."},
    )
    assert excerpt.status_code == 201, excerpt.text
    excerpt_id = excerpt.json()["id"]

    other = client_for("owner-2")
    assert other.patch(
        f"/api/v1/trips/{trip['id']}/moment-excerpts/{excerpt_id}", json={"title": "Nope"}
    ).status_code == 404
    assert other.delete(f"/api/v1/trips/{trip['id']}/moment-excerpts/{excerpt_id}").status_code == 404


def test_moment_excerpt_rejects_an_exact_place_or_a_broad_place_from_another_trip() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    moment = owner.post(
        f"/api/v1/trips/{trip['id']}/moments",
        json={
            "occurred_at": "2054-04-04T10:00:00Z",
            "title": "Arrival",
            "story": "Note.",
            "place": {"locality": "Taipei", "country_code": "TW"},
        },
    )
    exact_place_id = moment.json()["place"]["id"]

    rejected_kind = owner.post(
        f"/api/v1/trips/{trip['id']}/moment-excerpts",
        json={"broad_place_id": exact_place_id, "date_precision": "day", "title": "T", "body": "B"},
    )
    assert rejected_kind.status_code == 422

    other_trip = create_trip(owner)
    other_stage = owner.post(
        f"/api/v1/trips/{other_trip['id']}/route-stages",
        json={"position": 0, "label": "Elsewhere", "place": {"label": "Osaka", "country_code": "JP"}},
    )
    foreign_broad_place_id = other_stage.json()["place"]["id"]

    rejected_trip = owner.post(
        f"/api/v1/trips/{trip['id']}/moment-excerpts",
        json={"broad_place_id": foreign_broad_place_id, "date_precision": "day", "title": "T", "body": "B"},
    )
    assert rejected_trip.status_code == 422


def test_only_deliberately_published_trips_are_public_and_do_not_leak_owner() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)

    assert owner.get(f"/api/v1/published/trips/{trip['id']}").status_code == 404
    private_publish = owner.patch(
        f"/api/v1/trips/{trip['id']}", json={"publication_state": "published"}
    )
    assert private_publish.status_code == 422

    moment = owner.post(
        f"/api/v1/trips/{trip['id']}/moments",
        json={
            "occurred_at": "2054-04-04T10:00:00Z",
            "title": "Arrival",
            "story": "The first selected note.",
            "place": {
                "address_line1": "1 Xinyi Road",
                "locality": "Taipei",
                "country_code": "TW",
                "latitude": 25.03,
                "longitude": 121.56,
                "notes": "Owner-only reminder.",
            },
        },
    )
    assert moment.status_code == 201, moment.text

    published = owner.patch(
        f"/api/v1/trips/{trip['id']}",
        json={"visibility": "unlisted", "publication_state": "published"},
    )
    assert published.status_code == 200
    public_id = published.json()["public_id"]

    anonymous = TestClient(app)
    response = anonymous.get(f"/api/v1/published/trips/{public_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Exampleland 2054"
    assert "owner_subject" not in body

    # A moment's place is always `exact` (address, coordinates, owner
    # notes); the public endpoint must never leak it, unlike the owner-only
    # `MomentResponse` shape returned by the trip CRUD endpoints.
    assert len(body["moments"]) == 1
    assert "place" not in body["moments"][0]
