"""A merge that shows visitors more needs its own acknowledgement (#27)."""

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_publication import (  # noqa: F401
    activate,
    client_for,
    create_trip,
    engine,
    scope,
    setup_function,
    share,
    teardown_function,
)

from app.models import Stay

CODE = "merge_widening_needs_acknowledgement"
ZEROES = {"stays": 0, "visits": 0, "routes": 0, "travel_updates": 0}


class Trip:
    """A published trip with one area, a private inn and a hotel the owner can share."""

    def __init__(self, owner: TestClient, *, inn: str = "private", hotel: str = "everyone") -> None:
        self.owner = owner
        self.trip = create_trip(owner)
        self.base = f"/api/trips/{self.trip['id']}"
        self.area = owner.post(
            f"{self.base}/areas", json={"label": "Bay Town", "country_code": "TW", "latitude": 52.2, "longitude": 4.2}
        ).json()
        self.inn = self.location("Private Inn", 52.1, 4.1, inn)
        self.hotel = self.location("Public Hotel", 52.2, 4.2, hotel)
        self.slug = None

    def location(self, label: str, latitude: float, longitude: float, visibility: str) -> dict:
        location = self.owner.post(
            f"{self.base}/locations",
            json={
                "area_id": self.area["id"],
                "label": label,
                "display_name": label,
                "latitude": latitude,
                "longitude": longitude,
            },
        ).json()
        if visibility != "private":
            share(self.owner, self.trip["id"], "location", location["id"], visibility)
        return location

    def stay(self, location: dict, visibility: str = "everyone") -> dict:
        stay = self.owner.post(
            f"{self.base}/stays",
            json={
                "location": {"existing_location_id": location["id"]},
                "check_in_date": "2054-11-01",
                "check_out_date": "2054-11-03",
            },
        ).json()
        share(self.owner, self.trip["id"], "stay", stay["id"], visibility)
        return stay

    def publish(self) -> str:
        self.slug = self.owner.post(f"{self.base}/public-projection/publish").json()["slug"]
        return self.slug

    def link(self, *items: dict, label: str = "Family") -> dict:
        link = self.owner.post(f"{self.base}/share-links", json={"label": label, "scope": scope(*items)}).json()
        activate(self.owner, self.trip["id"], link["id"])
        return link

    def public(self) -> dict:
        response = TestClient(self.owner.app).get(f"/api/public/trips/{self.slug}")
        assert response.status_code == 200, response.text
        return response.json()

    def merge(self, keep: dict, duplicates: list[dict], kind: str = "locations", **extra):
        body = {"keep_id": keep["id"], "duplicate_ids": [duplicate["id"] for duplicate in duplicates], **extra}
        return self.owner.post(f"{self.base}/{kind}/merge", json=body)

    def events(self, kind: str) -> list[dict]:
        return [event for event in self.owner.get(f"{self.base}/audit-events").json() if event["kind"] == kind]


def widened_of(response) -> dict[str, list[dict]]:
    assert response.status_code == 200, response.text
    return {duplicate["id"]: duplicate["widened"] for duplicate in response.json()["duplicates"]}


def test_the_issue_reproduction_warns_refuses_and_then_publishes_the_hotel() -> None:
    trip = Trip(client_for("owner-1"))
    stay = trip.stay(trip.inn)
    trip.publish()
    (shown,) = trip.public()["stays"]
    assert "location" not in shown and shown["place"]["label"] == "Bay Town"

    preview = trip.merge(trip.hotel, [trip.inn])
    assert widened_of(preview) == {trip.inn["id"]: [{"audience": "public", "label": None, **ZEROES, "stays": 1}]}
    body = preview.json()
    assert body["applied"] is False and any("public page" in warning for warning in body["warnings"])
    assert body["duplicates"][0]["narrowed_audiences"] == []
    # Previewing, even when the owner already accepts the widening, changes nothing.
    assert trip.merge(trip.hotel, [trip.inn], confirm_widening=True).json()["applied"] is False
    assert "location" not in trip.public()["stays"][0]

    refused = trip.merge(trip.hotel, [trip.inn], confirm=True)
    assert refused.status_code == 409, refused.text
    detail = refused.json()["detail"]
    assert detail["code"] == CODE and refused.json()["errors"][0]["code"] == CODE
    assert detail["duplicates"] == [
        {
            "id": trip.inn["id"],
            "label": "Private Inn",
            "widened": [{"audience": "public", "label": None, **ZEROES, "stays": 1}],
        }
    ]
    # Nothing moved, nothing was audited and the visitors still read the city only.
    assert {location["id"] for location in trip.owner.get(f"{trip.base}/locations").json()} == {
        trip.inn["id"],
        trip.hotel["id"],
    }
    assert trip.owner.get(f"{trip.base}/stays/{stay['id']}").json()["location"]["id"] == trip.inn["id"]
    assert trip.events("location.merge") == []
    assert "location" not in trip.public()["stays"][0]

    applied = trip.merge(trip.hotel, [trip.inn], confirm=True, confirm_widening=True)
    assert applied.status_code == 200, applied.text
    (published,) = trip.public()["stays"]
    assert (published["location"]["label"], published["location"]["latitude"]) == ("Public Hotel", 52.2)
    assert published["location"]["longitude"] == 4.2
    (event,) = trip.events("location.merge")
    assert event["details"]["merged"] == [
        {
            "id": trip.inn["id"],
            "visits": 0,
            "stays": 1,
            "routes": 0,
            "travel_updates": 0,
            "widened": [{"audience": "public", **ZEROES, "stays": 1}],
        }
    ]


def test_every_kind_of_moved_record_is_counted_for_the_audiences_that_receive_it() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    other_area = owner.post(f"{trip.base}/areas", json={"label": "Elsewhere"}).json()
    at = {"existing_location_id": trip.inn["id"]}
    trip.stay(trip.inn)
    trip.stay(trip.inn, "private")  # reaches nobody, so it reveals nothing
    visit = owner.post(f"{trip.base}/visits", json={"position": 0, "title": "Walk", "location": at}).json()
    route = owner.post(
        f"{trip.base}/routes",
        json={
            "mode": "train",
            "departure_area_id": trip.area["id"],
            "arrival_area_id": other_area["id"],
            "departure_location": at,
        },
    ).json()
    update = owner.post(
        f"{trip.base}/travel-updates",
        json={"occurred_at": "2054-11-01T10:00:00Z", "title": "Hi", "body": "Here.", "location": at},
    ).json()
    for kind, record in (("visit", visit), ("route", route), ("travel_update", update)):
        share(owner, trip.trip["id"], kind, record["id"], "everyone")
    trip.publish()

    counts = widened_of(trip.merge(trip.hotel, [trip.inn]))[trip.inn["id"]]
    assert counts == [{"audience": "public", "label": None, "stays": 1, "visits": 1, "routes": 1, "travel_updates": 1}]
    assert trip.merge(trip.hotel, [trip.inn], confirm=True).status_code == 409
    assert trip.merge(trip.hotel, [trip.inn], confirm=True, confirm_widening=True).status_code == 200


def test_a_link_audience_is_named_and_only_audiences_that_gain_the_hotel_count() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner, hotel="custom")
    # The hotel reaches only Family; the inn reaches Friends alone. The stay is everyone's.
    inn = share(owner, trip.trip["id"], "location", trip.inn["id"], "custom")
    stay = trip.stay(trip.inn)
    family = trip.link({"kind": "location", "id": trip.hotel["id"]}, label="Family")
    friends = trip.link(inn, label="Friends")
    trip.publish()
    assert stay["id"]

    preview = trip.merge(trip.hotel, [trip.inn]).json()
    (duplicate,) = preview["duplicates"]
    # Family gains the hotel's name and point; Friends and the public page lose or never had it.
    assert duplicate["widened"] == [{"audience": f"link:{family['id']}", "label": "Family", **ZEROES, "stays": 1}]
    assert duplicate["narrowed_audiences"] == ["link 'Friends'"]
    assert friends["id"]
    assert any("link 'Family'" in warning for warning in preview["warnings"])
    refused = trip.merge(trip.hotel, [trip.inn], confirm=True)
    assert refused.status_code == 409
    assert refused.json()["detail"]["duplicates"][0]["widened"][0]["label"] == "Family"
    assert trip.merge(trip.hotel, [trip.inn], confirm=True, confirm_widening=True).status_code == 200
    (event,) = trip.events("location.merge")
    # The audit trail keeps the link id, never the owner's label for it.
    assert event["details"]["merged"][0]["widened"] == [{"audience": f"link:{family['id']}", **ZEROES, "stays": 1}]
    assert "Family" not in str(event["details"])


def test_narrowing_needs_no_acknowledgement_and_is_not_reported_as_widening() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner, inn="everyone", hotel="private")
    stay = trip.stay(trip.inn)
    trip.publish()
    assert trip.public()["stays"][0]["location"]["label"] == "Private Inn"

    preview = trip.merge(trip.hotel, [trip.inn]).json()
    assert preview["duplicates"][0]["narrowed_audiences"] == ["public page"]
    assert preview["duplicates"][0]["widened"] == []
    applied = trip.merge(trip.hotel, [trip.inn], confirm=True)
    assert applied.status_code == 200, applied.text
    assert "location" not in trip.public()["stays"][0]
    assert owner.get(f"{trip.base}/stays/{stay['id']}").json()["location"]["id"] == trip.hotel["id"]
    (event,) = trip.events("location.merge")
    assert "widened" not in event["details"]["merged"][0]


def test_widening_and_narrowing_can_each_hold_for_different_audiences() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner, inn="custom", hotel="everyone")
    inn = {"kind": "location", "id": trip.inn["id"]}
    trip.stay(trip.inn)
    family = trip.link(inn, label="Family")
    trip.publish()

    # The public page gains the hotel; Family already read the inn and still reads the (everyone) hotel.
    duplicate = trip.merge(trip.hotel, [trip.inn]).json()["duplicates"][0]
    assert [item["audience"] for item in duplicate["widened"]] == ["public"]
    assert duplicate["narrowed_audiences"] == []
    assert family["id"]


def test_a_private_to_private_merge_warns_about_nothing_and_needs_no_acknowledgement() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner, hotel="private")
    trip.stay(trip.inn)
    trip.publish()

    preview = trip.merge(trip.hotel, [trip.inn]).json()
    assert preview["warnings"] == [] and preview["duplicates"][0]["widened"] == []
    assert trip.merge(trip.hotel, [trip.inn], confirm=True).status_code == 200
    (event,) = trip.events("location.merge")
    assert "widened" not in event["details"]["merged"][0]


def test_two_shared_locations_for_the_same_audience_widen_nothing() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner, inn="everyone")
    trip.stay(trip.inn)
    trip.publish()
    assert widened_of(trip.merge(trip.hotel, [trip.inn])) == {trip.inn["id"]: []}
    assert trip.merge(trip.hotel, [trip.inn], confirm=True).status_code == 200


def test_a_draft_link_and_an_unpublished_page_deliver_nothing_so_nothing_widens() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    trip.stay(trip.inn)
    owner.post(
        f"{trip.base}/share-links",
        json={"label": "Draft", "scope": scope({"kind": "location", "id": trip.hotel["id"]})},
    )
    assert widened_of(trip.merge(trip.hotel, [trip.inn])) == {trip.inn["id"]: []}
    assert trip.merge(trip.hotel, [trip.inn], confirm=True).status_code == 200


def test_a_record_the_audience_does_not_receive_widens_nothing() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    trip.stay(trip.inn, "private")
    owner.post(
        f"{trip.base}/visits",
        json={"position": 0, "title": "Walk", "location": {"existing_location_id": trip.inn["id"]}},
    )
    trip.publish()
    assert widened_of(trip.merge(trip.hotel, [trip.inn])) == {trip.inn["id"]: []}


def test_each_duplicate_is_reported_on_its_own() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    second = trip.location("Second Inn", 52.3, 4.3, "private")
    trip.stay(trip.inn)
    trip.stay(second)
    trip.stay(second)
    trip.publish()
    widened = widened_of(trip.merge(trip.hotel, [trip.inn, second]))
    assert widened[trip.inn["id"]][0]["stays"] == 1 and widened[second["id"]][0]["stays"] == 2


def test_a_cross_area_merge_reports_the_kept_area_point_a_moved_record_newly_shows() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    quiet = owner.post(f"{trip.base}/areas", json={"label": "Quiet Town", "latitude": 10.0, "longitude": 20.0}).json()
    # The inn sits in an area nobody receives, the hotel in the public Bay Town.
    inn = owner.post(
        f"{trip.base}/locations", json={"area_id": quiet["id"], "label": "Far Inn", "display_name": "Far Inn"}
    ).json()
    share(owner, trip.trip["id"], "area", trip.area["id"], "everyone")
    trip.stay(inn)
    trip.publish()
    assert trip.public()["stays"][0]["place"]["latitude"] is None

    widened = widened_of(trip.merge(trip.hotel, [inn]))[inn["id"]]
    assert [(item["audience"], item["stays"]) for item in widened] == [("public", 1)]
    assert trip.merge(trip.hotel, [inn], confirm=True).status_code == 409
    assert trip.merge(trip.hotel, [inn], confirm=True, confirm_widening=True).status_code == 200
    assert trip.public()["stays"][0]["place"]["latitude"] == 52.2


def test_the_acknowledgement_is_a_boolean_and_never_stored() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    trip.stay(trip.inn)
    trip.publish()
    assert trip.merge(trip.hotel, [trip.inn], confirm_widening=None).status_code == 422
    assert trip.merge(trip.hotel, [trip.inn], confirm=True, confirm_widening=True).status_code == 200
    assert "confirm_widening" not in str(trip.events("location.merge"))


# --- Areas ---------------------------------------------------------------------------


class Areas:
    """A published trip with a private duplicate area and a shared kept area that has a point."""

    def __init__(self, owner: TestClient, *, duplicate: str = "private", keep: str = "everyone") -> None:
        self.trip = Trip(owner)
        self.owner = owner
        self.keep = owner.post(
            f"{self.trip.base}/areas", json={"label": "Kept Town", "latitude": 40.0, "longitude": 8.0}
        ).json()
        self.duplicate = owner.post(
            f"{self.trip.base}/areas", json={"label": "Kept Town City", "latitude": 41.0, "longitude": 9.0}
        ).json()
        for area, visibility in ((self.keep, keep), (self.duplicate, duplicate)):
            if visibility != "private":
                share(owner, self.trip.trip["id"], "area", area["id"], visibility)

    def merge(self, **extra):
        return self.trip.merge(self.keep, [self.duplicate], "areas", **extra)


def test_an_area_merge_reports_and_refuses_records_that_start_to_show_the_kept_point() -> None:
    owner = client_for("owner-1")
    areas = Areas(owner)
    base, trip_id = areas.trip.base, areas.trip.trip["id"]
    visit = owner.post(f"{base}/visits", json={"position": 0, "title": "Walk", "area_id": areas.duplicate["id"]}).json()
    route = owner.post(
        f"{base}/routes",
        json={"mode": "bus", "departure_area_id": areas.duplicate["id"], "arrival_area_id": areas.keep["id"]},
    ).json()
    update = owner.post(
        f"{base}/travel-updates",
        json={"occurred_at": "2054-11-01T10:00:00Z", "title": "Hi", "body": "Hi.", "area_id": areas.duplicate["id"]},
    ).json()
    hotel = owner.post(
        f"{base}/locations", json={"label": "Hotel", "display_name": "Hotel", "area_id": areas.duplicate["id"]}
    ).json()
    stay = areas.trip.stay(hotel)
    for kind, record in (("visit", visit), ("route", route), ("travel_update", update)):
        share(owner, trip_id, kind, record["id"], "everyone")
    areas.trip.publish()
    document = areas.trip.public()
    assert document["visits"][0]["place"]["latitude"] is None and document["stays"][0]["place"]["latitude"] is None

    preview = areas.merge()
    assert preview.status_code == 200, preview.text
    (duplicate,) = preview.json()["duplicates"]
    assert duplicate["widened"] == [
        {"audience": "public", "label": None, "stays": 1, "visits": 1, "routes": 1, "travel_updates": 1}
    ]
    assert any("public page" in warning for warning in preview.json()["warnings"])
    refused = areas.merge(confirm=True)
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == CODE
    assert [item["id"] for item in refused.json()["detail"]["duplicates"]] == [areas.duplicate["id"]]
    assert len(owner.get(f"{base}/areas").json()) == 3
    assert areas.trip.events("area.merge") == []

    assert areas.merge(confirm=True, confirm_widening=True).status_code == 200
    document = areas.trip.public()
    assert document["visits"][0]["place"]["latitude"] == 40.0
    assert document["stays"][0]["place"]["latitude"] == 40.0
    assert stay["id"]
    (event,) = areas.trip.events("area.merge")
    assert event["details"]["merged"][0]["widened"] == [
        {"audience": "public", "stays": 1, "visits": 1, "routes": 1, "travel_updates": 1}
    ]


def test_an_update_at_a_moved_location_follows_the_location_into_the_kept_area() -> None:
    owner = client_for("owner-1")
    areas = Areas(owner)
    base = areas.trip.base
    hotel = owner.post(
        f"{base}/locations", json={"label": "Hotel", "display_name": "Hotel", "area_id": areas.duplicate["id"]}
    ).json()
    update = owner.post(
        f"{base}/travel-updates",
        json={
            "occurred_at": "2054-11-01T10:00:00Z",
            "title": "Hi",
            "body": "Hi.",
            "location": {"existing_location_id": hotel["id"]},
        },
    ).json()
    share(owner, areas.trip.trip["id"], "travel_update", update["id"], "everyone")
    areas.trip.publish()
    # The update names no area of its own, so the area count misses it but the audience still gains the point.
    (duplicate,) = areas.merge().json()["duplicates"]
    assert duplicate["travel_updates"] == 0
    assert [(item["audience"], item["travel_updates"]) for item in duplicate["widened"]] == [("public", 1)]


def test_area_narrowing_and_private_to_private_merges_need_no_acknowledgement() -> None:
    owner = client_for("owner-1")
    narrowing = Areas(owner, duplicate="everyone", keep="private")
    owner.post(
        f"{narrowing.trip.base}/visits",
        json={"position": 0, "title": "Walk", "area_id": narrowing.duplicate["id"]},
    )
    narrowing.trip.publish()
    (duplicate,) = narrowing.merge().json()["duplicates"]
    assert duplicate["narrowed_audiences"] == ["public page"] and duplicate["widened"] == []
    assert narrowing.merge(confirm=True).status_code == 200

    quiet = Areas(owner, keep="private")
    quiet.trip.stay(quiet.trip.inn)
    quiet.trip.publish()
    preview = quiet.merge().json()
    assert preview["duplicates"][0]["widened"] == [] and preview["warnings"] == []
    assert quiet.merge(confirm=True).status_code == 200
    (event,) = quiet.trip.events("area.merge")
    assert "widened" not in event["details"]["merged"][0]


def test_the_rows_of_a_stay_are_unchanged_after_a_refused_merge() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    trip.stay(trip.inn)
    trip.publish()
    assert trip.merge(trip.hotel, [trip.inn], confirm=True).status_code == 409
    with Session(engine) as session:
        assert [stay.location_id for stay in session.scalars(select(Stay))] == [trip.inn["id"]]
