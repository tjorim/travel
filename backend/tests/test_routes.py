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


def route_payload(**overrides) -> dict:
    payload = {
        "mode": "flight",
        "status": "confirmed",
        "departure_location": {"display_name": "Brussels Airport", "locality": "Zaventem", "country_code": "BE"},
        "arrival_location": {"display_name": "Taoyuan Airport", "locality": "Taoyuan", "country_code": "TW"},
        "departs_at": "2054-04-01T09:00:00Z",
        "arrives_at": "2054-04-01T23:00:00Z",
        "carrier": "EVA Air",
        "service_reference": "BR-087",
        "booking_reference": "BOOKING-SECRET-987",
        "notes": "Window seat requested.",
    }
    payload.update(overrides)
    return payload


def create_route(client: TestClient, trip_id: str, **overrides) -> dict:
    response = client.post(f"/api/trips/{trip_id}/routes", json=route_payload(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


def test_owner_can_create_edit_list_and_delete_a_route(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    route = create_route(owner, trip["id"])
    assert route["mode"] == "flight"
    assert route["status"] == "confirmed"
    assert route["departure_location"]["display_name"] == "Brussels Airport"
    assert route["carrier"] == "EVA Air"
    assert route["service_reference"] == "BR-087"
    assert route["document_asset_ids"] == []
    assert owner.get(f"/api/trips/{trip['id']}/routes").json() == [route]
    assert owner.get(f"/api/trips/{trip['id']}/routes/{route['id']}").json() == route

    changed = owner.patch(
        f"/api/trips/{trip['id']}/routes/{route['id']}",
        json={"status": "cancelled", "carrier": "EVA Air, revised", "notes": None},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["status"] == "cancelled"
    assert changed.json()["carrier"] == "EVA Air, revised"
    assert changed.json()["notes"] is None
    # Unedited fields survive a partial PATCH.
    assert changed.json()["service_reference"] == "BR-087"

    assert owner.delete(f"/api/trips/{trip['id']}/routes/{route['id']}").status_code == 204
    assert owner.get(f"/api/trips/{trip['id']}/routes").json() == []


def test_missing_optional_fields_are_accepted(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    route = create_route(
        owner,
        trip["id"],
        carrier=None,
        service_reference=None,
        booking_reference=None,
        notes=None,
    )
    assert route["carrier"] is None
    assert route["service_reference"] is None
    assert route["booking_reference"] is None
    assert route["notes"] is None

    # A required field left out entirely fails closed rather than silently
    # defaulting.
    response = owner.post(
        f"/api/trips/{trip['id']}/routes",
        json={
            "status": "planned",
            "departure_location": {"locality": "Brussels"},
            "arrival_location": {"locality": "Taipei"},
            "departs_at": "2054-04-01T09:00:00Z",
            "arrives_at": "2054-04-01T23:00:00Z",
        },
    )
    assert response.status_code == 422


def test_arrival_must_be_after_departure(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    response = owner.post(
        f"/api/trips/{trip['id']}/routes",
        json=route_payload(departs_at="2054-04-01T23:00:00Z", arrives_at="2054-04-01T09:00:00Z"),
    )
    assert response.status_code == 422

    route = create_route(owner, trip["id"])
    edited = owner.patch(
        f"/api/trips/{trip['id']}/routes/{route['id']}", json={"departs_at": "2054-04-02T09:00:00Z"}
    )
    assert edited.status_code == 422


def test_legs_are_listed_in_chronological_order_regardless_of_creation_order(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    # Create the return route before the outbound route.
    return_route = create_route(
        owner, trip["id"], departs_at="2054-04-10T09:00:00Z", arrives_at="2054-04-11T02:00:00Z"
    )
    outbound_route = create_route(
        owner, trip["id"], departs_at="2054-04-01T09:00:00Z", arrives_at="2054-04-01T23:00:00Z"
    )
    connecting_route = create_route(
        owner, trip["id"], departs_at="2054-04-05T09:00:00Z", arrives_at="2054-04-05T11:00:00Z"
    )

    routes = owner.get(f"/api/trips/{trip['id']}/routes").json()
    assert [route["id"] for route in routes] == [outbound_route["id"], connecting_route["id"], return_route["id"]]


def test_route_documents_are_explicit_owner_only_references(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    document = upload_document(owner, trip["id"])

    route = create_route(owner, trip["id"], document_asset_ids=[document["id"]])
    assert route["document_asset_ids"] == [document["id"]]

    cleared = owner.patch(f"/api/trips/{trip['id']}/routes/{route['id']}", json={"document_asset_ids": []})
    assert cleared.status_code == 200
    assert cleared.json()["document_asset_ids"] == []

    rejected = owner.post(
        f"/api/trips/{trip['id']}/routes",
        json=route_payload(document_asset_ids=[document["id"], "missing-document"]),
    )
    assert rejected.status_code == 422


def test_other_subject_cannot_read_or_change_a_route(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    route = create_route(owner, trip["id"])
    other = client_for("owner-2", tmp_path)

    assert other.post(f"/api/trips/{trip['id']}/routes", json=route_payload()).status_code == 404
    assert other.get(f"/api/trips/{trip['id']}/routes").status_code == 404
    assert other.get(f"/api/trips/{trip['id']}/routes/{route['id']}").status_code == 404
    assert other.patch(
        f"/api/trips/{trip['id']}/routes/{route['id']}", json={"status": "cancelled"}
    ).status_code == 404
    assert other.delete(f"/api/trips/{trip['id']}/routes/{route['id']}").status_code == 404


def test_owner_can_select_a_redacted_transport_summary_for_public_and_unlisted_views(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    route = create_route(
        owner,
        trip["id"],
        departure_location={"label": "Brussels Airport", "display_name": "Brussels Airport, Leopoldlaan, Zaventem", "locality": "Zaventem", "country_code": "BE", "latitude": 50.9, "longitude": 4.48},
        arrival_location={"label": "Taoyuan Airport", "display_name": "Taoyuan Airport, Dayuan", "locality": "Taoyuan", "country_code": "TW", "latitude": 25.08, "longitude": 121.23},
    )

    trips_path = f"/api/trips/{trip['id']}"
    scoped = owner.put(
        f"{trips_path}/public-projection",
        json={"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True},
              "items": [share(owner, trip["id"], "route", route["id"])]},
    )
    assert scoped.status_code == 200, scoped.text

    # Booking data is not a choice at all: a scope item names no fields.
    rejected = owner.put(
        f"{trips_path}/public-projection",
        json={"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True},
              "items": [{"kind": "route", "id": route["id"], "fields": ["booking_reference"]}]},
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
        summary = delivered.json()["routes"]
        assert len(summary) == 1
        assert summary[0]["mode"] == "flight"
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
    for endpoint in ("departure_location", "arrival_location"):
        share(owner, trip["id"], "location", route[endpoint]["id"], "everyone")
    (with_map,) = TestClient(app).get(f"/api/public/trips/{result.json()['slug']}").json()["routes"]
    assert with_map["map"] == {
        "departure": {"label": "Brussels Airport", "country_code": "BE", "latitude": 50.9, "longitude": 4.48, "kind": "airport"},
        "arrival": {"label": "Taoyuan Airport", "country_code": "TW", "latitude": 25.08, "longitude": 121.23, "kind": "airport"},
    }


def test_endpoint_time_zones_turn_local_wall_clock_times_into_exact_instants(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    # AMS 10:40 local (CET, UTC+1) to TPE 06:25 local the next day (UTC+8).
    route = create_route(
        owner,
        trip["id"],
        departs_at="2054-11-16T10:40:00",
        arrives_at="2054-11-17T06:25:00",
        departure_timezone="Europe/Amsterdam",
        arrival_timezone="Asia/Taipei",
        travel_class="Premium Economy",
    )
    assert route["departs_at"] == "2054-11-16T09:40:00Z"
    assert route["arrives_at"].startswith("2054-11-16T22:25:00")
    assert route["departure_timezone"] == "Europe/Amsterdam"
    assert route["arrival_timezone"] == "Asia/Taipei"
    assert route["travel_class"] == "Premium Economy"

    moved = owner.patch(
        f"/api/trips/{trip['id']}/routes/{route['id']}", json={"arrives_at": "2054-11-17T07:25:00"}
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["arrives_at"].startswith("2054-11-16T23:25:00")


def test_a_local_time_needs_a_known_time_zone(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    endpoint = f"/api/trips/{trip['id']}/routes"

    assert owner.post(endpoint, json=route_payload(departs_at="2054-11-16T10:40:00")).status_code == 422
    assert owner.post(endpoint, json=route_payload(departure_timezone="Mars/Olympus")).status_code == 422
    assert owner.post(endpoint, json=route_payload(departure_timezone="../../etc/passwd")).status_code == 422


def test_a_return_route_reuses_the_airport_instead_of_making_a_copy(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    outbound = create_route(owner, trip["id"])
    airport = outbound["departure_location"]
    taoyuan = outbound["arrival_location"]

    # The way home starts where the way out ended and ends where it began.
    homeward = create_route(
        owner, trip["id"],
        departure_location={"existing_location_id": taoyuan["id"]}, arrival_location={"existing_location_id": airport["id"]},
        departs_at="2054-04-20T09:00:00Z", arrives_at="2054-04-20T23:00:00Z",
    )
    assert homeward["departure_location"]["id"] == taoyuan["id"] and homeward["arrival_location"]["id"] == airport["id"]
    assert homeward["departure_area"]["label"] == "Taoyuan"
    assert homeward["arrival_area"]["label"] == "Zaventem"
    assert len(owner.get(f"{trips_path}/locations").json()) == 2
    # Each airport is filed under its own city.
    areas = {area["label"] for area in owner.get(f"{trips_path}/areas").json()}
    assert areas == {"Zaventem", "Taoyuan"}

    # A reused place stands alone, and must belong to this trip.
    mixed = owner.post(f"{trips_path}/routes", json=route_payload(departure_location={"existing_location_id": airport["id"], "locality": "X"}))
    assert mixed.status_code == 422
    other_trip = create_trip(owner, "Other")
    foreign = owner.post(
        f"/api/trips/{other_trip['id']}/routes",
        json=route_payload(departure_location={"existing_location_id": airport["id"]}),
    )
    assert foreign.status_code == 422


def area_id(client: TestClient, trip_id: str, label: str) -> str:
    response = client.post(f"/api/trips/{trip_id}/areas", json={"label": label, "country_code": "TW", "latitude": 25.0, "longitude": 121.5})
    assert response.status_code == 201, response.text
    return response.json()["id"]


LINE = {"type": "LineString", "coordinates": [[121.56, 25.03], [121.75, 24.4], [120.2, 23.0]]}


def test_a_route_needs_only_two_areas_and_a_mode(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    taipei, tainan = area_id(owner, trip["id"], "Taipei"), area_id(owner, trip["id"], "Tainan")
    base = f"/api/trips/{trip['id']}/routes"

    created = owner.post(base, json={"mode": "train", "departure_area_id": taipei, "arrival_area_id": tainan})
    assert created.status_code == 201, created.text
    route = created.json()
    assert (route["departure_area"]["label"], route["arrival_area"]["label"]) == ("Taipei", "Tainan")
    assert route["departure_location"] is None and route["arrival_location"] is None
    assert route["departs_at"] is None and route["geometry"] is None and route["label"] is None
    assert route["status"] == "planned" and route["visibility"] == "private"

    # A mode and both ends are required; an unknown mode or a foreign area is refused.
    assert owner.post(base, json={"departure_area_id": taipei, "arrival_area_id": tainan}).status_code == 422
    assert owner.post(base, json={"mode": "train", "departure_area_id": taipei}).status_code == 422
    assert owner.post(base, json={"mode": "hoverboard", "departure_area_id": taipei, "arrival_area_id": tainan}).status_code == 422
    other_trip = create_trip(owner, "Elsewhere")
    foreign = area_id(owner, other_trip["id"], "Osaka")
    assert owner.post(base, json={"mode": "train", "departure_area_id": taipei, "arrival_area_id": foreign}).status_code == 422


def test_a_location_settles_the_area_of_a_route_end(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    taipei, tainan = area_id(owner, trip["id"], "Taipei"), area_id(owner, trip["id"], "Tainan")
    base = f"/api/trips/{trip['id']}/routes"

    created = owner.post(base, json={
        "mode": "train", "departure_location": {"display_name": "Taipei Main Station", "area_id": taipei},
        "arrival_area_id": tainan,
    })
    assert created.status_code == 201, created.text
    route = created.json()
    assert route["departure_area"]["id"] == taipei
    assert route["departure_location"]["display_name"] == "Taipei Main Station"

    # An area given next to a location must be the location's own.
    mismatch = owner.post(base, json={
        "mode": "train", "departure_location": {"display_name": "Somewhere", "area_id": taipei},
        "departure_area_id": tainan, "arrival_area_id": tainan,
    })
    assert mismatch.status_code == 422

    # Changing only the area drops a location that is no longer in it; the same area keeps it.
    kept = owner.patch(f"{base}/{route['id']}", json={"departure_area_id": taipei})
    assert kept.json()["departure_location"]["display_name"] == "Taipei Main Station"
    moved = owner.patch(f"{base}/{route['id']}", json={"departure_area_id": tainan})
    assert moved.json()["departure_area"]["id"] == tainan and moved.json()["departure_location"] is None
    # A cleared location keeps its area.
    cleared = owner.patch(f"{base}/{route['id']}", json={"arrival_location": None})
    assert cleared.status_code == 200 and cleared.json()["arrival_area"]["id"] == tainan


def test_a_route_can_carry_a_drawn_line_that_can_be_redrawn_and_removed(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    taipei, tainan = area_id(owner, trip["id"], "Taipei"), area_id(owner, trip["id"], "Tainan")
    base = f"/api/trips/{trip['id']}/routes"

    route = owner.post(base, json={
        "mode": "bike", "label": "Down the west coast", "departure_area_id": taipei, "arrival_area_id": tainan, "geometry": LINE,
    }).json()
    assert route["geometry"] == LINE and route["label"] == "Down the west coast" and route["mode"] == "bike"

    redrawn = {"type": "LineString", "coordinates": [[121.0, 25.0], [120.0, 23.0]]}
    changed = owner.patch(f"{base}/{route['id']}", json={"geometry": redrawn, "mode": "train"})
    assert changed.json()["geometry"] == redrawn and changed.json()["mode"] == "train"
    assert owner.patch(f"{base}/{route['id']}", json={"geometry": None}).json()["geometry"] is None
    assert owner.post(base, json={
        "mode": "bike", "departure_area_id": taipei, "arrival_area_id": tainan,
        "geometry": {"type": "LineString", "coordinates": [[121.0, 25.0]]},
    }).status_code == 422


def test_the_schedule_is_optional_but_comes_as_a_pair(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    taipei, tainan = area_id(owner, trip["id"], "Taipei"), area_id(owner, trip["id"], "Tainan")
    base = f"/api/trips/{trip['id']}/routes"
    ends = {"mode": "train", "departure_area_id": taipei, "arrival_area_id": tainan}

    assert owner.post(base, json={**ends, "departs_at": "2054-04-01T09:00:00Z"}).status_code == 422
    route = owner.post(base, json={**ends, "departs_at": "2054-04-01T09:00:00Z", "arrives_at": "2054-04-01T11:00:00Z"}).json()
    assert route["departs_at"] == "2054-04-01T09:00:00Z"
    assert owner.patch(f"{base}/{route['id']}", json={"arrives_at": None}).status_code == 422
    cleared = owner.patch(f"{base}/{route['id']}", json={"departs_at": None, "arrives_at": None})
    assert cleared.status_code == 200 and cleared.json()["departs_at"] is None

    # Routes without a schedule sort after the scheduled ones.
    owner.post(base, json={**ends, "label": "Unscheduled"})
    scheduled = owner.post(base, json={**ends, "label": "Scheduled", "departs_at": "2054-05-01T09:00:00Z", "arrives_at": "2054-05-01T10:00:00Z"}).json()
    labels = [item["label"] for item in owner.get(base).json()]
    assert labels.index("Scheduled") < labels.index("Unscheduled")
    assert scheduled["label"] == "Scheduled"


def test_a_shared_route_shows_areas_a_line_and_no_stations_or_bookings(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    taipei, tainan = area_id(owner, trip["id"], "Taipei"), area_id(owner, trip["id"], "Tainan")
    route = owner.post(f"/api/trips/{trip['id']}/routes", json={
        "mode": "train", "label": "By high-speed rail", "departure_area_id": taipei, "arrival_area_id": tainan, "geometry": LINE,
        "departure_location": {"display_name": "Taipei Main Station", "area_id": taipei},
        "booking_reference": "SECRET-BOOKING", "notes": "Seat 12A",
    }).json()
    trips_path = f"/api/trips/{trip['id']}"
    scoped = owner.put(f"{trips_path}/public-projection", json={
        "schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True},
        "items": [share(owner, trip["id"], "route", route["id"])],
    })
    assert scoped.status_code == 200, scoped.text
    slug = owner.post(f"{trips_path}/public-projection/publish").json()["slug"]

    delivered = TestClient(app).get(f"/api/public/trips/{slug}")
    (shared,) = delivered.json()["routes"]
    assert shared["mode"] == "train" and shared["label"] == "By high-speed rail" and shared["geometry"] == LINE
    assert shared["departure"]["label"] == "Taipei" and shared["arrival"]["label"] == "Tainan"
    assert "map" not in shared and "departs_at" not in shared
    for secret in ("SECRET-BOOKING", "Seat 12A", "Taipei Main Station"):
        assert secret not in delivered.text


def test_the_application_takes_no_recorded_location_data_and_the_offline_map_target_is_owner_only(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    assert owner.get(f"/api/trips/{trip['id']}/recorded-tracks").status_code == 404
    assert owner.post(f"/api/trips/{trip['id']}/recorded-tracks/uploads").status_code == 404
    assert owner.get(f"/api/trips/{trip['id']}/offline-map").status_code == 204
    assert client_for("owner-2", tmp_path).get(f"/api/trips/{trip['id']}/offline-map").status_code == 404


def test_an_area_that_a_route_runs_between_cannot_be_deleted(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    taipei, tainan = area_id(owner, trip["id"], "Taipei"), area_id(owner, trip["id"], "Tainan")
    route = owner.post(f"/api/trips/{trip['id']}/routes", json={"mode": "train", "departure_area_id": taipei, "arrival_area_id": tainan}).json()

    refused = owner.delete(f"/api/trips/{trip['id']}/areas/{tainan}")
    assert refused.status_code == 409 and "1 route" in refused.json()["detail"]
    assert owner.delete(f"/api/trips/{trip['id']}/routes/{route['id']}").status_code == 204
    assert owner.delete(f"/api/trips/{trip['id']}/areas/{tainan}").status_code == 204
