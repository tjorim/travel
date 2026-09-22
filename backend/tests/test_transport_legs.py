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


def upload_document(client: TestClient, trip_id: str, title: str = "E-ticket") -> dict:
    response = client.post(
        f"/api/trips/{trip_id}/documents/uploads",
        data={"title": title, "document_kind": "booking"},
        files={"file": ("ticket.txt", b"private booking reference", "text/plain")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def leg_payload(**overrides) -> dict:
    payload = {
        "kind": "flight",
        "status": "confirmed",
        "departure_place": {"display_name": "Brussels Airport", "locality": "Zaventem", "country_code": "BE"},
        "arrival_place": {"display_name": "Taoyuan Airport", "locality": "Taoyuan", "country_code": "TW"},
        "departs_at": "2054-04-01T09:00:00Z",
        "arrives_at": "2054-04-01T23:00:00Z",
        "carrier": "EVA Air",
        "service_reference": "BR-087",
        "booking_reference": "BOOKING-SECRET-987",
        "notes": "Window seat requested.",
    }
    payload.update(overrides)
    return payload


def create_leg(client: TestClient, trip_id: str, **overrides) -> dict:
    response = client.post(f"/api/trips/{trip_id}/transport-legs", json=leg_payload(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


def test_owner_can_create_edit_list_and_delete_a_transport_leg(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    leg = create_leg(owner, trip["id"])
    assert leg["kind"] == "flight"
    assert leg["status"] == "confirmed"
    assert leg["departure_place"]["kind"] == "exact"
    assert leg["departure_place"]["display_name"] == "Brussels Airport"
    assert leg["carrier"] == "EVA Air"
    assert leg["service_reference"] == "BR-087"
    assert leg["document_asset_ids"] == []
    assert owner.get(f"/api/trips/{trip['id']}/transport-legs").json() == [leg]
    assert owner.get(f"/api/trips/{trip['id']}/transport-legs/{leg['id']}").json() == leg

    changed = owner.patch(
        f"/api/trips/{trip['id']}/transport-legs/{leg['id']}",
        json={"status": "cancelled", "carrier": "EVA Air, revised", "notes": None},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["status"] == "cancelled"
    assert changed.json()["carrier"] == "EVA Air, revised"
    assert changed.json()["notes"] is None
    # Unedited fields survive a partial PATCH.
    assert changed.json()["service_reference"] == "BR-087"

    assert owner.delete(f"/api/trips/{trip['id']}/transport-legs/{leg['id']}").status_code == 204
    assert owner.get(f"/api/trips/{trip['id']}/transport-legs").json() == []


def test_missing_optional_fields_are_accepted(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    leg = create_leg(
        owner,
        trip["id"],
        carrier=None,
        service_reference=None,
        booking_reference=None,
        notes=None,
    )
    assert leg["carrier"] is None
    assert leg["service_reference"] is None
    assert leg["booking_reference"] is None
    assert leg["notes"] is None

    # A required field left out entirely fails closed rather than silently
    # defaulting.
    response = owner.post(
        f"/api/trips/{trip['id']}/transport-legs",
        json={
            "status": "planned",
            "departure_place": {"locality": "Brussels"},
            "arrival_place": {"locality": "Taipei"},
            "departs_at": "2054-04-01T09:00:00Z",
            "arrives_at": "2054-04-01T23:00:00Z",
        },
    )
    assert response.status_code == 422


def test_arrival_must_be_after_departure(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    response = owner.post(
        f"/api/trips/{trip['id']}/transport-legs",
        json=leg_payload(departs_at="2054-04-01T23:00:00Z", arrives_at="2054-04-01T09:00:00Z"),
    )
    assert response.status_code == 422

    leg = create_leg(owner, trip["id"])
    edited = owner.patch(
        f"/api/trips/{trip['id']}/transport-legs/{leg['id']}", json={"departs_at": "2054-04-02T09:00:00Z"}
    )
    assert edited.status_code == 422


def test_legs_are_listed_in_chronological_order_regardless_of_creation_order(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    # Create the return leg before the outbound leg.
    return_leg = create_leg(
        owner, trip["id"], departs_at="2054-04-10T09:00:00Z", arrives_at="2054-04-11T02:00:00Z"
    )
    outbound_leg = create_leg(
        owner, trip["id"], departs_at="2054-04-01T09:00:00Z", arrives_at="2054-04-01T23:00:00Z"
    )
    connecting_leg = create_leg(
        owner, trip["id"], departs_at="2054-04-05T09:00:00Z", arrives_at="2054-04-05T11:00:00Z"
    )

    legs = owner.get(f"/api/trips/{trip['id']}/transport-legs").json()
    assert [leg["id"] for leg in legs] == [outbound_leg["id"], connecting_leg["id"], return_leg["id"]]


def test_transport_leg_documents_are_explicit_owner_only_references(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    document = upload_document(owner, trip["id"])

    leg = create_leg(owner, trip["id"], document_asset_ids=[document["id"]])
    assert leg["document_asset_ids"] == [document["id"]]

    cleared = owner.patch(f"/api/trips/{trip['id']}/transport-legs/{leg['id']}", json={"document_asset_ids": []})
    assert cleared.status_code == 200
    assert cleared.json()["document_asset_ids"] == []

    rejected = owner.post(
        f"/api/trips/{trip['id']}/transport-legs",
        json=leg_payload(document_asset_ids=[document["id"], "missing-document"]),
    )
    assert rejected.status_code == 422


def test_other_subject_cannot_read_or_change_a_transport_leg(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    leg = create_leg(owner, trip["id"])
    other = client_for("owner-2", tmp_path)

    assert other.post(f"/api/trips/{trip['id']}/transport-legs", json=leg_payload()).status_code == 404
    assert other.get(f"/api/trips/{trip['id']}/transport-legs").status_code == 404
    assert other.get(f"/api/trips/{trip['id']}/transport-legs/{leg['id']}").status_code == 404
    assert other.patch(
        f"/api/trips/{trip['id']}/transport-legs/{leg['id']}", json={"status": "cancelled"}
    ).status_code == 404
    assert other.delete(f"/api/trips/{trip['id']}/transport-legs/{leg['id']}").status_code == 404


def test_a_transport_leg_can_never_be_selected_into_a_public_or_unlisted_projection(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    leg = create_leg(owner, trip["id"])

    # There is no share-scope kind for a transport leg at all: the only way
    # to represent it publicly is a separately authored route stage or
    # broad route, exactly like a stay requires a broad stay card.
    scoped = owner.put(
        f"/api/trips/{trip['id']}/public-projection",
        json={
            "schema_version": "travel/share-scope@1",
            "trip": {"title": True, "summary": True},
            "items": [{"kind": "transport_leg", "id": leg["id"], "fields": []}],
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
    for private_value in ("EVA Air", "BR-087", "BOOKING-SECRET-987", "Brussels Airport", "Taoyuan Airport"):
        assert private_value not in encoded_delivery
