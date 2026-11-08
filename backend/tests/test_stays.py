from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from test_publication import share

from app.auth import current_subject
from app.database import Base, get_session
from app.main import app
from app.models import StayDocumentAsset
from app.storage import LocalObjectStorage, get_storage

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


@event.listens_for(engine, "connect")
def enable_foreign_keys(dbapi_connection: object, _: object) -> None:
    dbapi_connection.execute("PRAGMA foreign_keys=ON")


def override_session() -> Generator[Session]:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def client_for(subject: str, tmp_path=None) -> TestClient:
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[current_subject] = lambda: subject
    if tmp_path is not None:
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

    assert (
        other.post(
            f"/api/trips/{trip['id']}/stays",
            json={
                "location": {"locality": "Taipei", "country_code": "TW"},
                "check_in_date": "2054-04-01",
                "check_out_date": "2054-04-05",
                "property_name": "No access",
            },
        ).status_code
        == 404
    )
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
            "location": {
                "display_name": "Somewhere",
                "address_line1": "1 Xinyi Road",
                "locality": "Taipei",
                "country_code": "TW",
            },
            "check_in_date": "2054-04-01",
            "check_out_date": "2054-04-05",
            "property_name": "Private Hotel Taipei",
            "booking_reference": "BOOKING-SECRET-123",
            "contact_details": "host@example.test",
            "notes": "Ask for the quiet room.",
        },
    ).json()
    assert (stay["visibility"], stay["share_date_precision"], stay["area"]["label"]) == ("private", None, "Taipei")
    assert owner.patch(f"{trips_path}/stays/{stay['id']}", json={"share_date_precision": "day"}).status_code == 200
    # No audience-level cap: the stay's own precision decides.
    assert owner.put(f"{trips_path}/public-projection", json={"defaults": None}).status_code == 200
    assert owner.put(f"{trips_path}/visibility/stay/{stay['id']}", json={"visibility": "everyone"}).status_code == 200
    published = owner.post(f"{trips_path}/public-projection/publish")
    assert published.status_code == 200, published.text

    delivered = TestClient(app).get(f"/api/public/trips/{published.json()['slug']}")
    assert delivered.status_code == 200, delivered.text
    (shared,) = delivered.json()["stays"]
    assert {key: shared[key] for key in ("title", "date_precision", "starts_on", "ends_on")} == {
        "title": "Taipei",
        "date_precision": "day",
        "starts_on": "2054-04-01",
        "ends_on": "2054-04-05",
    }
    assert shared["place"]["label"] == "Taipei"
    for private_value in (
        "Private Hotel Taipei",
        "1 Xinyi Road",
        "BOOKING-SECRET-123",
        "host@example.test",
        "quiet room",
    ):
        assert private_value not in delivered.text

    # The precision is the owner's choice for what visitors may see of the dates.
    owner.patch(f"{trips_path}/stays/{stay['id']}", json={"share_date_precision": "month"})
    (reduced,) = TestClient(app).get(f"/api/public/trips/{published.json()['slug']}").json()["stays"]
    assert (reduced["starts_on"], reduced["ends_on"]) == ("2054-04", "2054-04")
    # A location cannot be detached from its area, so the shared stay keeps its safe context.
    assert TestClient(app).get(f"/api/public/trips/{published.json()['slug']}").json()["stays"]


def test_a_stay_needs_an_area_but_the_accommodation_can_be_chosen_later() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    area = create_area(owner, trip["id"], label="Alishan")
    base = f"/api/trips/{trip['id']}/stays"
    nights = {"check_in_date": "2054-11-29", "check_out_date": "2054-11-30"}

    # No place at all, or a location that says nothing about where it is, is refused.
    assert owner.post(base, json=nights).status_code == 422
    assert owner.post(base, json={**nights, "location": {}}).status_code == 422
    assert owner.post(base, json={**nights, "location": {"notes": "somewhere"}}).status_code == 422

    # A location that names nothing but its area means the same as the area: no location is created.
    planned = owner.post(base, json={**nights, "location": {"area_id": area["id"]}})
    assert planned.status_code == 201, planned.text
    assert planned.json()["property_name"] is None
    assert planned.json()["location"] is None
    assert planned.json()["area"]["id"] == area["id"]
    assert planned.json()["area"]["label"] == "Alishan"
    assert "chosen_area" not in planned.json()
    assert planned.json()["status"] == "planned"
    assert owner.get(f"/api/trips/{trip['id']}/locations").json() == []

    chosen = owner.patch(
        f"{base}/{planned.json()['id']}",
        json={
            "property_name": "Mountain Lodge",
            "location": {"display_name": "Mountain Lodge", "locality": "Alishan", "country_code": "TW"},
            "website_url": "https://lodge.example.test/",
            "status": "confirmed",
        },
    )
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["status"] == "confirmed"
    assert chosen.json()["location"]["locality"] == "Alishan"
    assert chosen.json()["website_url"] == "https://lodge.example.test/"
    assert chosen.json()["area"]["id"] == area["id"]
    assert chosen.json()["location"]["area_id"] == area["id"]

    # Clearing the location returns the stay to its area alone and adds no placeholder location.
    cleared = owner.patch(f"{base}/{planned.json()['id']}", json={"location": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["area"]["id"] == area["id"]
    assert cleared.json()["location"] is None
    assert [item["id"] for item in owner.get(f"/api/trips/{trip['id']}/locations").json()] == [
        chosen.json()["location"]["id"]
    ]


def test_undecided_stays_create_no_location_and_keep_their_area_consistent() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    tainan = create_area(owner, trip["id"], label="Tainan")
    chiayi = create_area(owner, trip["id"], label="Chiayi")
    base = f"/api/trips/{trip['id']}/stays"
    locations = f"/api/trips/{trip['id']}/locations"

    first = owner.post(
        base, json={"area_id": tainan["id"], "check_in_date": "2054-12-01", "check_out_date": "2054-12-03"}
    )
    assert first.status_code == 201, first.text
    assert first.json()["area"]["id"] == tainan["id"]
    assert first.json()["location"] is None
    second = owner.post(
        base, json={"area_id": tainan["id"], "check_in_date": "2054-12-05", "check_out_date": "2054-12-06"}
    )
    third = owner.post(
        base,
        json={"location": {"area_id": tainan["id"]}, "check_in_date": "2054-12-07", "check_out_date": "2054-12-08"},
    )
    assert [stay.json()["location"] for stay in (second, third)] == [None, None]
    assert owner.get(locations).json() == []
    assert len(owner.get(base).json()) == 3

    # A location in the area, with or without the area named, files the stay under that area.
    hotel = owner.post(locations, json={"display_name": "Hotel", "label": "Hotel", "area_id": tainan["id"]}).json()
    for body in (
        {"location": {"existing_location_id": hotel["id"]}},
        {"area_id": tainan["id"], **{"location": {"existing_location_id": hotel["id"]}}},
    ):
        made = owner.post(base, json={**body, "check_in_date": "2054-12-09", "check_out_date": "2054-12-10"})
        assert made.status_code == 201, made.text
        assert (made.json()["location"]["id"], made.json()["area"]["id"]) == (hotel["id"], tainan["id"])

    # An area and a location that disagree are refused, on create and on update.
    disagree = {"area_id": chiayi["id"], "location": {"existing_location_id": hotel["id"]}}
    refused = owner.post(base, json={**disagree, "check_in_date": "2054-12-01", "check_out_date": "2054-12-02"})
    assert (
        refused.status_code == 422 and refused.json()["errors"][0]["code"] == "that_location_is_not_in_the_chosen_area"
    )
    refused = owner.patch(f"{base}/{second.json()['id']}", json=disagree)
    assert (
        refused.status_code == 422 and refused.json()["errors"][0]["code"] == "that_location_is_not_in_the_chosen_area"
    )
    refused = owner.patch(
        f"{base}/{second.json()['id']}", json={"area_id": chiayi["id"], "location": {"area_id": tainan["id"]}}
    )
    assert (
        refused.status_code == 422 and refused.json()["errors"][0]["code"] == "that_location_is_not_in_the_chosen_area"
    )
    assert owner.get(f"{base}/{second.json()['id']}").json()["area"]["id"] == tainan["id"]

    # Choosing the accommodation later settles the area; giving the area alone keeps it only when it is there.
    chosen = owner.patch(f"{base}/{second.json()['id']}", json={"location": {"existing_location_id": hotel["id"]}})
    assert chosen.json()["location"]["id"] == hotel["id"]
    same_area = owner.patch(f"{base}/{second.json()['id']}", json={"area_id": tainan["id"]})
    assert same_area.json()["location"]["id"] == hotel["id"]

    # Moving a stay to another area leaves it undecided there: no placeholder is made.
    moved = owner.patch(f"{base}/{second.json()['id']}", json={"area_id": chiayi["id"]})
    assert moved.status_code == 200, moved.text
    assert moved.json()["area"]["id"] == chiayi["id"]
    assert moved.json()["location"] is None
    assert [item["id"] for item in owner.get(locations).json()] == [hotel["id"]]

    # A location can be removed while the area is changed in the same request.
    again = owner.patch(f"{base}/{chosen.json()['id']}", json={"location": None, "area_id": tainan["id"]})
    assert (again.json()["area"]["id"], again.json()["location"]) == (tainan["id"], None)
    assert owner.patch(f"{base}/{second.json()['id']}", json={"area_id": None}).status_code == 422

    # Neither an area nor a location is refused.
    assert owner.post(base, json={"check_in_date": "2054-12-01", "check_out_date": "2054-12-02"}).status_code == 422


def test_a_stay_covers_at_least_one_night_and_uses_only_this_trips_areas() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    other_trip = create_trip(owner, "Elsewhere")
    foreign_area = create_area(owner, other_trip["id"], label="Elsewhere")
    stay_place = {"display_name": "Hotel", "locality": "Taipei"}

    for nights in (
        {"check_in_date": "2054-04-02", "check_out_date": "2054-04-02"},
        {"check_in_date": "2054-04-02", "check_out_date": "2054-04-01"},
    ):
        assert owner.post(f"/api/trips/{trip['id']}/stays", json={**nights, "location": stay_place}).status_code == 422
    assert (
        owner.post(
            f"/api/trips/{trip['id']}/stays",
            json={
                "location": {"area_id": foreign_area["id"]},
                "check_in_date": "2054-04-01",
                "check_out_date": "2054-04-02",
            },
        ).status_code
        == 422
    )
    assert (
        owner.post(
            f"/api/trips/{trip['id']}/stays",
            json={
                "location": stay_place,
                "check_in_date": "2054-04-01",
                "check_out_date": "2054-04-02",
                "website_url": "http://insecure.test/",
            },
        ).status_code
        == 422
    )

    stay = create_stay(owner, trip["id"])
    assert (
        owner.patch(f"/api/trips/{trip['id']}/stays/{stay['id']}", json={"check_in_date": "2054-04-05"}).status_code
        == 422
    )
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
        json={
            "location": {"display_name": "Another hotel", "locality": "taipei", "country_code": "TW"},
            "check_in_date": "2054-04-05",
            "check_out_date": "2054-04-07",
        },
    ).json()
    areas = owner.get(f"{trips_path}/areas").json()
    # One "Taipei", however the city is spelled.
    assert [area["label"] for area in areas] == ["Taipei"] and second["area"]["id"] == stay["area"]["id"]
    assert owner.put(f"{trips_path}/visibility/stay/{stay['id']}", json={"visibility": "everyone"}).status_code == 200


def test_stay_ideas_can_overlap_but_are_never_shared_even_when_chosen() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    area = create_area(owner, trip["id"], "Tainan")
    nights = {"check_in_date": "2054-11-30", "check_out_date": "2054-12-03"}
    ideas = [
        owner.post(
            f"{trips_path}/stays",
            json={**nights, "area_id": area["id"], "status": "idea", "property_name": name},
        )
        for name in ("Hotel A", "Hotel B", "Hotel C")
    ]
    # Identical dates raise no conflict, and a new idea stays private.
    assert [response.status_code for response in ideas] == [201, 201, 201]
    assert {response.json()["status"] for response in ideas} == {"idea"}
    assert {response.json()["visibility"] for response in ideas} == {"private"}
    idea = ideas[0].json()
    assert owner.get(f"{trips_path}/stays/{idea['id']}").json()["status"] == "idea"
    assert sorted(item["status"] for item in owner.get(f"{trips_path}/stays").json()) == ["idea"] * 3

    # A candidate is not an itinerary record: it cannot be offered to any audience.
    refused = owner.put(f"{trips_path}/visibility/stay/{idea['id']}", json={"visibility": "everyone"})
    assert refused.status_code == 422, refused.text
    assert "a_stay_idea_is_only_a_candidate_make_it_planned_before_sharing_it" in refused.text

    # Choosing it makes it shareable; the rejected alternatives stay private.
    assert owner.patch(f"{trips_path}/stays/{idea['id']}", json={"status": "planned"}).json()["status"] == "planned"
    assert owner.put(f"{trips_path}/visibility/stay/{idea['id']}", json={"visibility": "everyone"}).status_code == 200
    published = owner.post(f"{trips_path}/public-projection/publish")
    assert published.status_code == 200, published.text
    public = f"/api/public/trips/{published.json()['slug']}"
    assert len(TestClient(app).get(public).json()["stays"]) == 1

    # Turning a shared stay back into an idea withdraws it from delivery at once.
    back = owner.patch(f"{trips_path}/stays/{idea['id']}", json={"status": "idea"})
    assert (back.status_code, back.json()["visibility"]) == (200, "private")
    assert TestClient(app).get(public).json()["stays"] == []

    # The other statuses are unchanged.
    for status in ("planned", "confirmed", "cancelled"):
        assert owner.patch(f"{trips_path}/stays/{idea['id']}", json={"status": status}).json()["status"] == status
    assert owner.patch(f"{trips_path}/stays/{idea['id']}", json={"status": "maybe"}).status_code == 422


def test_booked_is_accepted_as_confirmed_for_stays_and_routes() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    area = create_area(owner, trip["id"], "Tainan")
    other = create_area(owner, trip["id"], "Taipei")
    nights = {"check_in_date": "2054-11-30", "check_out_date": "2054-12-03", "area_id": area["id"]}
    # Older clients, assistants and archive files still say booked; it is stored and returned as confirmed.
    stay = owner.post(f"{trips_path}/stays", json={**nights, "status": "booked"})
    assert (stay.status_code, stay.json()["status"]) == (201, "confirmed")
    changed = owner.patch(f"{trips_path}/stays/{stay.json()['id']}", json={"status": "planned"}).json()
    assert changed["status"] == "planned"
    assert owner.patch(f"{trips_path}/stays/{stay.json()['id']}", json={"status": "booked"}).json()["status"] == (
        "confirmed"
    )
    ends = {"departure_area_id": area["id"], "arrival_area_id": other["id"]}
    route = owner.post(f"{trips_path}/routes", json={"mode": "train", "status": "booked", **ends})
    assert (route.status_code, route.json()["status"]) == (201, "confirmed")
    route_path = f"{trips_path}/routes/{route.json()['id']}"
    assert owner.patch(route_path, json={"status": "planned"}).json()["status"] == "planned"
    assert owner.patch(route_path, json={"status": "booked"}).json()["status"] == "confirmed"
    assert owner.patch(route_path, json={"status": "paid"}).status_code == 422


def upload_document(client: TestClient, trip_id: str, title: str = "Hotel confirmation") -> dict:
    response = client.post(
        f"/api/trips/{trip_id}/documents/uploads",
        data={"title": title, "document_kind": "booking"},
        files={"file": ("confirmation.txt", f"private confirmation {title}".encode(), "text/plain")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def stay_payload(area_id: str, **overrides) -> dict:
    return {"area_id": area_id, "check_in_date": "2054-04-01", "check_out_date": "2054-04-05", **overrides}


def test_stay_documents_are_explicit_owner_only_references_like_a_routes(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    area = create_area(owner, trip["id"])
    first, second = upload_document(owner, trip["id"], "First"), upload_document(owner, trip["id"], "Second")

    plain = owner.post(f"{trips_path}/stays", json=stay_payload(area["id"])).json()
    assert plain["document_asset_ids"] == []

    stay = owner.post(f"{trips_path}/stays", json=stay_payload(area["id"], document_asset_ids=[first["id"]])).json()
    assert stay["document_asset_ids"] == [first["id"]]
    assert owner.get(f"{trips_path}/stays/{stay['id']}").json()["document_asset_ids"] == [first["id"]]
    listed = {item["id"]: item["document_asset_ids"] for item in owner.get(f"{trips_path}/stays").json()}
    assert listed == {plain["id"]: [], stay["id"]: [first["id"]]}

    # Omitting the field keeps the links; the full list replaces them; an empty list detaches them all.
    kept = owner.patch(f"{trips_path}/stays/{stay['id']}", json={"notes": "Quiet room"})
    assert kept.json()["document_asset_ids"] == [first["id"]]
    replaced = owner.patch(f"{trips_path}/stays/{stay['id']}", json={"document_asset_ids": [second["id"], first["id"]]})
    assert replaced.status_code == 200, replaced.text
    assert sorted(replaced.json()["document_asset_ids"]) == sorted([first["id"], second["id"]])
    same = owner.patch(f"{trips_path}/stays/{stay['id']}", json={"document_asset_ids": [first["id"]]})
    assert same.json()["document_asset_ids"] == [first["id"]]
    cleared = owner.patch(f"{trips_path}/stays/{stay['id']}", json={"document_asset_ids": []})
    assert cleared.json()["document_asset_ids"] == []
    assert owner.get(f"{trips_path}/documents/{first['id']}").status_code == 200  # detaching never deletes a document

    # Null is not a list, a document attaches once, and at most twelve attach.
    assert owner.patch(f"{trips_path}/stays/{stay['id']}", json={"document_asset_ids": None}).status_code == 422
    twice = owner.patch(f"{trips_path}/stays/{stay['id']}", json={"document_asset_ids": [first["id"]] * 2})
    assert twice.status_code == 422
    too_many = owner.post(f"{trips_path}/stays", json=stay_payload(area["id"], document_asset_ids=["a"] * 13))
    assert too_many.status_code == 422


def test_a_stay_refuses_missing_foreign_and_unknown_documents(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    other_trip = create_trip(owner, "Elsewhere 2054")
    area = create_area(owner, trip["id"])
    mine = upload_document(owner, trip["id"])
    elsewhere = upload_document(owner, other_trip["id"], "Elsewhere")
    stranger_trip = create_trip(client_for("owner-2", tmp_path), "Not yours")
    foreign = upload_document(client_for("owner-2", tmp_path), stranger_trip["id"], "Foreign")
    owner = client_for("owner-1", tmp_path)
    trips_path = f"/api/trips/{trip['id']}"
    stay = owner.post(f"{trips_path}/stays", json=stay_payload(area["id"], document_asset_ids=[mine["id"]])).json()

    for bad in ("missing-document", elsewhere["id"], foreign["id"]):
        created = owner.post(f"{trips_path}/stays", json=stay_payload(area["id"], document_asset_ids=[mine["id"], bad]))
        assert created.status_code == 422, bad
        assert created.json()["errors"][0]["code"] == "one_or_more_documents_are_unavailable_for_this_trip"
        changed = owner.patch(f"{trips_path}/stays/{stay['id']}", json={"document_asset_ids": [bad]})
        assert changed.status_code == 422, bad
        assert foreign["id"] not in changed.text and elsewhere["id"] not in changed.text
    # Nothing was stored by a refused request.
    assert owner.get(f"{trips_path}/stays/{stay['id']}").json()["document_asset_ids"] == [mine["id"]]
    assert len(owner.get(f"{trips_path}/stays").json()) == 1

    # Another owner can neither read the links nor attach to this stay.
    stranger = client_for("owner-2", tmp_path)
    assert stranger.get(f"{trips_path}/stays/{stay['id']}").status_code == 404
    assert stranger.patch(f"{trips_path}/stays/{stay['id']}", json={"document_asset_ids": []}).status_code == 404


def test_deleting_a_stay_or_a_document_removes_only_the_link(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    area = create_area(owner, trip["id"])
    first, second = upload_document(owner, trip["id"], "First"), upload_document(owner, trip["id"], "Second")
    shared = owner.post(
        f"{trips_path}/stays", json=stay_payload(area["id"], document_asset_ids=[first["id"], second["id"]])
    ).json()
    doomed = owner.post(f"{trips_path}/stays", json=stay_payload(area["id"], document_asset_ids=[first["id"]])).json()

    def link_count() -> int:
        with TestingSessionLocal() as session:
            return session.scalar(select(func.count()).select_from(StayDocumentAsset))

    assert link_count() == 3
    # Deleting a document is handled as for a route: it goes, and so do its links; the stays stay.
    assert owner.delete(f"{trips_path}/documents/{second['id']}").status_code == 204
    assert owner.get(f"{trips_path}/stays/{shared['id']}").json()["document_asset_ids"] == [first["id"]]
    assert link_count() == 2

    # Deleting a stay removes its links and leaves the document and the other stay's link.
    assert owner.delete(f"{trips_path}/stays/{doomed['id']}").status_code == 204
    assert link_count() == 1
    assert owner.get(f"{trips_path}/documents/{first['id']}").status_code == 200
    assert owner.get(f"{trips_path}/stays/{shared['id']}").json()["document_asset_ids"] == [first["id"]]

    # Deleting the trip takes everything with it.
    assert owner.delete(f"{trips_path}").status_code == 204
    assert link_count() == 0


def test_a_document_on_a_shared_stay_never_reaches_any_visitor_response(tmp_path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    area = create_area(owner, trip["id"])
    document = upload_document(owner, trip["id"], "CANARY-DOCUMENT-TITLE")
    stay = owner.post(
        f"{trips_path}/stays",
        json=stay_payload(area["id"], document_asset_ids=[document["id"]], booking_reference="CANARY-BOOKING"),
    ).json()
    item = share(owner, trip["id"], "stay", stay["id"], "custom")
    scoped = owner.put(
        f"{trips_path}/public-projection",
        json={"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": [item]},
    )
    assert scoped.status_code == 200, scoped.text
    published = owner.post(f"{trips_path}/public-projection/publish")
    assert published.status_code == 200, published.text
    link = owner.post(f"{trips_path}/share-links", json={"label": "Family", "scope": scoped.json()["scope"]}).json()
    active = owner.post(f"{trips_path}/share-links/{link['id']}/activate", json={"expires_in_days": 30}).json()

    collection = owner.post("/api/collections", json={"label": "Family", "title": "Shared"}).json()
    member = owner.post(
        f"/api/collections/{collection['id']}/members", json={"trip_id": trip["id"], "scope": scoped.json()["scope"]}
    )
    assert member.status_code == 201, member.text
    activated = owner.post(f"/api/collections/{collection['id']}/activate", json={"expires_in_days": 30}).json()

    anonymous = TestClient(app)
    slug, token = published.json()["slug"], active["token"]
    (listed,) = anonymous.get(f"/api/shared/{activated['token']}").json()["trips"]
    responses = [
        anonymous.get(f"/api/public/trips/{slug}"),
        anonymous.get(f"/api/shared/{token}"),
        anonymous.get(f"/api/shared/{activated['token']}"),
        anonymous.get(f"/api/shared/{activated['token']}/trips/{listed['id']}"),
    ]
    # The owner's own previews of both audiences are no different.
    responses += [
        owner.post(f"{trips_path}/public-projection/preview"),
        owner.post(f"{trips_path}/share-links/{link['id']}/preview"),
    ]
    for response in responses:
        assert response.status_code == 200, (response.url, response.text)
        assert document["id"] not in response.text, response.url
        for private in ("CANARY-DOCUMENT-TITLE", "document_asset_ids", "confirmation.txt", "CANARY-BOOKING"):
            assert private not in response.text, (response.url, private)
    # The stay itself is delivered, so the check proves absence rather than an empty view.
    (delivered,) = responses[0].json()["stays"]
    assert delivered["title"] == "Taipei"

    # A document is reachable only by the owner, never through a visitor file route, whatever its links.
    for path in (
        f"/api/public/trips/{slug}/files/{document['id']}",
        f"/api/shared/{token}/files/{document['id']}",
        f"/api/public/trips/{slug}/navigation/{document['id']}",
    ):
        assert anonymous.get(path).status_code == 404, path
