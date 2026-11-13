"""A route's departure day follows the audience's date setting, like every other date (#262).

A route has no setting of its own: the audience's ``defaults.date_precision`` alone decides, and an audience that
sets none keeps the full day a route has always shown. A day also gives away an exact time, so the times are
shared only to an audience that may read days.
"""

import json
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_publication import (  # noqa: F401
    activate,
    client_for,
    create_trip,
    engine,
    setup_function,
    share,
    teardown_function,
)

from app.main import app
from app.models import CollectionMember, Trip
from app.overview import trip_overview
from app.precision import precision_summary, route_precision
from app.projection import delivered, render_projection
from app.services.trips import trip_query
from app.storage import LocalObjectStorage, get_storage

LENGTH = {"day": 10, "month": 7, "year": 4}
BEFORE_START = date(2054, 3, 1)
CAPS = [None, "day", "month", "year"]
EARLY, LATE = "2054-04-02", "2054-04-27"


class Fixture:
    """A trip with a timed route on the 27th, an untimed one on the 2nd and an undated one, all shared with everyone."""

    def __init__(self, owner: TestClient) -> None:
        self.owner = owner
        self.trip = create_trip(owner)
        self.base = f"/api/trips/{self.trip['id']}"
        assert owner.patch(self.base, json={"starts_on": "2054-04-01", "ends_on": "2054-04-30"}).status_code == 200
        self.ams = self._area("Amsterdam")
        self.tpe = self._area("Taoyuan")
        self.late = self._route(LATE, timed=True, carrier="EVA Air", label="Late flight")
        self.early = self._route(EARLY, timed=False, label="Early train")
        self.undated = self._route(None, timed=False, label="Undated bus")
        for record in (self.late, self.early, self.undated):
            share(owner, self.trip["id"], "route", record["id"], "everyone")

    def _area(self, label: str) -> str:
        return self.owner.post(f"{self.base}/areas", json={"label": label, "country_code": "TW"}).json()["id"]

    def _route(self, departs_on: str | None, *, timed: bool, **fields) -> dict:
        payload = {"mode": "flight", "departure_area_id": self.ams, "arrival_area_id": self.tpe, **fields}
        if departs_on:
            payload["departs_on"] = departs_on
        if timed and departs_on:
            payload.update(departs_at=f"{departs_on}T09:00:00Z", arrives_at=f"{departs_on}T23:00:00Z")
        response = self.owner.post(f"{self.base}/routes", json=payload)
        assert response.status_code == 201, response.text
        return response.json()

    def scope(self, cap: str | None) -> dict:
        document: dict = {"trip": {"title": True, "summary": True}, "items": []}
        if cap is not None:
            document["defaults"] = {"date_precision": cap}
        return document

    def render(self, cap: str | None) -> dict:
        with Session(engine) as session:
            trip = session.scalar(trip_query().where(Trip.id == self.trip["id"]))
            return render_projection(trip, self.scope(cap), "travel/public-trip@1")


def _by_label(document: dict) -> dict[str, dict]:
    return {route["label"]: route for route in document["routes"]}


def _assert_route_precision(document: dict, cap: str | None) -> None:
    precision = cap or "day"
    routes = _by_label(document)
    late, early, undated = routes["Late flight"], routes["Early train"], routes["Undated bus"]
    assert late["departs_on"] == LATE[: LENGTH[precision]] and late["date_precision"] == precision
    assert early["departs_on"] == EARLY[: LENGTH[precision]] and early["date_precision"] == precision
    # An undated route shows no date at all.
    assert "departs_on" not in undated and "date_precision" not in undated
    # An exact instant would give the day away, so it is shared only where days are.
    for field in ("departs_at", "arrives_at", "departure_timezone", "arrival_timezone"):
        assert (field in late) is (precision == "day"), (cap, field)
    if precision != "day":
        # Nothing in the delivered route is finer than the audience allows.
        text = json.dumps(late)
        assert LATE not in text and "2054-04-2" not in text and "T09:00" not in text


# --- the rule ---------------------------------------------------------------------------------------------------


def test_a_route_reads_at_the_audience_cap_or_by_day_when_the_audience_sets_none() -> None:
    assert route_precision(None) == "day"
    assert route_precision({}) == "day"
    assert route_precision({"defaults": {"date_precision": "month"}}) == "month"
    assert route_precision("year") == "year"
    # A stored value this code does not know is read as the coarsest, never as no cap.
    assert route_precision({"defaults": {"date_precision": "decade"}}) == "year"


@pytest.mark.parametrize("cap", CAPS)
def test_the_projection_truncates_a_routes_day_to_the_audience_cap(cap: str | None) -> None:
    _assert_route_precision(Fixture(client_for("owner-1")).render(cap), cap)


def test_a_legacy_scope_without_a_cap_keeps_the_full_day_and_the_times() -> None:
    fixture = Fixture(client_for("owner-1"))
    for legacy in (
        {"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": []},
        {"trip": {"title": True, "summary": True}, "items": [], "defaults": {}},
        {"trip": {"title": True, "summary": True}, "items": [], "defaults": {"date_precision": None}},
    ):
        with Session(engine) as session:
            trip = session.scalar(trip_query().where(Trip.id == fixture.trip["id"]))
            document = render_projection(trip, legacy, "travel/public-trip@1")
        late = _by_label(document)["Late flight"]
        assert late["departs_on"] == LATE
        assert late["departs_at"] == "2054-04-27T09:00:00+00:00"
        assert _by_label(document)["Early train"]["departs_on"] == EARLY


# --- every way a document leaves the system ----------------------------------------------------------------------


@pytest.mark.parametrize("cap", CAPS)
def test_the_public_view_and_its_preview_deliver_the_same_capped_routes(cap: str | None) -> None:
    fixture = Fixture(client_for("owner-1"))
    owner = fixture.owner
    candidate = {"trip": {"title": True, "summary": True}, "defaults": {"date_precision": cap} if cap else None}
    preview = owner.post(f"{fixture.base}/public-projection/preview", json=candidate).json()
    assert owner.put(f"{fixture.base}/public-projection", json=candidate).status_code == 200
    slug = owner.post(f"{fixture.base}/public-projection/publish").json()["slug"]
    delivered_document = TestClient(app).get(f"/api/public/trips/{slug}").json()

    assert preview == delivered_document
    _assert_route_precision(delivered_document, cap)


@pytest.mark.parametrize("cap", CAPS)
def test_a_hidden_link_delivers_the_capped_routes(cap: str | None) -> None:
    fixture = Fixture(client_for("owner-1"))
    owner = fixture.owner
    created = owner.post(
        f"{fixture.base}/share-links",
        json={"label": "Friends", "scope": {"defaults": {"date_precision": cap} if cap else None}},
    ).json()
    token = activate(owner, fixture.trip["id"], created["id"])["token"]
    document = TestClient(app).get(f"/api/shared/{token}").json()
    _assert_route_precision(document, cap)
    assert owner.post(f"{fixture.base}/share-links/{created['id']}/preview").json() == document


@pytest.mark.parametrize("cap", CAPS)
def test_a_collection_member_delivers_the_capped_routes(cap: str | None, tmp_path: Path) -> None:
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    fixture = Fixture(client_for("owner-1"))
    owner = fixture.owner
    collection = owner.post("/api/collections", json={"label": "Family"}).json()
    with Session(engine) as session:
        session.add(
            CollectionMember(collection_id=collection["id"], trip_id=fixture.trip["id"], scope=fixture.scope(cap))
        )
        session.commit()
        member_id = session.scalar(select(CollectionMember.id))
    owner.post(f"/api/collections/{collection['id']}/activate", json={"expires_in_days": 30})
    token = owner.get(f"/api/collections/{collection['id']}").json()["token"]
    document = TestClient(app).get(f"/api/shared/{token}/trips/{member_id}").json()
    _assert_route_precision(document, cap)
    preview = owner.post(f"/api/collections/{collection['id']}/members/{member_id}/preview").json()
    assert preview == document


def test_a_new_hidden_link_and_a_new_collection_member_cap_routes_at_month_like_everything_else() -> None:
    fixture = Fixture(client_for("owner-1"))
    owner = fixture.owner
    created = owner.post(f"{fixture.base}/share-links", json={"label": "Friends"}).json()
    preview = owner.post(f"{fixture.base}/share-links/{created['id']}/preview").json()
    # Whatever the audience starts at, the routes it delivers are never finer than its own cap.
    cap = created["scope"]["defaults"]["date_precision"]
    assert cap == "month"
    _assert_route_precision(preview, cap)


# --- ordering ---------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("cap", CAPS)
def test_ordering_follows_the_stored_dates_like_visits_and_adds_no_finer_field(cap: str | None) -> None:
    fixture = Fixture(client_for("owner-1"))
    labels = [route["label"] for route in fixture.render(cap)["routes"]]
    # The same rule visits and stays use: the document keeps the stored order (by day, then time, undated last)...
    assert labels == ["Early train", "Late flight", "Undated bus"]
    # ...but offers no position, rank or sort key: the only dates in it are the capped ones.
    for route in fixture.render(cap)["routes"]:
        assert not {"position", "sort", "rank", "order"} & set(route)
    with Session(engine) as session:
        trip = session.scalar(trip_query().where(Trip.id == fixture.trip["id"]))
        assert [r.label for r in delivered(trip, fixture.scope(cap))["route"]] == labels


# --- the Sharing check ------------------------------------------------------------------------------------------


def _overview(fixture: Fixture, today: date = BEFORE_START) -> dict:
    with Session(engine) as session:
        trip = session.scalar(trip_query().where(Trip.id == fixture.trip["id"]))
        return trip_overview(session, trip, today=today)


def _publish(fixture: Fixture, cap: str | None) -> None:
    owner = fixture.owner
    assert (
        owner.put(
            f"{fixture.base}/public-projection", json={"defaults": {"date_precision": cap} if cap else None}
        ).status_code
        == 200
    )
    assert owner.post(f"{fixture.base}/public-projection/publish").status_code == 200


def _warnings(overview: dict, code: str) -> list[dict]:
    return [warning for warning in overview["warnings"] if warning["code"] == code]


@pytest.mark.parametrize("cap", [None, "day"])
def test_route_days_shown_by_day_are_warned_before_the_trip_starts_like_visit_and_stay_days(cap: str | None) -> None:
    fixture = Fixture(client_for("owner-1"))
    _publish(fixture, cap)
    overview = _overview(fixture)
    # Two dated routes show a day; the undated one shows none. Both count, with no title or label in the warning.
    (warning,) = _warnings(overview, "future_day_dates")
    assert warning["count"] == 2 and warning["text"] is None
    assert "Late flight" not in json.dumps(warning)
    # The exact time or carrier warning is unchanged: only the timed, carrier-bearing flight counts.
    (transport,) = _warnings(overview, "future_transport_times")
    assert transport["count"] == 1
    assert not _warnings(overview, "route_dates_follow_audience")


@pytest.mark.parametrize("cap", ["month", "year"])
def test_the_suggestion_matches_what_the_route_shows(cap: str) -> None:
    fixture = Fixture(client_for("owner-1"))
    _publish(fixture, "day")
    assert _warnings(_overview(fixture), "future_day_dates")[0]["count"] == 2
    suggestion = _warnings(_overview(fixture), "future_day_dates")[0]["message"]
    assert "to month" in suggestion

    # Following the suggestion (a month cap) leaves no route showing a day, so the warning goes.
    _publish(fixture, "month")
    month = _overview(fixture)
    assert not _warnings(month, "future_day_dates")
    assert [route["departs_on"] for route in fixture.render("month")["routes"] if "departs_on" in route] == [
        "2054-04",
        "2054-04",
    ]
    # The carrier is still delivered, so its warning stays; the times are gone with the day.
    (transport,) = _warnings(month, "future_transport_times")
    assert transport["count"] == 1
    # A coarser cap still counts a route by the part of its month or year that is ahead.
    _publish(fixture, cap)
    assert _warnings(_overview(fixture), "future_transport_times")[0]["count"] == 1
    assert not _warnings(_overview(fixture), "future_day_dates")


def test_a_month_shown_route_is_not_future_once_that_month_has_passed() -> None:
    fixture = Fixture(client_for("owner-1"))
    owner = fixture.owner
    owner.patch(fixture.base, json={"starts_on": "2054-06-01", "ends_on": "2054-06-20"})
    _publish(fixture, "month")
    assert _warnings(_overview(fixture, date(2054, 4, 30)), "future_transport_times")
    assert not _warnings(_overview(fixture, date(2054, 5, 1)), "future_transport_times")


@pytest.mark.parametrize("cap", ["month", "year"])
def test_the_sharing_check_calls_out_routes_that_follow_a_coarser_audience(cap: str) -> None:
    fixture = Fixture(client_for("owner-1"))
    _publish(fixture, cap)
    overview = _overview(fixture)
    (warning,) = _warnings(overview, "route_dates_follow_audience")
    assert warning["severity"] == "info" and warning["count"] == 2 and warning["text"] == cap
    public = overview["audiences"][0]
    assert public["record_precision"]["routes"] == {
        "by_precision": {cap: 2},
        "limited_by_record": 0,
        "default_applied": 0,
    }


def test_an_audience_with_no_dated_route_gets_no_route_note() -> None:
    fixture = Fixture(client_for("owner-1"))
    for route in (fixture.late, fixture.early):
        share(fixture.owner, fixture.trip["id"], "route", route["id"], "private")
    _publish(fixture, "month")
    assert not _warnings(_overview(fixture), "route_dates_follow_audience")


def test_precision_summary_counts_dated_routes_only() -> None:
    fixture = Fixture(client_for("owner-1"))
    with Session(engine) as session:
        trip = session.scalar(trip_query().where(Trip.id == fixture.trip["id"]))
        records = delivered(trip, fixture.scope(None))
        assert precision_summary(records, fixture.scope(None))["route"]["by_precision"] == {"day": 2}
        assert precision_summary(records, fixture.scope("year"))["route"]["by_precision"] == {"year": 2}
