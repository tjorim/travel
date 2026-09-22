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
    response = client.post("/api/v1/trips", json={"title": title, "summary": "A private trip."})
    assert response.status_code == 201, response.text
    return response.json()


def create_stay(client: TestClient, trip_id: str) -> dict:
    response = client.post(
        f"/api/v1/trips/{trip_id}/stays",
        json={
            "place": {
                "address_line1": "1 Xinyi Road",
                "locality": "Taipei",
                "country_code": "TW",
                "latitude": 25.033,
                "longitude": 121.565,
            },
            "arrives_at": "2054-04-01T15:00:00Z",
            "departs_at": "2054-04-05T11:00:00Z",
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
        f"/api/v1/trips/{trip_id}/route-stages",
        json={"position": 0, "label": "Arrival", "place": {"label": label, "country_code": "TW"}},
    )
    assert response.status_code == 201, response.text
    return response.json()["place"]


def create_broad_stay_card(client: TestClient, trip_id: str, broad_place_id: str) -> dict:
    response = client.post(
        f"/api/v1/trips/{trip_id}/broad-stay-cards",
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
    assert owner.get(f"/api/v1/trips/{trip['id']}/stays").json() == [stay]

    changed_stay = owner.patch(
        f"/api/v1/trips/{trip['id']}/stays/{stay['id']}",
        json={
            "property_name": "Private Hotel, revised",
            "status": "cancelled",
            "departs_at": "2054-04-06T11:00:00Z",
        },
    )
    assert changed_stay.status_code == 200, changed_stay.text
    assert changed_stay.json()["property_name"] == "Private Hotel, revised"
    assert changed_stay.json()["status"] == "cancelled"
    assert changed_stay.json()["departs_at"].startswith("2054-04-06T11:00:00")

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
    }
    assert owner.get(f"/api/v1/trips/{trip['id']}/broad-stay-cards").json() == [card]

    changed_card = owner.patch(
        f"/api/v1/trips/{trip['id']}/broad-stay-cards/{card['id']}",
        json={"title": "Taipei base", "date_precision": "day"},
    )
    assert changed_card.status_code == 200, changed_card.text
    assert changed_card.json()["title"] == "Taipei base"
    assert changed_card.json()["date_precision"] == "day"

    assert owner.delete(f"/api/v1/trips/{trip['id']}/stays/{stay['id']}").status_code == 204
    assert owner.delete(f"/api/v1/trips/{trip['id']}/broad-stay-cards/{card['id']}").status_code == 204


def test_other_subject_cannot_read_or_change_a_stay_or_broad_stay_card() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    stay = create_stay(owner, trip["id"])
    broad_place = create_broad_place(owner, trip["id"])
    card = create_broad_stay_card(owner, trip["id"], broad_place["id"])
    other = client_for("owner-2")

    assert other.post(
        f"/api/v1/trips/{trip['id']}/stays",
        json={
            "place": {"locality": "Taipei", "country_code": "TW"},
            "arrives_at": "2054-04-01T15:00:00Z",
            "departs_at": "2054-04-05T11:00:00Z",
            "property_name": "No access",
        },
    ).status_code == 404
    assert other.get(f"/api/v1/trips/{trip['id']}/stays").status_code == 404
    assert other.get(f"/api/v1/trips/{trip['id']}/stays/{stay['id']}").status_code == 404
    assert other.patch(f"/api/v1/trips/{trip['id']}/stays/{stay['id']}", json={"status": "cancelled"}).status_code == 404
    assert other.delete(f"/api/v1/trips/{trip['id']}/stays/{stay['id']}").status_code == 404

    assert other.post(
        f"/api/v1/trips/{trip['id']}/broad-stay-cards",
        json={"broad_place_id": broad_place["id"], "title": "No access", "date_precision": "month"},
    ).status_code == 404
    assert other.get(f"/api/v1/trips/{trip['id']}/broad-stay-cards").status_code == 404
    assert other.get(f"/api/v1/trips/{trip['id']}/broad-stay-cards/{card['id']}").status_code == 404
    assert other.patch(
        f"/api/v1/trips/{trip['id']}/broad-stay-cards/{card['id']}", json={"title": "Nope"}
    ).status_code == 404
    assert other.delete(f"/api/v1/trips/{trip['id']}/broad-stay-cards/{card['id']}").status_code == 404


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

    # Card selection is deliberately out of scope for this delivery phase.
    # The existing projection renderer cannot derive any stay data, so a
    # published response remains free of all exact-place and booking values.
    scoped = owner.put(
        f"/api/v1/trips/{trip['id']}/public-projection",
        json={"route_stage_ids": [], "moment_ids": []},
    )
    assert scoped.status_code == 200, scoped.text
    published = owner.post(f"/api/v1/trips/{trip['id']}/public-projection/publish")
    assert published.status_code == 200, published.text

    delivered = TestClient(app).get(f"/api/v1/public/trips/{published.json()['slug']}")
    assert delivered.status_code == 200, delivered.text
    encoded_delivery = delivered.text
    for private_value in ("Private Hotel Taipei", "1 Xinyi Road", "BOOKING-SECRET-123", "host@example.test", "2054-04-01"):
        assert private_value not in encoded_delivery
