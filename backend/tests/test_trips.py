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
    response = client.post("/api/trips", json={"title": "Exampleland 2054", "summary": "A selected route."})
    assert response.status_code == 201, response.text
    return response.json()


def test_owner_can_create_edit_and_delete_a_travel_update_with_a_private_part() -> None:
    client = client_for("owner-1")
    trip = create_trip(client)
    path = f"/api/trips/{trip['id']}/travel-updates"
    update = client.post(
        path,
        json={
            "occurred_at": "2054-04-04T10:00:00Z",
            "title": "Arrival",
            "private_notes": "The first private note.",
            "place": {"locality": "Taipei", "country_code": "TW"},
        },
    )
    assert update.status_code == 201, update.text
    created = update.json()
    # A quick capture: private, with notes and an exact place, and no text for visitors yet.
    assert (created["visibility"], created["body"], created["private_notes"]) == ("private", "", "The first private note.")
    assert created["place"]["locality"] == "Taipei" and created["place"]["visibility"] == "private"
    update_id = created["id"]
    assert client.get(f"/api/trips/{trip['id']}").json()["travel_updates"][0]["id"] == update_id

    changed = client.patch(f"{path}/{update_id}", json={"title": "Arrival in Taipei"})
    assert changed.status_code == 200
    assert changed.json()["title"] == "Arrival in Taipei"

    without_place = client.patch(f"{path}/{update_id}", json={"place": None})
    assert without_place.status_code == 200
    assert without_place.json()["place"] is None
    # A required part cannot be cleared; the private notes can.
    assert client.patch(f"{path}/{update_id}", json={"title": None}).status_code == 422
    assert client.patch(f"{path}/{update_id}", json={"private_notes": None}).json()["private_notes"] is None

    assert client.delete(f"{path}/{update_id}").status_code == 204


def test_media_attachments_are_explicit_owner_only_references() -> None:
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
        f"/api/trips/{trip['id']}/travel-updates",
        json={
            "occurred_at": "2054-04-04T10:00:00Z", "title": "Arrival", "private_notes": "A private note.",
            "media_asset_ids": [asset_id],
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["media_asset_ids"] == [asset_id]

    cleared = owner.patch(f"/api/trips/{trip['id']}/travel-updates/{created.json()['id']}", json={"media_asset_ids": []})
    assert cleared.status_code == 200
    assert cleared.json()["media_asset_ids"] == []

    rejected = owner.post(
        f"/api/trips/{trip['id']}/travel-updates",
        json={
            "occurred_at": "2054-04-04T10:00:00Z", "title": "Nope", "private_notes": "A private note.",
            "media_asset_ids": [asset_id, "missing-asset"],
        },
    )
    assert rejected.status_code == 422


def test_other_subject_cannot_read_or_change_a_trip() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    other = client_for("owner-2")

    assert other.get(f"/api/trips/{trip['id']}").status_code == 404
    assert other.patch(f"/api/trips/{trip['id']}", json={"title": "Nope"}).status_code == 404


def test_trip_api_rejects_superseded_publication_fields() -> None:
    owner = client_for("owner-1")
    assert owner.post("/api/trips", json={"title": "Exampleland", "visibility": "public"}).status_code == 422

    trip = create_trip(owner)
    assert owner.patch(f"/api/trips/{trip['id']}", json={"publication_state": "published"}).status_code == 422


def test_crud_requires_authentication_by_default() -> None:
    response = TestClient(app).post("/api/trips", json={"title": "Unauthenticated"})
    assert response.status_code == 401


def test_owner_can_manage_broad_route_stages() -> None:
    client = client_for("owner-1")
    trip = create_trip(client)
    stage = client.post(
        f"/api/trips/{trip['id']}/route-stages",
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
        "timezone": None,
        "visibility": "private",
    }


def test_owner_can_select_reorder_and_remove_broad_route_stages() -> None:
    client = client_for("owner-1")
    trip = create_trip(client)
    broad_places = [
        client.post(
            f"/api/trips/{trip['id']}/places/broad",
            json={"label": label, "country_code": "TW"},
        ).json()
        for label in ("Taipei", "Tainan", "Kaohsiung")
    ]
    stages = [
        client.post(
            f"/api/trips/{trip['id']}/route-stages",
            json={"position": index, "broad_place_id": place["id"]},
        ).json()
        for index, place in enumerate(broad_places)
    ]

    moved = client.patch(
        f"/api/trips/{trip['id']}/route-stages/{stages[2]['id']}", json={"position": 0}
    )
    assert moved.status_code == 200, moved.text
    ordered = client.get(f"/api/trips/{trip['id']}").json()["route_stages"]
    assert [(item["position"], item["place"]["label"]) for item in ordered] == [
        (0, "Kaohsiung"), (1, "Taipei"), (2, "Tainan")
    ]

    assert client.delete(f"/api/trips/{trip['id']}/route-stages/{stages[0]['id']}").status_code == 204
    after_remove = client.get(f"/api/trips/{trip['id']}").json()["route_stages"]
    assert [item["position"] for item in after_remove] == [0, 1]
    added = client.post(
        f"/api/trips/{trip['id']}/route-stages",
        json={"position": 2, "broad_place_id": broad_places[0]["id"], "label": "Finale"},
    )
    assert added.status_code == 201, added.text
    assert added.json()["place"]["id"] == broad_places[0]["id"]


def test_owner_can_write_the_shared_part_of_an_update_and_then_share_it() -> None:
    client = client_for("owner-1")
    trip = create_trip(client)
    stage = client.post(
        f"/api/trips/{trip['id']}/route-stages",
        json={"position": 0, "label": "First stop", "place": {"label": "Taipei", "country_code": "TW"}},
    )
    broad_place_id = stage.json()["place"]["id"]
    path = f"/api/trips/{trip['id']}/travel-updates"
    update = client.post(
        path, json={"occurred_at": "2054-04-04T10:00:00Z", "title": "Arrival", "private_notes": "Kept private."},
    ).json()

    # Nothing to show visitors yet, so it cannot be shared.
    early = client.patch(f"{path}/{update['id']}", json={"visibility": "everyone"})
    assert early.status_code == 422 and "text for visitors" in early.json()["detail"]

    written = client.patch(
        f"{path}/{update['id']}",
        json={"broad_place_id": broad_place_id, "title": "Arrival in Taipei", "body": "A public-safe retelling.", "visibility": "everyone"},
    )
    assert written.status_code == 200, written.text
    assert (written.json()["visibility"], written.json()["private_notes"]) == ("everyone", "Kept private.")
    # Emptying the text withdraws nothing silently: it is refused while the update is shared.
    assert client.patch(f"{path}/{update['id']}", json={"body": ""}).status_code == 422
    assert client.patch(f"{path}/{update['id']}", json={"visibility": "private"}).status_code == 200
    assert client.patch(f"{path}/{update['id']}", json={"body": ""}).status_code == 200

    assert client.delete(f"{path}/{update['id']}").status_code == 204


def test_other_subject_cannot_read_or_change_a_travel_update() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    excerpt = owner.post(
        f"/api/trips/{trip['id']}/travel-updates",
        json={"occurred_at": "2054-04-04T10:00:00Z", "date_precision": "month", "title": "A trip highlight", "body": "Text."},
    )
    assert excerpt.status_code == 201, excerpt.text
    excerpt_id = excerpt.json()["id"]

    other = client_for("owner-2")
    assert other.patch(
        f"/api/trips/{trip['id']}/travel-updates/{excerpt_id}", json={"title": "Nope"}
    ).status_code == 404
    assert other.delete(f"/api/trips/{trip['id']}/travel-updates/{excerpt_id}").status_code == 404


def test_travel_update_rejects_an_exact_place_or_a_broad_place_from_another_trip() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    private_update = owner.post(
        f"/api/trips/{trip['id']}/travel-updates",
        json={
            "occurred_at": "2054-04-04T10:00:00Z",
            "title": "Arrival",
            "private_notes": "Note.",
            "place": {"locality": "Taipei", "country_code": "TW"},
        },
    )
    exact_place_id = private_update.json()["place"]["id"]

    rejected_kind = owner.post(
        f"/api/trips/{trip['id']}/travel-updates",
        json={"occurred_at": "2054-04-04T10:00:00Z", "broad_place_id": exact_place_id, "date_precision": "day", "title": "T", "body": "B"},
    )
    assert rejected_kind.status_code == 422

    other_trip = create_trip(owner)
    other_stage = owner.post(
        f"/api/trips/{other_trip['id']}/route-stages",
        json={"position": 0, "label": "Elsewhere", "place": {"label": "Osaka", "country_code": "JP"}},
    )
    foreign_broad_place_id = other_stage.json()["place"]["id"]

    rejected_trip = owner.post(
        f"/api/trips/{trip['id']}/travel-updates",
        json={"occurred_at": "2054-04-04T10:00:00Z", "broad_place_id": foreign_broad_place_id, "date_precision": "day", "title": "T", "body": "B"},
    )
    assert rejected_trip.status_code == 422
