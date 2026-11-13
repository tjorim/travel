"""An update's day is its instant's calendar day in its area's zone (#357), the same on every surface."""

import json
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import Area, TravelUpdate
from app.services.trips import owned_trip
from app.trip_pdf import PdfRequest, pdf_data
from app.update_day import ZoneSpan, at_wall_clock, fallback_zone, local_day, update_day, update_zone
from tests import test_publication as publication
from tests.test_publication import TestingSessionLocal, client_for, create_trip, item, scope


def setup_function():
    publication.setup_function()


def teardown_function():
    publication.teardown_function()


def at(*parts: int) -> datetime:
    return datetime(*parts, tzinfo=UTC)


@pytest.mark.parametrize(
    ("instant", "zone", "expected"),
    [
        # Shortly after local midnight in UTC+8, and shortly before it in UTC-8.
        (at(2054, 11, 19, 16, 30), "Asia/Taipei", date(2054, 11, 20)),
        (at(2054, 11, 19, 15, 59), "Asia/Taipei", date(2054, 11, 19)),
        (at(2054, 11, 20, 7, 30), "America/Los_Angeles", date(2054, 11, 19)),
        (at(2054, 11, 20, 8, 0), "America/Los_Angeles", date(2054, 11, 20)),
        # Daylight saving time moves the offset: PDT in July is UTC-7, not UTC-8.
        (at(2054, 7, 1, 6, 30), "America/Los_Angeles", date(2054, 6, 30)),
        (at(2054, 7, 1, 7, 0), "America/Los_Angeles", date(2054, 7, 1)),
        # No zone, or one this server cannot resolve: the instant's UTC date, never an error.
        (at(2054, 11, 19, 23, 0), None, date(2054, 11, 19)),
        (at(2054, 11, 19, 23, 0), "", date(2054, 11, 19)),
        (at(2054, 11, 19, 23, 0), "Not/AZone", date(2054, 11, 19)),
        (at(2054, 11, 19, 23, 0), "../etc", date(2054, 11, 19)),
        # SQLite returns stored instants without an offset: they are UTC.
        (datetime(2054, 11, 19, 23, 0), "Asia/Taipei", date(2054, 11, 20)),
    ],
)
def test_local_day(instant, zone, expected):
    assert local_day(instant, zone) == expected


def test_update_day_uses_the_chosen_area_and_falls_back_without_one():
    update = TravelUpdate(occurred_at=at(2054, 11, 19, 23, 0), chosen_area=Area(timezone="America/Los_Angeles"))
    assert update_day(update) == date(2054, 11, 19)
    update.chosen_area = Area(timezone="Asia/Taipei")
    assert update_day(update) == date(2054, 11, 20)
    # Nothing to read a zone from at all: the instant's UTC day, named as such.
    assert update_day(TravelUpdate(occurred_at=at(2054, 11, 19, 23, 0))) == date(2054, 11, 19)
    assert update_zone(TravelUpdate(occurred_at=at(2054, 11, 19, 23, 0))) == "UTC"


def test_the_fallback_zone_is_the_nearest_dated_stay_or_visit_with_a_zone():
    taipei = ZoneSpan(date(2054, 11, 18), date(2054, 11, 21), "Asia/Taipei")
    la = ZoneSpan(date(2054, 11, 25), date(2054, 11, 27), "America/Los_Angeles")
    spans = (la, taipei)
    # A span that covers the UTC day wins; otherwise the closest by days; a tie goes to the earlier span.
    assert fallback_zone(at(2054, 11, 19, 12), spans) == "Asia/Taipei"
    assert fallback_zone(at(2054, 11, 26, 3), spans) == "America/Los_Angeles"
    assert fallback_zone(at(2054, 11, 22, 12), spans) == "Asia/Taipei"
    assert fallback_zone(at(2054, 11, 24, 12), spans) == "America/Los_Angeles"
    assert fallback_zone(
        at(2054, 11, 23, 12), (taipei, ZoneSpan(date(2054, 11, 25), date(2054, 11, 26), "Asia/Tokyo"))
    ) == ("Asia/Taipei")
    assert fallback_zone(at(2054, 11, 19, 12), ()) is None


@pytest.mark.parametrize(
    ("wall_clock", "zone", "expected"),
    [
        (datetime(2054, 11, 20, 7, 0), "Asia/Taipei", at(2054, 11, 19, 23, 0)),
        (datetime(2054, 11, 19, 23, 30), "America/Los_Angeles", at(2054, 11, 20, 7, 30)),
        (datetime(2054, 7, 1, 0, 30), "America/Los_Angeles", at(2054, 7, 1, 7, 30)),
        (datetime(2054, 11, 20, 7, 0), "UTC", at(2054, 11, 20, 7, 0)),
    ],
)
def test_a_wall_clock_is_read_in_the_zone(wall_clock, zone, expected):
    assert at_wall_clock(wall_clock, zone) == expected


def story(owner: TestClient, trip_id: str, area_id: str | None, occurred_at: str, title: str) -> dict:
    response = owner.post(
        f"/api/trips/{trip_id}/travel-updates",
        json={
            "occurred_at": occurred_at,
            "share_date_precision": "day",
            "title": title,
            "body": f"A safe note about {title}.",
            "area_id": area_id,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def publish(owner: TestClient, trip_id: str, *records: tuple[str, dict]) -> tuple[str, dict]:
    """Share the records at day precision, with the days figure; return the slug and the visitor document."""
    root = f"/api/trips/{trip_id}"
    items = []
    for kind, record in records:
        assert owner.put(f"{root}/visibility/{kind}/{record['id']}", json={"visibility": "custom"}).status_code == 200
        items.append(item(kind, record["id"]))
    shared = {**scope(*items), "defaults": {"date_precision": "day"}, "numbers": ["days"]}
    assert owner.put(f"{root}/public-projection", json=shared).status_code == 200
    slug = owner.post(f"{root}/public-projection/publish").json()["slug"]
    return slug, TestClient(app).get(f"/api/public/trips/{slug}").json()


def area(owner: TestClient, trip_id: str, label: str, zone: str | None) -> dict:
    response = owner.post(f"/api/trips/{trip_id}/areas", json={"label": label, "timezone": zone})
    assert response.status_code == 201, response.text
    return response.json()


def test_east_of_utc_update_keeps_its_local_day_on_every_surface():
    owner = client_for("owner-1")
    trip = create_trip(owner)
    taipei = area(owner, trip["id"], "Taipei", "Asia/Taipei")
    # 20 November 07:00 in Taipei, then 22 November: two days later, not three.
    first = story(owner, trip["id"], taipei["id"], "2054-11-19T23:00:00Z", "Breakfast at dawn")
    second = story(owner, trip["id"], taipei["id"], "2054-11-22T10:00:00Z", "Night market")
    _, document = publish(owner, trip["id"], ("area", taipei), ("travel_update", first), ("travel_update", second))

    dates = [entry["story_date"] for entry in document["updates"]]
    assert dates == ["2054-11-20", "2054-11-22"]
    assert (date.fromisoformat(dates[1]) - date.fromisoformat(dates[0])).days == 2
    assert document["numbers"] == {"days": 2}

    # The owner's list carries the instant and the area's zone, which give the same days.
    listed = owner.get(f"/api/trips/{trip['id']}/travel-updates").json()
    owner_days = [
        str(local_day(datetime.fromisoformat(entry["occurred_at"]), entry["area"]["timezone"])) for entry in listed
    ]
    assert sorted(owner_days) == dates

    with TestingSessionLocal() as session:
        row = owned_trip(session, trip["id"], "owner-1", load_relations=True)
        # The audience PDF renders the projection itself; the owner's PDF names the same days.
        audience, _ = pdf_data(
            session, row, PdfRequest(content="story", view="audience", locale="en", audience="public")
        )
        assert [entry["story_date"] for entry in audience["updates"]] == dates
        private, _ = pdf_data(
            session, row, PdfRequest(content="story", view="private", locale="en", confirm_private=True)
        )
        assert [entry["story_date"] for entry in private["updates"]] == [date(2054, 11, 20), date(2054, 11, 22)]

    exported = json.loads(owner.get(f"/api/trips/{trip['id']}/export").text)
    assert [entry["local_date"] for entry in exported["travel_updates"]] == dates


def test_west_of_utc_update_keeps_its_local_day():
    owner = client_for("owner-1")
    trip = create_trip(owner)
    la = area(owner, trip["id"], "Los Angeles", "America/Los_Angeles")
    # 19 November 23:30 in Los Angeles is already 20 November in UTC.
    late = story(owner, trip["id"], la["id"], "2054-11-20T07:30:00Z", "Late dinner")
    next_day = story(owner, trip["id"], la["id"], "2054-11-21T18:00:00Z", "Pier")
    _, document = publish(owner, trip["id"], ("area", la), ("travel_update", late), ("travel_update", next_day))
    assert [entry["story_date"] for entry in document["updates"]] == ["2054-11-19", "2054-11-21"]
    assert document["numbers"] == {"days": 2}


def test_update_in_a_trip_without_any_zone_keeps_its_utc_day():
    owner = client_for("owner-1")
    trip = create_trip(owner)
    unzoned = area(owner, trip["id"], "Somewhere", None)
    update = story(owner, trip["id"], unzoned["id"], "2054-11-19T23:00:00Z", "Unzoned")
    loose = story(owner, trip["id"], None, "2054-11-19T23:30:00Z", "No area")
    _, document = publish(owner, trip["id"], ("area", unzoned), ("travel_update", update), ("travel_update", loose))
    assert [entry["story_date"] for entry in document["updates"]] == ["2054-11-19", "2054-11-19"]
    assert document["numbers"] == {"days": 1}


def test_editing_an_areas_zone_moves_its_updates_days_and_a_bad_stored_zone_falls_back():
    owner = client_for("owner-1")
    trip = create_trip(owner)
    place = area(owner, trip["id"], "Taipei", None)
    update = story(owner, trip["id"], place["id"], "2054-11-19T23:00:00Z", "Breakfast")
    slug, document = publish(owner, trip["id"], ("area", place), ("travel_update", update))
    assert document["updates"][0]["story_date"] == "2054-11-19"
    root = f"/api/trips/{trip['id']}"
    assert owner.patch(f"{root}/areas/{place['id']}", json={"timezone": "Asia/Taipei"}).status_code == 200
    assert TestClient(app).get(f"/api/public/trips/{slug}").json()["updates"][0]["story_date"] == "2054-11-20"
    # A name written outside the API (an old row, a zone database that lost it) never breaks the document.
    with TestingSessionLocal() as session:
        session.scalar(select(Area).where(Area.id == place["id"])).timezone = "Not/AZone"
        session.commit()
    visited = TestClient(app).get(f"/api/public/trips/{slug}")
    assert visited.status_code == 200
    assert visited.json()["updates"][0]["story_date"] == "2054-11-19"


def stay(owner: TestClient, trip_id: str, zoned_area: dict, check_in: str, check_out: str) -> dict:
    response = owner.post(
        f"/api/trips/{trip_id}/stays",
        json={"area_id": zoned_area["id"], "check_in_date": check_in, "check_out_date": check_out},
    )
    assert response.status_code == 201, response.text
    return response.json()


def visit(owner: TestClient, trip_id: str, zoned_area: dict, starts_on: str, ends_on: str | None = None) -> dict:
    response = owner.post(
        f"/api/trips/{trip_id}/visits",
        json={"area_id": zoned_area["id"], "title": "Somewhere", "starts_on": starts_on, "ends_on": ends_on},
    )
    assert response.status_code == 201, response.text
    return response.json()


def every_surface_day(owner: TestClient, trip_id: str, records: list[dict]) -> list[str]:
    """The day of each update on the visitor story, the owner's list, the export and both PDFs: they must agree."""
    _, document = publish(owner, trip_id, *[("travel_update", record) for record in records])
    days = [entry["story_date"] for entry in document["updates"]]
    listed = owner.get(f"/api/trips/{trip_id}/travel-updates").json()
    assert [entry["local_date"] for entry in listed] == days
    assert [str(local_day(datetime.fromisoformat(entry["occurred_at"]), entry["timezone"])) for entry in listed] == days
    exported = json.loads(owner.get(f"/api/trips/{trip_id}/export").text)
    assert [entry["local_date"] for entry in exported["travel_updates"]] == days
    assert [entry["timezone"] for entry in exported["travel_updates"]] == [entry["timezone"] for entry in listed]
    with TestingSessionLocal() as session:
        row = owned_trip(session, trip_id, "owner-1", load_relations=True)
        audience, _ = pdf_data(
            session, row, PdfRequest(content="story", view="audience", locale="en", audience="public")
        )
        assert [entry["story_date"] for entry in audience["updates"]] == days
        private, _ = pdf_data(
            session, row, PdfRequest(content="story", view="private", locale="en", confirm_private=True)
        )
        assert [str(entry["story_date"]) for entry in private["updates"]] == days
    return days


@pytest.mark.parametrize(
    ("zone", "instants", "expected"),
    [
        # Just either side of local midnight in UTC+8 and in UTC-8, for an update with no area at all.
        (
            "Asia/Taipei",
            ["2054-11-19T15:59:00Z", "2054-11-19T16:00:00Z", "2054-11-20T15:59:00Z"],
            ["2054-11-19", "2054-11-20", "2054-11-20"],
        ),
        (
            "America/Los_Angeles",
            ["2054-11-20T07:59:00Z", "2054-11-20T08:00:00Z", "2054-11-21T07:59:00Z"],
            ["2054-11-19", "2054-11-20", "2054-11-20"],
        ),
    ],
)
@pytest.mark.parametrize("anchor", ["stay", "visit"])
def test_an_update_without_an_area_reads_the_zone_of_the_nearest_stay_or_visit(zone, instants, expected, anchor):
    owner = client_for("owner-1")
    trip = create_trip(owner)
    place = area(owner, trip["id"], "Elsewhere", zone)
    if anchor == "stay":
        stay(owner, trip["id"], place, "2054-11-18", "2054-11-23")
    else:
        visit(owner, trip["id"], place, "2054-11-18", "2054-11-22")
    updates = [story(owner, trip["id"], None, instant, f"No area {index}") for index, instant in enumerate(instants)]
    assert every_surface_day(owner, trip["id"], updates) == expected
    assert {entry["timezone"] for entry in owner.get(f"/api/trips/{trip['id']}/travel-updates").json()} == {zone}


def test_an_area_without_a_zone_falls_back_like_no_area_and_an_area_zone_wins():
    owner = client_for("owner-1")
    trip = create_trip(owner)
    unzoned = area(owner, trip["id"], "Somewhere", None)
    taipei = area(owner, trip["id"], "Taipei", "Asia/Taipei")
    stay(owner, trip["id"], taipei, "2054-11-18", "2054-11-23")
    la = area(owner, trip["id"], "Los Angeles", "America/Los_Angeles")
    updates = [
        story(owner, trip["id"], unzoned["id"], "2054-11-19T23:00:00Z", "Unzoned area"),  # Taipei: the 20th
        story(owner, trip["id"], None, "2054-11-19T23:30:00Z", "No area"),  # Taipei: the 20th
        story(owner, trip["id"], la["id"], "2054-11-20T07:30:00Z", "Its own zone"),  # Los Angeles: the 19th
    ]
    assert every_surface_day(owner, trip["id"], updates) == ["2054-11-20", "2054-11-20", "2054-11-19"]
    zones = [entry["timezone"] for entry in owner.get(f"/api/trips/{trip['id']}/travel-updates").json()]
    assert zones == ["Asia/Taipei", "Asia/Taipei", "America/Los_Angeles"]


def test_the_nearest_stay_or_visit_decides_when_none_covers_the_day():
    owner = client_for("owner-1")
    trip = create_trip(owner)
    taipei = area(owner, trip["id"], "Taipei", "Asia/Taipei")
    la = area(owner, trip["id"], "Los Angeles", "America/Los_Angeles")
    stay(owner, trip["id"], taipei, "2054-11-10", "2054-11-12")  # nights of the 10th and 11th
    visit(owner, trip["id"], la, "2054-11-20", "2054-11-22")
    early = story(owner, trip["id"], None, "2054-11-12T23:00:00Z", "After Taipei")
    late = story(owner, trip["id"], None, "2054-11-18T23:00:00Z", "Before Los Angeles")
    zones = [entry["timezone"] for entry in owner.get(f"/api/trips/{trip['id']}/travel-updates").json()]
    assert zones == ["Asia/Taipei", "America/Los_Angeles"]
    assert every_surface_day(owner, trip["id"], [early, late]) == ["2054-11-13", "2054-11-18"]


def test_a_wall_clock_without_an_offset_is_read_in_the_updates_zone_and_round_trips():
    owner = client_for("owner-1")
    trip = create_trip(owner)
    root = f"/api/trips/{trip['id']}/travel-updates"
    taipei = area(owner, trip["id"], "Taipei", "Asia/Taipei")
    la = area(owner, trip["id"], "Los Angeles", "America/Los_Angeles")
    plain = area(owner, trip["id"], "Plain", None)
    stay(owner, trip["id"], la, "2054-11-18", "2054-11-23")

    east = story(owner, trip["id"], taipei["id"], "2054-11-20T07:00", "East")
    assert east["occurred_at"].startswith("2054-11-19T23:00:00") and east["timezone"] == "Asia/Taipei"
    assert east["local_date"] == "2054-11-20"
    west = story(owner, trip["id"], la["id"], "2054-11-19T23:30", "West")
    assert west["occurred_at"].startswith("2054-11-20T07:30:00") and west["local_date"] == "2054-11-19"
    # No usable area zone: the trip's nearest stay, in Los Angeles.
    loose = story(owner, trip["id"], plain["id"], "2054-11-19T23:30", "Loose")
    assert loose["occurred_at"].startswith("2054-11-20T07:30:00") and loose["timezone"] == "America/Los_Angeles"
    # An instant with an offset is kept as written.
    exact = story(owner, trip["id"], taipei["id"], "2054-11-20T07:00:00+08:00", "Exact")
    assert exact["occurred_at"].startswith("2054-11-19T23:00:00")

    # Reading the time back in the update's zone gives the typed wall clock; saving that again changes nothing.
    listed = {entry["title"]: entry for entry in owner.get(root).json()}
    for entry, typed in ((listed["East"], "2054-11-20T07:00"), (listed["West"], "2054-11-19T23:30")):
        read = datetime.fromisoformat(entry["occurred_at"]).replace(tzinfo=UTC).astimezone(ZoneInfo(entry["timezone"]))
        assert read.strftime("%Y-%m-%dT%H:%M") == typed
        saved = owner.patch(f"{root}/{entry['id']}", json={"occurred_at": typed})
        assert saved.status_code == 200 and saved.json()["occurred_at"] == entry["occurred_at"]

    # Typing a time while moving the update to another area reads it in the new area's zone.
    moved = owner.patch(f"{root}/{east['id']}", json={"area_id": la["id"], "occurred_at": "2054-11-20T07:00"})
    assert moved.status_code == 200, moved.text
    assert moved.json()["timezone"] == "America/Los_Angeles"
    assert moved.json()["occurred_at"].startswith("2054-11-20T15:00:00")
    assert moved.json()["local_date"] == "2054-11-20"


def test_the_retired_date_precision_key_is_read_as_share_date_precision_for_one_release():
    owner = client_for("owner-1")
    trip = create_trip(owner)
    root = f"/api/trips/{trip['id']}/travel-updates"
    base = {"occurred_at": "2054-11-19T10:00:00Z", "title": "Old client", "body": "A safe note."}
    created = owner.post(root, json={**base, "date_precision": "month"})
    assert created.status_code == 201, created.text
    assert created.json()["share_date_precision"] == "month" and "date_precision" not in created.json()
    update_url = f"{root}/{created.json()['id']}"
    patched = owner.patch(update_url, json={"date_precision": "year"})
    assert patched.status_code == 200 and patched.json()["share_date_precision"] == "year"
    same = owner.patch(update_url, json={"date_precision": "day", "share_date_precision": "day"})
    assert same.status_code == 200 and same.json()["share_date_precision"] == "day"
    conflicting = owner.post(root, json={**base, "date_precision": "month", "share_date_precision": "day"})
    assert conflicting.status_code == 422
    assert owner.post(root, json={**base, "no_such_field": 1}).status_code == 422
