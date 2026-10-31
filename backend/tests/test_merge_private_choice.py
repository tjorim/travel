"""The owner can make each newly shown record private first, per record, in a merge (#27)."""

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_merge_widening import CODE, ZEROES, Areas, Trip
from test_publication import (  # noqa: F401
    client_for,
    engine,
    scope,
    setup_function,
    share,
    teardown_function,
)

from app.models import Route, Stay, TravelUpdate, Visibility, Visit

STALE = "merge_private_choice_is_stale"


def ref(kind: str, record: dict) -> dict:
    return {"kind": kind, "id": record["id"]}


def visibility_of(trip: Trip, kind: str, record: dict) -> str:
    model = {"stay": Stay, "visit": Visit, "route": Route, "travel_update": TravelUpdate}[kind]
    with Session(engine) as session:
        stored = session.get(model, record["id"])
        assert stored is not None
        return stored.visibility.value


class Inn:
    """A published trip whose private inn has two shared stays and a shared visit."""

    def __init__(self, owner: TestClient) -> None:
        self.trip = Trip(owner)
        self.owner = owner
        self.first = self.trip.stay(self.trip.inn)
        self.second = self.trip.stay(self.trip.inn)
        self.visit = owner.post(
            f"{self.trip.base}/visits",
            json={
                "position": 0,
                "title": "Walk",
                "starts_on": "2054-11-02",
                "location": {"existing_location_id": self.trip.inn["id"]},
            },
        ).json()
        share(owner, self.trip.trip["id"], "visit", self.visit["id"], "everyone")
        self.trip.publish()

    def merge(self, *private: dict, **extra):
        return self.trip.merge(self.trip.hotel, [self.trip.inn], make_private=list(private), **extra)


def hidden(trip: Trip) -> list[dict]:
    """The sharing-history events that made a record private (setting records up shares them first)."""
    return [event for event in trip.events("record.visibility_change") if event["details"]["to"] == "private"]


def records_of(response) -> dict[tuple[str, str], dict]:
    assert response.status_code == 200, response.text
    return {(entry["kind"], entry["id"]): entry for entry in response.json()["duplicates"][0]["widened_records"]}


def test_the_preview_lists_each_newly_shown_record_with_what_hiding_it_would_cost() -> None:
    owner = client_for("owner-1")
    inn = Inn(owner)
    # Family already reads the inn (and, because the hotel is everyone's, the hotel): hiding a stay hides it from them too.
    inn_item = share(owner, inn.trip.trip["id"], "location", inn.trip.inn["id"], "custom")
    inn.trip.link(inn_item, label="Family")

    listed = records_of(inn.merge())
    assert set(listed) == {("stay", inn.first["id"]), ("stay", inn.second["id"]), ("visit", inn.visit["id"])}
    entry = listed[("stay", inn.first["id"])]
    assert entry["label"] is None and entry["starts_on"] == "2054-11-01" and entry["visibility"] == "everyone"
    assert entry["widened_for"] == [{"audience": "public", "label": None}]
    assert [item["label"] for item in entry["hides_from"]] == ["Family"]
    assert entry["custom_picks"] == 0 and entry["make_private"] is False
    visit = listed[("visit", inn.visit["id"])]
    assert visit["label"] == "Walk" and visit["starts_on"] == "2054-11-02"
    # Nothing was changed by looking.
    assert visibility_of(inn.trip, "stay", inn.first) == "everyone"


def test_a_private_choice_hides_only_that_record_and_the_rest_still_needs_the_acknowledgement() -> None:
    owner = client_for("owner-1")
    inn = Inn(owner)
    assert len(inn.trip.public()["stays"]) == 2

    preview = inn.merge(ref("stay", inn.first))
    # The preview already counts what remains and marks the chosen record.
    assert preview.json()["duplicates"][0]["widened"] == [
        {"audience": "public", "label": None, **ZEROES, "stays": 1, "visits": 1}
    ]
    assert records_of(preview)[("stay", inn.first["id"])]["make_private"] is True
    assert visibility_of(inn.trip, "stay", inn.first) == "everyone"

    refused = inn.merge(ref("stay", inn.first), confirm=True)
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == CODE
    (review,) = refused.json()["detail"]["duplicates"]
    assert review["widened"] == [{"audience": "public", "label": None, **ZEROES, "stays": 1, "visits": 1}]
    # Refused: nothing was hidden, moved or audited.
    assert visibility_of(inn.trip, "stay", inn.first) == "everyone"
    assert inn.trip.events("location.merge") == []
    assert hidden(inn.trip) == []

    applied = inn.merge(ref("stay", inn.first), confirm=True, confirm_widening=True)
    assert applied.status_code == 200, applied.text
    assert visibility_of(inn.trip, "stay", inn.first) == "private"
    assert visibility_of(inn.trip, "stay", inn.second) == "everyone"
    shown = inn.trip.public()["stays"]
    assert len(shown) == 1 and shown[0]["location"]["label"] == "Public Hotel"
    with Session(engine) as session:
        assert {stay.location_id for stay in session.scalars(select(Stay))} == {inn.trip.hotel["id"]}
        assert session.get(Stay, inn.first["id"]).visibility == Visibility.PRIVATE
    (change,) = hidden(inn.trip)
    assert change["target_id"] == inn.first["id"]
    assert change["details"]["record_kind"] == "stay" and change["details"]["to"] == "private"
    assert change["details"]["no_longer_reached"] == ["public"]
    (event,) = inn.trip.events("location.merge")
    assert event["details"]["made_private"] == [{"kind": "stay", "id": inn.first["id"]}]
    assert event["details"]["merged"][0]["widened"] == [{"audience": "public", **ZEROES, "stays": 1, "visits": 1}]


def test_choosing_every_newly_shown_record_needs_no_acknowledgement() -> None:
    owner = client_for("owner-1")
    inn = Inn(owner)
    everything = [ref("stay", inn.first), ref("stay", inn.second), ref("visit", inn.visit)]
    body = {"keep_id": inn.trip.hotel["id"], "duplicate_ids": [inn.trip.inn["id"]], "make_private": everything}

    preview = owner.post(f"{inn.trip.base}/locations/merge", json=body)
    assert preview.json()["duplicates"][0]["widened"] == [] and preview.json()["warnings"] == []
    applied = owner.post(f"{inn.trip.base}/locations/merge", json={**body, "confirm": True})
    assert applied.status_code == 200, applied.text
    assert inn.trip.public()["stays"] == [] and inn.trip.public()["visits"] == []
    (event,) = inn.trip.events("location.merge")
    assert [item["kind"] for item in event["details"]["made_private"]] == ["stay", "stay", "visit"]
    assert "widened" not in event["details"]["merged"][0]
    assert len(hidden(inn.trip)) == 3


def test_hiding_a_custom_record_drops_its_picks_and_the_preview_says_so() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    stay = trip.stay(trip.inn, "custom")
    item = {"kind": "stay", "id": stay["id"]}
    owner.put(f"{trip.base}/public-projection", json=scope(item))
    family = trip.link(item, label="Family")
    trip.publish()

    (entry,) = records_of(trip.merge(trip.hotel, [trip.inn])).values()
    assert entry["visibility"] == "custom" and entry["custom_picks"] == 2
    # The hotel is everyone's, so both audiences that pick the stay gain it; hiding it hides it from both.
    assert [audience["label"] for audience in entry["widened_for"]] == [None, "Family"]
    assert entry["hides_from"] == []

    applied = trip.merge(trip.hotel, [trip.inn], confirm=True, make_private=[ref("stay", stay)])
    assert applied.status_code == 200, applied.text
    assert owner.get(f"{trip.base}/public-projection").json()["scope"]["items"] == []
    assert owner.get(f"{trip.base}/share-links/{family['id']}").json()["scope"]["items"] == []


def test_a_stale_or_unlisted_record_is_refused_and_nothing_changes() -> None:
    owner = client_for("owner-1")
    inn = Inn(owner)
    # A stay at the hotel is already shown with the hotel: the merge does not change what anyone sees of it.
    unrelated = inn.trip.stay(inn.trip.hotel)
    private = inn.trip.stay(inn.trip.inn, "private")

    for choice in (unrelated, private, {"id": "does-not-exist"}):
        for confirm in (False, True):
            refused = inn.merge(ref("stay", choice), confirm=confirm, confirm_widening=True)
            assert refused.status_code == 409, refused.text
            assert refused.json()["detail"] == {"code": STALE, "records": [ref("stay", choice)]}
            assert refused.json()["errors"][0]["code"] == STALE
    # The same id under another kind is a different record.
    assert inn.merge({"kind": "visit", "id": inn.first["id"]}).status_code == 409
    assert visibility_of(inn.trip, "stay", unrelated) == "everyone"
    assert inn.trip.events("location.merge") == [] and hidden(inn.trip) == []

    # The owner narrowed the audience after looking: the choice is stale and the merge asks again.
    share(owner, inn.trip.trip["id"], "stay", inn.first["id"], "private")
    stale = inn.merge(ref("stay", inn.first), confirm=True, confirm_widening=True)
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == STALE
    assert len(owner.get(f"{inn.trip.base}/locations").json()) == 2


def test_a_malformed_choice_is_a_validation_error() -> None:
    inn = Inn(client_for("owner-1"))
    for bad in ([{"kind": "location", "id": inn.trip.hotel["id"]}], [{"kind": "stay"}], ["stay"]):
        assert inn.merge(*bad).status_code == 422


def test_without_a_choice_the_merge_behaves_as_before() -> None:
    inn = Inn(client_for("owner-1"))
    assert inn.merge(confirm=True).status_code == 409
    assert inn.merge(confirm=True, confirm_widening=True).status_code == 200
    assert hidden(inn.trip) == []
    (event,) = inn.trip.events("location.merge")
    assert "made_private" not in event["details"]


def test_a_route_between_two_merged_duplicates_is_one_choice() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    second_inn = trip.location("Second Inn", 52.0, 4.0, "private")
    route = owner.post(
        f"{trip.base}/routes",
        json={
            "mode": "train",
            "departure_area_id": trip.area["id"],
            "arrival_area_id": trip.area["id"],
            "departure_location": {"existing_location_id": trip.inn["id"]},
            "arrival_location": {"existing_location_id": second_inn["id"]},
        },
    ).json()
    share(owner, trip.trip["id"], "route", route["id"], "everyone")
    trip.publish()

    preview = trip.merge(trip.hotel, [trip.inn, second_inn], make_private=[ref("route", route)])
    assert preview.status_code == 200, preview.text
    assert all(duplicate["widened"] == [] for duplicate in preview.json()["duplicates"])
    applied = trip.merge(trip.hotel, [trip.inn, second_inn], confirm=True, make_private=[ref("route", route)])
    assert applied.status_code == 200, applied.text
    assert visibility_of(trip, "route", route) == "private"
    assert len(hidden(trip)) == 1
    (event,) = trip.events("location.merge")
    assert event["details"]["made_private"] == [ref("route", route)]


# --- Areas ---------------------------------------------------------------------------


def area_records(areas: Areas, owner: TestClient) -> dict[str, dict]:
    base, trip_id = areas.trip.base, areas.trip.trip["id"]
    visit = owner.post(f"{base}/visits", json={"position": 0, "title": "Walk", "area_id": areas.duplicate["id"]}).json()
    update = owner.post(
        f"{base}/travel-updates",
        json={"occurred_at": "2054-11-01T10:00:00Z", "title": "Hi", "body": "Hi.", "area_id": areas.duplicate["id"]},
    ).json()
    hotel = owner.post(
        f"{base}/locations", json={"label": "Hotel", "display_name": "Hotel", "area_id": areas.duplicate["id"]}
    ).json()
    stay = areas.trip.stay(hotel)
    for kind, record in (("visit", visit), ("travel_update", update)):
        share(owner, trip_id, kind, record["id"], "everyone")
    areas.trip.publish()
    return {"visit": visit, "travel_update": update, "stay": stay}


def test_an_area_merge_takes_the_same_per_record_choice() -> None:
    owner = client_for("owner-1")
    areas = Areas(owner)
    made = area_records(areas, owner)

    listed = records_of(areas.merge())
    assert {kind for kind, _ in listed} == {"stay", "visit", "travel_update"}
    assert listed[("visit", made["visit"]["id"])]["label"] == "Walk"

    choice = [ref("visit", made["visit"]), ref("stay", made["stay"])]
    preview = areas.merge(make_private=choice)
    assert preview.json()["duplicates"][0]["widened"] == [
        {"audience": "public", "label": None, **ZEROES, "travel_updates": 1}
    ]
    refused = areas.merge(make_private=choice, confirm=True)
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == CODE
    assert visibility_of(areas.trip, "visit", made["visit"]) == "everyone"

    applied = areas.merge(make_private=choice, confirm=True, confirm_widening=True)
    assert applied.status_code == 200, applied.text
    assert visibility_of(areas.trip, "visit", made["visit"]) == "private"
    assert visibility_of(areas.trip, "stay", made["stay"]) == "private"
    assert visibility_of(areas.trip, "travel_update", made["travel_update"]) == "everyone"
    document = areas.trip.public()
    assert document["visits"] == [] and document["stays"] == []
    (event,) = areas.trip.events("area.merge")
    assert event["details"]["made_private"] == sorted(choice, key=lambda item: (item["kind"], item["id"]))
    assert event["details"]["merged"][0]["widened"] == [{"audience": "public", **ZEROES, "travel_updates": 1}]
    assert len(hidden(areas.trip)) == 2


def test_an_area_merge_refuses_a_record_the_preview_does_not_list() -> None:
    owner = client_for("owner-1")
    areas = Areas(owner)
    made = area_records(areas, owner)
    elsewhere = owner.post(
        f"{areas.trip.base}/visits", json={"position": 1, "title": "Kept", "area_id": areas.keep["id"]}
    ).json()
    share(owner, areas.trip.trip["id"], "visit", elsewhere["id"], "everyone")

    for confirm in (False, True):
        refused = areas.merge(make_private=[ref("visit", elsewhere), ref("visit", made["visit"])], confirm=confirm)
        assert refused.status_code == 409, refused.text
        assert refused.json()["detail"] == {"code": STALE, "records": [ref("visit", elsewhere)]}
    assert visibility_of(areas.trip, "visit", elsewhere) == "everyone"
    assert len(owner.get(f"{areas.trip.base}/areas").json()) == 3
    assert areas.trip.events("area.merge") == []
