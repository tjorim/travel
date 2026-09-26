from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.database import Base, get_session
from app.main import app

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
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


def create_trip(client: TestClient, title: str = "Exampleland 2054") -> dict:
    response = client.post("/api/trips", json={"title": title, "summary": "A private trip."})
    assert response.status_code == 201, response.text
    return response.json()


def create_stay(client: TestClient, trip_id: str) -> dict:
    response = client.post(
        f"/api/trips/{trip_id}/stays",
        json={
            "location": {
                "address_line1": "1 Xinyi Road",
                "locality": "Taipei",
                "country_code": "TW",
                "latitude": 25.033,
                "longitude": 121.565,
            },
            "check_in_date": "2054-04-01",
            "check_out_date": "2054-04-05",
            "check_in_time": "15:00:00",
            "check_out_time": "11:00:00",
            "status": "confirmed",
            "property_name": "Private Hotel Taipei",
            "booking_reference": "BOOKING-SECRET-123",
            "contact_details": "host@example.test",
            "notes": "Ask for the quiet room.",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_area(client: TestClient, trip_id: str, label: str = "Taipei") -> dict:
    response = client.post(f"/api/trips/{trip_id}/areas", json={"label": label, "country_code": "TW"})
    assert response.status_code == 201, response.text
    return response.json()


def test_owner_can_create_edit_list_and_delete_stays() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)

    stay = create_stay(owner, trip["id"])
    assert stay["status"] == "confirmed"
    assert stay["location"]["address_line1"] == "1 Xinyi Road"
    assert owner.get(f"/api/trips/{trip['id']}/stays").json() == [stay]

    changed_stay = owner.patch(
        f"/api/trips/{trip['id']}/stays/{stay['id']}",
        json={
            "property_name": "Private Hotel, revised",
            "status": "cancelled",
            "check_out_date": "2054-04-06",
        },
    )
    assert changed_stay.status_code == 200, changed_stay.text
    assert changed_stay.json()["property_name"] == "Private Hotel, revised"
    assert changed_stay.json()["status"] == "cancelled"
    assert changed_stay.json()["check_out_date"] == "2054-04-06"
    assert changed_stay.json()["check_out_time"] == "11:00:00"

    assert owner.delete(f"/api/trips/{trip['id']}/stays/{stay['id']}").status_code == 204


def test_other_subject_cannot_read_or_change_a_stay() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    stay = create_stay(owner, trip["id"])
    other = client_for("owner-2")

    assert other.post(
        f"/api/trips/{trip['id']}/stays",
        json={
            "location": {"locality": "Taipei", "country_code": "TW"},
            "check_in_date": "2054-04-01",
            "check_out_date": "2054-04-05",
            "property_name": "No access",
        },
    ).status_code == 404
    assert other.get(f"/api/trips/{trip['id']}/stays").status_code == 404
    assert other.get(f"/api/trips/{trip['id']}/stays/{stay['id']}").status_code == 404
    assert other.patch(f"/api/trips/{trip['id']}/stays/{stay['id']}", json={"status": "cancelled"}).status_code == 404
    assert other.delete(f"/api/trips/{trip['id']}/stays/{stay['id']}").status_code == 404


def test_a_shared_stay_shows_only_its_area_and_nights_never_the_accommodation() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    # A hotel's location always has an area, found from its city and private by default.
    stay = owner.post(
        f"{trips_path}/stays",
        json={
            "location": {"display_name": "Somewhere", "address_line1": "1 Xinyi Road", "locality": "Taipei", "country_code": "TW"},
            "check_in_date": "2054-04-01", "check_out_date": "2054-04-05", "property_name": "Private Hotel Taipei",
            "booking_reference": "BOOKING-SECRET-123", "contact_details": "host@example.test", "notes": "Ask for the quiet room.",
        },
    ).json()
    assert (stay["visibility"], stay["share_date_precision"], stay["area"]["label"]) == ("private", "month", "Taipei")
    assert owner.patch(f"{trips_path}/stays/{stay['id']}", json={"share_date_precision": "day"}).status_code == 200
    assert owner.put(f"{trips_path}/visibility/stay/{stay['id']}", json={"visibility": "everyone"}).status_code == 200
    published = owner.post(f"{trips_path}/public-projection/publish")
    assert published.status_code == 200, published.text

    delivered = TestClient(app).get(f"/api/public/trips/{published.json()['slug']}")
    assert delivered.status_code == 200, delivered.text
    (shared,) = delivered.json()["stays"]
    assert {key: shared[key] for key in ("title", "date_precision", "starts_on", "ends_on")} == {
        "title": "Taipei", "date_precision": "day", "starts_on": "2054-04-01", "ends_on": "2054-04-05",
    }
    assert shared["place"]["label"] == "Taipei"
    for private_value in ("Private Hotel Taipei", "1 Xinyi Road", "BOOKING-SECRET-123", "host@example.test", "quiet room"):
        assert private_value not in delivered.text

    # The precision is the owner's choice for what visitors may see of the dates.
    owner.patch(f"{trips_path}/stays/{stay['id']}", json={"share_date_precision": "month"})
    (reduced,) = TestClient(app).get(f"/api/public/trips/{published.json()['slug']}").json()["stays"]
    assert (reduced["starts_on"], reduced["ends_on"]) == ("2054-04", "2054-04")
    # A location cannot be detached from its area, so the shared stay keeps its safe context.
    assert TestClient(app).get(f"/api/public/trips/{published.json()['slug']}").json()["stays"]


def test_every_stay_has_a_location_but_the_accommodation_can_still_be_chosen_later() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    area = create_area(owner, trip["id"], label="Alishan")
    base = f"/api/trips/{trip['id']}/stays"
    nights = {"check_in_date": "2054-11-29", "check_out_date": "2054-11-30"}

    # No location, or one that says nothing about where it is, is refused.
    assert owner.post(base, json=nights).status_code == 422
    assert owner.post(base, json={**nights, "location": {}}).status_code == 422
    assert owner.post(base, json={**nights, "location": {"notes": "somewhere"}}).status_code == 422

    planned = owner.post(base, json={**nights, "location": {"area_id": area["id"]}})
    assert planned.status_code == 201, planned.text
    assert planned.json()["property_name"] is None
    assert planned.json()["location"]["area_id"] == area["id"]
    assert planned.json()["area"]["label"] == "Alishan"
    assert "chosen_area" not in planned.json()
    assert planned.json()["status"] == "planned"

    chosen = owner.patch(
        f"{base}/{planned.json()['id']}",
        json={
            "property_name": "Mountain Lodge",
            "location": {"display_name": "Mountain Lodge", "locality": "Alishan", "country_code": "TW"},
            "website_url": "https://lodge.example.test/",
            "status": "booked",
        },
    )
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["location"]["locality"] == "Alishan"
    assert chosen.json()["website_url"] == "https://lodge.example.test/"
    assert chosen.json()["area"]["id"] == area["id"]

    # A stay can change its location but never lose it.
    assert owner.patch(f"{base}/{planned.json()['id']}", json={"location": None}).status_code == 422


def test_a_stay_covers_at_least_one_night_and_uses_only_this_trips_areas() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    other_trip = create_trip(owner, "Elsewhere")
    foreign_area = create_area(owner, other_trip["id"], label="Elsewhere")
    stay_place = {"display_name": "Hotel", "locality": "Taipei"}

    for nights in ({"check_in_date": "2054-04-02", "check_out_date": "2054-04-02"},
                   {"check_in_date": "2054-04-02", "check_out_date": "2054-04-01"}):
        assert owner.post(f"/api/trips/{trip['id']}/stays", json={**nights, "location": stay_place}).status_code == 422
    assert owner.post(
        f"/api/trips/{trip['id']}/stays",
        json={"location": {"area_id": foreign_area["id"]}, "check_in_date": "2054-04-01", "check_out_date": "2054-04-02"},
    ).status_code == 422
    assert owner.post(
        f"/api/trips/{trip['id']}/stays",
        json={"location": stay_place, "check_in_date": "2054-04-01", "check_out_date": "2054-04-02", "website_url": "http://insecure.test/"},
    ).status_code == 422

    stay = create_stay(owner, trip["id"])
    assert owner.patch(
        f"/api/trips/{trip['id']}/stays/{stay['id']}", json={"check_in_date": "2054-04-05"}
    ).status_code == 422
    assert owner.patch(f"/api/trips/{trip['id']}/stays/{stay['id']}", json={"check_in_date": None}).status_code == 422


def test_a_stay_takes_its_area_from_its_hotel_and_reuses_it() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    stay = create_stay(owner, trip["id"])
    # The hotel is in Taipei, so the stay is too, without choosing an area.
    assert stay["area"]["label"] == "Taipei"
    assert stay["location"]["area_id"] == stay["area"]["id"]

    second = owner.post(
        f"{trips_path}/stays",
        json={"location": {"display_name": "Another hotel", "locality": "taipei", "country_code": "TW"},
              "check_in_date": "2054-04-05", "check_out_date": "2054-04-07"},
    ).json()
    areas = owner.get(f"{trips_path}/areas").json()
    # One "Taipei", however the city is spelled.
    assert [area["label"] for area in areas] == ["Taipei"] and second["area"]["id"] == stay["area"]["id"]
    assert owner.put(f"{trips_path}/visibility/stay/{stay['id']}", json={"visibility": "everyone"}).status_code == 200
