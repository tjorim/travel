from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from test_publication import share

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


def test_owner_can_select_a_redacted_transport_summary_for_public_and_unlisted_views(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    leg = create_leg(
        owner,
        trip["id"],
        departure_place={"label": "Brussels Airport", "display_name": "Brussels Airport, Leopoldlaan, Zaventem", "locality": "Zaventem", "country_code": "BE", "latitude": 50.9, "longitude": 4.48},
        arrival_place={"label": "Taoyuan Airport", "display_name": "Taoyuan Airport, Dayuan", "locality": "Taoyuan", "country_code": "TW", "latitude": 25.08, "longitude": 121.23},
    )

    trips_path = f"/api/trips/{trip['id']}"
    scoped = owner.put(
        f"{trips_path}/public-projection",
        json={"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True},
              "items": [share(owner, trip["id"], "transport_leg", leg["id"])]},
    )
    assert scoped.status_code == 200, scoped.text

    # Booking data is not a choice at all: a scope item names no fields.
    rejected = owner.put(
        f"{trips_path}/public-projection",
        json={"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True},
              "items": [{"kind": "transport_leg", "id": leg["id"], "fields": ["booking_reference"]}]},
    )
    assert rejected.status_code == 422, rejected.text

    result = owner.post(f"/api/trips/{trip['id']}/public-projection/publish")
    assert result.status_code == 200, result.text

    link = owner.post(f"/api/trips/{trip['id']}/share-links", json={"label": "Family", "scope": scoped.json()["scope"]})
    assert link.status_code == 201, link.text
    active = owner.post(f"/api/trips/{trip['id']}/share-links/{link.json()['id']}/activate", json={"expires_in_days": 30})
    assert active.status_code == 200, active.text

    for delivered in (
        TestClient(app).get(f"/api/public/trips/{result.json()['slug']}"),
        TestClient(app).get(f"/api/shared/{active.json()['token']}"),
    ):
        assert delivered.status_code == 200, delivered.text
        summary = delivered.json()["transport"]
        assert len(summary) == 1
        assert summary[0]["kind"] == "flight"
        assert summary[0]["status"] == "confirmed"
        assert summary[0]["departure"] == {"label": "Zaventem", "country_code": "BE", "region": None, "latitude": None, "longitude": None}
        assert summary[0]["arrival"] == {"label": "Taoyuan", "country_code": "TW", "region": None, "latitude": None, "longitude": None}
        assert summary[0]["carrier"] == "EVA Air"
        assert summary[0]["service_reference"] == "BR-087"
        # Endpoints appear on the map only when the place itself is shared.
        assert "map" not in summary[0]
        assert "booking_reference" not in summary[0]
        assert "travel_class" not in summary[0]
        assert "notes" not in summary[0]
        assert "document_asset_ids" not in summary[0]
        assert "display_name" not in str(summary[0])
        assert "BOOKING-SECRET-987" not in delivered.text

    # Sharing the airports, under their public names, puts them on the map.
    for endpoint in ("departure_place", "arrival_place"):
        share(owner, trip["id"], "place", leg[endpoint]["id"], "everyone")
    (with_map,) = TestClient(app).get(f"/api/public/trips/{result.json()['slug']}").json()["transport"]
    assert with_map["map"] == {
        "departure": {"label": "Brussels Airport", "country_code": "BE", "latitude": 50.9, "longitude": 4.48, "kind": "airport"},
        "arrival": {"label": "Taoyuan Airport", "country_code": "TW", "latitude": 25.08, "longitude": 121.23, "kind": "airport"},
    }


def test_endpoint_time_zones_turn_local_wall_clock_times_into_exact_instants(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    # AMS 10:40 local (CET, UTC+1) to TPE 06:25 local the next day (UTC+8).
    leg = create_leg(
        owner,
        trip["id"],
        departs_at="2054-11-16T10:40:00",
        arrives_at="2054-11-17T06:25:00",
        departure_timezone="Europe/Amsterdam",
        arrival_timezone="Asia/Taipei",
        travel_class="Premium Economy",
    )
    assert leg["departs_at"] == "2054-11-16T09:40:00Z"
    assert leg["arrives_at"].startswith("2054-11-16T22:25:00")
    assert leg["departure_timezone"] == "Europe/Amsterdam"
    assert leg["arrival_timezone"] == "Asia/Taipei"
    assert leg["travel_class"] == "Premium Economy"

    moved = owner.patch(
        f"/api/trips/{trip['id']}/transport-legs/{leg['id']}", json={"arrives_at": "2054-11-17T07:25:00"}
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["arrives_at"].startswith("2054-11-16T23:25:00")


def test_a_local_time_needs_a_known_time_zone(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    endpoint = f"/api/trips/{trip['id']}/transport-legs"

    assert owner.post(endpoint, json=leg_payload(departs_at="2054-11-16T10:40:00")).status_code == 422
    assert owner.post(endpoint, json=leg_payload(departure_timezone="Mars/Olympus")).status_code == 422
    assert owner.post(endpoint, json=leg_payload(departure_timezone="../../etc/passwd")).status_code == 422


def test_a_return_leg_reuses_the_airport_instead_of_making_a_copy(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    outbound = create_leg(owner, trip["id"])
    airport = outbound["departure_place"]
    taoyuan = outbound["arrival_place"]

    # The way home starts where the way out ended and ends where it began.
    homeward = create_leg(
        owner, trip["id"],
        departure_place={"existing_place_id": taoyuan["id"]}, arrival_place={"existing_place_id": airport["id"]},
        departs_at="2054-04-20T09:00:00Z", arrives_at="2054-04-20T23:00:00Z",
    )
    assert homeward["departure_place"]["id"] == taoyuan["id"] and homeward["arrival_place"]["id"] == airport["id"]
    assert homeward["departure_area"]["label"] == "Taoyuan"
    assert homeward["arrival_area"]["label"] == "Zaventem"
    assert len(owner.get(f"{trips_path}/places").json()) == 2
    # Each airport is filed under its own city.
    areas = {area["label"] for area in owner.get(f"{trips_path}/places/broad").json()}
    assert areas == {"Zaventem", "Taoyuan"}

    # A reused place stands alone, and must belong to this trip.
    mixed = owner.post(f"{trips_path}/transport-legs", json=leg_payload(departure_place={"existing_place_id": airport["id"], "locality": "X"}))
    assert mixed.status_code == 422
    other_trip = create_trip(owner, "Other")
    foreign = owner.post(
        f"/api/trips/{other_trip['id']}/transport-legs",
        json=leg_payload(departure_place={"existing_place_id": airport["id"]}),
    )
    assert foreign.status_code == 422
