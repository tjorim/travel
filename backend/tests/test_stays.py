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
            "place": {
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


def create_broad_place(client: TestClient, trip_id: str, label: str = "Taipei") -> dict:
    response = client.post(
        f"/api/trips/{trip_id}/route-stages",
        json={"position": 0, "label": "Arrival", "place": {"label": label, "country_code": "TW"}},
    )
    assert response.status_code == 201, response.text
    return response.json()["place"]


def create_broad_stay_card(client: TestClient, trip_id: str, broad_place_id: str) -> dict:
    response = client.post(
        f"/api/trips/{trip_id}/broad-stay-cards",
        json={"broad_place_id": broad_place_id, "title": "A few nights in Taipei", "date_precision": "month"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_owner_can_create_edit_list_and_delete_stays_and_broad_stay_cards() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)

    stay = create_stay(owner, trip["id"])
    assert stay["status"] == "confirmed"
    assert stay["place"]["kind"] == "exact"
    assert stay["place"]["address_line1"] == "1 Xinyi Road"
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

    broad_place = create_broad_place(owner, trip["id"])
    card = create_broad_stay_card(owner, trip["id"], broad_place["id"])
    assert card["place"] == {
        "id": broad_place["id"],
        "kind": "broad",
        "label": "Taipei",
        "country_code": "TW",
        "region": None,
        "latitude": None,
        "longitude": None,
        "timezone": None,
    }
    assert owner.get(f"/api/trips/{trip['id']}/broad-stay-cards").json() == [card]

    changed_card = owner.patch(
        f"/api/trips/{trip['id']}/broad-stay-cards/{card['id']}",
        json={"title": "Taipei base", "date_precision": "day"},
    )
    assert changed_card.status_code == 200, changed_card.text
    assert changed_card.json()["title"] == "Taipei base"
    assert changed_card.json()["date_precision"] == "day"

    assert owner.delete(f"/api/trips/{trip['id']}/stays/{stay['id']}").status_code == 204
    assert owner.delete(f"/api/trips/{trip['id']}/broad-stay-cards/{card['id']}").status_code == 204


def test_other_subject_cannot_read_or_change_a_stay_or_broad_stay_card() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    stay = create_stay(owner, trip["id"])
    broad_place = create_broad_place(owner, trip["id"])
    card = create_broad_stay_card(owner, trip["id"], broad_place["id"])
    other = client_for("owner-2")

    assert other.post(
        f"/api/trips/{trip['id']}/stays",
        json={
            "place": {"locality": "Taipei", "country_code": "TW"},
            "check_in_date": "2054-04-01",
            "check_out_date": "2054-04-05",
            "property_name": "No access",
        },
    ).status_code == 404
    assert other.get(f"/api/trips/{trip['id']}/stays").status_code == 404
    assert other.get(f"/api/trips/{trip['id']}/stays/{stay['id']}").status_code == 404
    assert other.patch(f"/api/trips/{trip['id']}/stays/{stay['id']}", json={"status": "cancelled"}).status_code == 404
    assert other.delete(f"/api/trips/{trip['id']}/stays/{stay['id']}").status_code == 404

    assert other.post(
        f"/api/trips/{trip['id']}/broad-stay-cards",
        json={"broad_place_id": broad_place["id"], "title": "No access", "date_precision": "month"},
    ).status_code == 404
    assert other.get(f"/api/trips/{trip['id']}/broad-stay-cards").status_code == 404
    assert other.get(f"/api/trips/{trip['id']}/broad-stay-cards/{card['id']}").status_code == 404
    assert other.patch(
        f"/api/trips/{trip['id']}/broad-stay-cards/{card['id']}", json={"title": "Nope"}
    ).status_code == 404
    assert other.delete(f"/api/trips/{trip['id']}/broad-stay-cards/{card['id']}").status_code == 404


def test_a_broad_stay_card_cannot_expose_its_trip_stay_data_through_a_projection() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    create_stay(owner, trip["id"])
    broad_place = create_broad_place(owner, trip["id"])
    card = create_broad_stay_card(owner, trip["id"], broad_place["id"])

    # A card has only deliberately authored broad data. In particular it has
    # no source-stay relationship from which exact place, dates or booking
    # fields could be pulled into a later sharing projection.
    encoded_card = str(card)
    for private_value in ("Private Hotel Taipei", "1 Xinyi Road", "BOOKING-SECRET-123", "host@example.test", "2054-04-01"):
        assert private_value not in encoded_card
    assert "stay_id" not in card
    assert card["place"]["kind"] == "broad"

    # Only the selected safe card field enters the projection. The renderer
    # cannot derive any stay data, so exact-place and booking values remain
    # absent even when the card itself is shared.
    scoped = owner.put(
        f"/api/trips/{trip['id']}/public-projection",
        json={"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": [{"kind": "broad_stay_card", "id": card["id"], "fields": ["title"]}]},
    )
    assert scoped.status_code == 200, scoped.text
    published = owner.post(f"/api/trips/{trip['id']}/public-projection/publish")
    assert published.status_code == 200, published.text

    delivered = TestClient(app).get(f"/api/public/trips/{published.json()['slug']}")
    assert delivered.status_code == 200, delivered.text
    encoded_delivery = delivered.text
    assert delivered.json()["stays"] == [{"id": "broad_stay_card-1", "title": card["title"]}]
    for private_value in ("Private Hotel Taipei", "1 Xinyi Road", "BOOKING-SECRET-123", "host@example.test", "2054-04-01"):
        assert private_value not in encoded_delivery


def test_a_stay_can_be_planned_for_an_area_before_the_accommodation_is_chosen() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    area = create_broad_place(owner, trip["id"], label="Alishan")

    planned = owner.post(
        f"/api/trips/{trip['id']}/stays",
        json={"broad_place_id": area["id"], "check_in_date": "2054-11-29", "check_out_date": "2054-11-30"},
    )
    assert planned.status_code == 201, planned.text
    assert planned.json()["property_name"] is None
    assert planned.json()["place"] is None
    assert planned.json()["broad_place"]["label"] == "Alishan"
    assert planned.json()["status"] == "planned"

    chosen = owner.patch(
        f"/api/trips/{trip['id']}/stays/{planned.json()['id']}",
        json={
            "property_name": "Mountain Lodge",
            "place": {"locality": "Alishan", "country_code": "TW"},
            "website_url": "https://lodge.example.test/",
            "status": "booked",
        },
    )
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["place"]["locality"] == "Alishan"
    assert chosen.json()["website_url"] == "https://lodge.example.test/"
    assert chosen.json()["broad_place"]["id"] == area["id"]

    reopened = owner.patch(f"/api/trips/{trip['id']}/stays/{planned.json()['id']}", json={"place": None})
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["place"] is None


def test_a_stay_covers_at_least_one_night_and_uses_only_this_trips_areas() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    other_trip = create_trip(owner, "Elsewhere")
    foreign_area = create_broad_place(owner, other_trip["id"], label="Elsewhere")

    for nights in ({"check_in_date": "2054-04-02", "check_out_date": "2054-04-02"},
                   {"check_in_date": "2054-04-02", "check_out_date": "2054-04-01"}):
        assert owner.post(f"/api/trips/{trip['id']}/stays", json=nights).status_code == 422
    assert owner.post(
        f"/api/trips/{trip['id']}/stays",
        json={"broad_place_id": foreign_area["id"], "check_in_date": "2054-04-01", "check_out_date": "2054-04-02"},
    ).status_code == 422
    assert owner.post(
        f"/api/trips/{trip['id']}/stays",
        json={"check_in_date": "2054-04-01", "check_out_date": "2054-04-02", "website_url": "http://insecure.test/"},
    ).status_code == 422

    stay = create_stay(owner, trip["id"])
    assert owner.patch(
        f"/api/trips/{trip['id']}/stays/{stay['id']}", json={"check_in_date": "2054-04-05"}
    ).status_code == 422
    assert owner.patch(f"/api/trips/{trip['id']}/stays/{stay['id']}", json={"check_in_date": None}).status_code == 422
