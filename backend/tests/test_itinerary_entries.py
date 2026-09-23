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


def create_stay(client: TestClient, trip_id: str) -> dict:
    response = client.post(
        f"/api/trips/{trip_id}/stays",
        json={
            "place": {"display_name": "Some Hotel", "locality": "Taipei", "country_code": "TW"},
            "check_in_date": "2054-04-01",
            "check_out_date": "2054-04-03",
            "property_name": "Some Hotel",
            "booking_reference": "STAY-SECRET-1",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def entry_payload(**overrides) -> dict:
    payload = {"position": 0, "title": "Arrive in Taipei", "notes": "Land, get SIM card, check in."}
    payload.update(overrides)
    return payload


def create_entry(client: TestClient, trip_id: str, **overrides) -> dict:
    response = client.post(f"/api/trips/{trip_id}/itinerary-entries", json=entry_payload(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


def test_owner_can_create_edit_list_and_delete_an_itinerary_entry(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    entry = create_entry(owner, trip["id"], day_date="2054-04-01")
    assert entry["title"] == "Arrive in Taipei"
    assert entry["day_date"] == "2054-04-01"
    assert entry["position"] == 0
    assert entry["linked_kind"] is None
    assert entry["linked_id"] is None
    assert owner.get(f"/api/trips/{trip['id']}/itinerary-entries").json() == [entry]
    assert owner.get(f"/api/trips/{trip['id']}/itinerary-entries/{entry['id']}").json() == entry

    changed = owner.patch(
        f"/api/trips/{trip['id']}/itinerary-entries/{entry['id']}",
        json={"title": "Arrive in Taipei (revised)", "notes": None},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["title"] == "Arrive in Taipei (revised)"
    assert changed.json()["notes"] is None

    assert owner.delete(f"/api/trips/{trip['id']}/itinerary-entries/{entry['id']}").status_code == 204
    assert owner.get(f"/api/trips/{trip['id']}/itinerary-entries").json() == []


def test_entries_can_be_reordered(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    first = create_entry(owner, trip["id"], position=0, title="First")
    second = create_entry(owner, trip["id"], position=1, title="Second")
    third = create_entry(owner, trip["id"], position=2, title="Third")

    moved = owner.patch(f"/api/trips/{trip['id']}/itinerary-entries/{third['id']}", json={"position": 0})
    assert moved.status_code == 200, moved.text

    entries = owner.get(f"/api/trips/{trip['id']}/itinerary-entries").json()
    assert [entry["id"] for entry in entries] == [third["id"], first["id"], second["id"]]
    assert [entry["position"] for entry in entries] == [0, 1, 2]


def test_deleting_an_entry_compacts_remaining_positions(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    first = create_entry(owner, trip["id"], position=0, title="First")
    second = create_entry(owner, trip["id"], position=1, title="Second")
    third = create_entry(owner, trip["id"], position=2, title="Third")

    assert owner.delete(f"/api/trips/{trip['id']}/itinerary-entries/{second['id']}").status_code == 204
    entries = owner.get(f"/api/trips/{trip['id']}/itinerary-entries").json()
    assert [entry["id"] for entry in entries] == [first["id"], third["id"]]
    assert [entry["position"] for entry in entries] == [0, 1]

    appended = create_entry(owner, trip["id"], position=2, title="Fourth")
    assert appended["position"] == 2


def test_a_link_must_belong_to_the_same_trip(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    other_trip = create_trip(owner, title="Other trip")
    stay = create_stay(owner, trip["id"])
    other_stay = create_stay(owner, other_trip["id"])

    linked = create_entry(owner, trip["id"], linked_kind="stay", linked_id=stay["id"])
    assert linked["linked_kind"] == "stay"
    assert linked["linked_id"] == stay["id"]

    rejected = owner.post(
        f"/api/trips/{trip['id']}/itinerary-entries",
        json=entry_payload(linked_kind="stay", linked_id=other_stay["id"]),
    )
    assert rejected.status_code == 422

    missing = owner.post(
        f"/api/trips/{trip['id']}/itinerary-entries",
        json=entry_payload(linked_kind="stay", linked_id="does-not-exist"),
    )
    assert missing.status_code == 422


def test_a_link_kind_and_id_must_be_paired(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    stay = create_stay(owner, trip["id"])

    kind_only = owner.post(
        f"/api/trips/{trip['id']}/itinerary-entries", json=entry_payload(linked_kind="stay")
    )
    assert kind_only.status_code == 422

    id_only = owner.post(
        f"/api/trips/{trip['id']}/itinerary-entries", json=entry_payload(linked_id=stay["id"])
    )
    assert id_only.status_code == 422


def test_other_subject_cannot_read_or_change_an_itinerary_entry(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    entry = create_entry(owner, trip["id"])
    other = client_for("owner-2", tmp_path)

    assert other.post(f"/api/trips/{trip['id']}/itinerary-entries", json=entry_payload()).status_code == 404
    assert other.get(f"/api/trips/{trip['id']}/itinerary-entries").status_code == 404
    assert other.get(f"/api/trips/{trip['id']}/itinerary-entries/{entry['id']}").status_code == 404
    assert other.patch(
        f"/api/trips/{trip['id']}/itinerary-entries/{entry['id']}", json={"title": "Hijacked"}
    ).status_code == 404
    assert other.delete(f"/api/trips/{trip['id']}/itinerary-entries/{entry['id']}").status_code == 404


def test_an_itinerary_entry_can_never_be_selected_into_a_public_or_unlisted_projection(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    entry = create_entry(owner, trip["id"], notes="Confidential prep notes.")

    scoped = owner.put(
        f"/api/trips/{trip['id']}/public-projection",
        json={
            "schema_version": "travel/share-scope@1",
            "trip": {"title": True, "summary": True},
            "items": [{"kind": "itinerary_entry", "id": entry["id"], "fields": []}],
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
    for private_value in ("Arrive in Taipei", "Confidential prep notes."):
        assert private_value not in encoded_delivery


def test_an_entry_can_span_days_and_carry_a_kind_and_tentative_flag(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    endpoint = f"/api/trips/{trip['id']}/itinerary-entries"
    entry = owner.post(
        endpoint,
        json={"position": 0, "title": "Werken in Linkou", "day_date": "2054-11-18", "end_date": "2054-11-20",
              "kind": "work"},
    )
    assert entry.status_code == 201, entry.text
    assert entry.json()["end_date"] == "2054-11-20"
    assert entry.json()["kind"] == "work"
    assert entry.json()["tentative"] is False

    changed = owner.patch(f"{endpoint}/{entry.json()['id']}", json={"tentative": True, "kind": "free"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["tentative"] is True
    assert changed.json()["kind"] == "free"

    assert owner.patch(f"{endpoint}/{entry.json()['id']}", json={"end_date": "2054-11-17"}).status_code == 422
    assert owner.patch(f"{endpoint}/{entry.json()['id']}", json={"day_date": None}).status_code == 422
    assert owner.post(endpoint, json={"position": 1, "title": "No start", "end_date": "2054-11-20"}).status_code == 422
