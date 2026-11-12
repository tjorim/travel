"""An update's day is its instant's calendar day in its area's zone (#357), the same on every surface."""

import json
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import Area, TravelUpdate
from app.routers.trips import owned_trip
from app.trip_pdf import PdfRequest, pdf_data
from app.update_day import local_day, update_day
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
    assert update_day(TravelUpdate(occurred_at=at(2054, 11, 19, 23, 0))) == date(2054, 11, 19)


def story(owner: TestClient, trip_id: str, area_id: str | None, occurred_at: str, title: str) -> dict:
    response = owner.post(
        f"/api/trips/{trip_id}/travel-updates",
        json={
            "occurred_at": occurred_at,
            "date_precision": "day",
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


def test_update_without_an_area_zone_keeps_its_utc_day():
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
