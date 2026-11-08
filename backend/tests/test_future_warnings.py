"""The Sharing check flags future transport times and day-precision dates before a trip starts (#231).

Warning only: nothing is changed. Counts go into the warning, never a title, label or owner text.
"""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from test_publication import (  # noqa: F401
    activate,
    client_for,
    create_trip,
    engine,
    item,
    setup_function,
    share,
    teardown_function,
)

from app.models import Trip
from app.overview import future_counts, not_started, trip_overview
from app.routers.trips import trip_query

FUTURE_TRANSPORT = "future_transport_times"
FUTURE_DAY_DATES = "future_day_dates"
STARTS = "2054-04-01"
ENDS = "2054-04-20"
BEFORE_START = date(2054, 3, 1)


def _codes(overview: dict, audience_id: str | None = None) -> dict[str, int]:
    return {
        warning["code"]: warning["count"]
        for warning in overview["warnings"]
        if warning["code"] in (FUTURE_TRANSPORT, FUTURE_DAY_DATES) and warning["audience_id"] == audience_id
    }


def _overview(trip_id: str, today: date | None) -> dict:
    """The owner overview computed as of ``today`` (None: the real current UTC date)."""
    with Session(engine) as session:
        trip = session.scalar(trip_query().where(Trip.id == trip_id))
        return trip_overview(session, trip, today=today)


def _trip(owner: TestClient, starts_on: str | None = STARTS, ends_on: str | None = ENDS) -> dict:
    trip = create_trip(owner, title="Taiwan 2054 private title")
    fields = {"starts_on": starts_on, "ends_on": ends_on}
    response = owner.patch(f"/api/trips/{trip['id']}", json={k: v for k, v in fields.items() if v is not None})
    assert response.status_code == 200, response.text
    return trip


def _area(owner: TestClient, trip_id: str, label: str) -> str:
    response = owner.post(f"/api/trips/{trip_id}/areas", json={"label": label, "country_code": "TW"})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _route(owner: TestClient, trip_id: str, departs_on: str, *, timed: bool = True, **fields) -> dict:
    ams, tpe = _area(owner, trip_id, "Amsterdam"), _area(owner, trip_id, "Taoyuan")
    payload = {"mode": "flight", "departure_area_id": ams, "arrival_area_id": tpe, "departs_on": departs_on}
    if timed:
        payload.update(departs_at=f"{departs_on}T09:00:00Z", arrives_at=f"{departs_on}T23:00:00Z")
    payload.update(fields)
    response = owner.post(f"/api/trips/{trip_id}/routes", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _visit(owner: TestClient, trip_id: str, starts_on: str, **fields) -> dict:
    area = _area(owner, trip_id, "Taipei")
    response = owner.post(
        f"/api/trips/{trip_id}/visits", json={"area_id": area, "starts_on": starts_on, "ends_on": starts_on, **fields}
    )
    assert response.status_code == 201, response.text
    return response.json()


def _public_scope(owner: TestClient, trip_id: str, **scope) -> None:
    # ``defaults: None`` removes the cap; a new public view otherwise starts at month.
    response = owner.put(f"/api/trips/{trip_id}/public-projection", json={"defaults": None, **scope})
    assert response.status_code == 200, response.text


# --- when a trip counts as not started -------------------------------------------------------------------------


def test_a_trip_counts_as_not_started_only_before_its_start_and_never_after_its_end() -> None:
    owner = client_for("owner-1")
    trip = _trip(owner)
    with Session(engine) as session:
        loaded = session.scalar(trip_query().where(Trip.id == trip["id"]))
        assert not_started(loaded, date(2054, 3, 31)) is True
        assert not_started(loaded, date(2054, 4, 1)) is False  # the start day itself: started
        assert not_started(loaded, date(2054, 4, 21)) is False  # after the end: ended


def test_a_trip_without_a_start_is_not_started_only_when_a_route_departs_after_today() -> None:
    owner = client_for("owner-1")
    trip = _trip(owner, starts_on=None, ends_on=None)
    assert _codes(_overview(trip["id"], BEFORE_START)) == {}
    record = _route(owner, trip["id"], "2054-04-02", carrier="EVA Air")
    share(owner, trip["id"], "route", record["id"], "everyone")
    assert _codes(_overview(trip["id"], BEFORE_START), None) == {FUTURE_TRANSPORT: 1, FUTURE_DAY_DATES: 1}
    # Once that departure has passed, nothing is future any more.
    assert _codes(_overview(trip["id"], date(2054, 4, 3)), None) == {}


# --- future transport --------------------------------------------------------------------------------------


def test_a_timed_route_departing_today_or_later_warns_and_one_that_already_left_does_not() -> None:
    owner = client_for("owner-1")
    trip = _trip(owner)
    left = _route(owner, trip["id"], "2054-02-15")
    today_route = _route(owner, trip["id"], "2054-03-01")
    later = _route(owner, trip["id"], "2054-04-02")
    for record in (left, today_route, later):
        share(owner, trip["id"], "route", record["id"], "everyone")
    # Routes that left before today are not future; the other two are: a count of two, and their days too.
    assert _codes(_overview(trip["id"], BEFORE_START), None) == {FUTURE_TRANSPORT: 2, FUTURE_DAY_DATES: 2}


def test_a_route_only_the_owner_keeps_private_is_not_warned() -> None:
    owner = client_for("owner-1")
    trip = _trip(owner)
    _route(owner, trip["id"], "2054-04-02")  # private by default
    assert _codes(_overview(trip["id"], BEFORE_START), None) == {}


def test_a_route_with_a_carrier_but_no_time_counts_as_an_exact_schedule() -> None:
    owner = client_for("owner-1")
    trip = _trip(owner)
    record = _route(owner, trip["id"], "2054-04-02", timed=False, service_reference="EX101")
    share(owner, trip["id"], "route", record["id"], "everyone")
    assert _codes(_overview(trip["id"], BEFORE_START), None) == {FUTURE_TRANSPORT: 1, FUTURE_DAY_DATES: 1}


def test_a_route_with_neither_times_nor_a_carrier_is_not_transport_but_its_day_is_a_day_date() -> None:
    owner = client_for("owner-1")
    trip = _trip(owner)
    record = _route(owner, trip["id"], "2054-04-02", timed=False)
    share(owner, trip["id"], "route", record["id"], "everyone")
    # Its day is shown by day like a visit's (#262), so it counts there, and only there.
    assert _codes(_overview(trip["id"], BEFORE_START), None) == {FUTURE_DAY_DATES: 1}
    # A month cap shows it by month: nothing is shown by day any more.
    _public_scope(owner, trip["id"], defaults={"date_precision": "month"})
    assert _codes(_overview(trip["id"], BEFORE_START), None) == {}


# --- future day dates: the audience's cap and the record's own value ------------------------------------------


def test_day_dates_follow_the_coarser_of_the_record_and_the_audience() -> None:
    owner = client_for("owner-1")
    trip = _trip(owner)
    visit = _visit(owner, trip["id"], "2054-04-04")
    update = owner.post(
        f"/api/trips/{trip['id']}/travel-updates",
        json={
            "occurred_at": "2054-04-04T10:00:00Z",
            "date_precision": "day",
            "title": "Arrival",
            "body": "We landed.",
            "area_id": _area(owner, trip["id"], "Kaohsiung"),
        },
    ).json()
    share(owner, trip["id"], "visit", visit["id"], "everyone")
    share(owner, trip["id"], "travel_update", update["id"], "everyone")

    # Nothing set: the visit reads by month; the update is its own day.
    assert _codes(_overview(trip["id"], BEFORE_START), None) == {FUTURE_DAY_DATES: 1}

    # The visit's own day shows it by day too.
    owner.patch(f"/api/trips/{trip['id']}/visits/{visit['id']}", json={"share_date_precision": "day"})
    assert _codes(_overview(trip["id"], BEFORE_START), None) == {FUTURE_DAY_DATES: 2}

    # A public cap of month holds every date to month: nothing is shown by day.
    _public_scope(owner, trip["id"], defaults={"date_precision": "month"})
    assert _codes(_overview(trip["id"], BEFORE_START), None) == {}


def test_trip_dates_at_day_precision_count_as_one_record() -> None:
    owner = client_for("owner-1")
    trip = _trip(owner)
    _public_scope(owner, trip["id"], trip={"title": True, "summary": True, "dates": "day"})
    assert _codes(_overview(trip["id"], BEFORE_START), None) == {FUTURE_DAY_DATES: 1}
    _public_scope(owner, trip["id"], trip={"title": True, "summary": True, "dates": "month"})
    assert _codes(_overview(trip["id"], BEFORE_START), None) == {}


def test_a_past_visit_is_not_a_future_date_but_a_visit_spanning_today_is() -> None:
    owner = client_for("owner-1")
    trip = _trip(owner)
    past = _visit(owner, trip["id"], "2054-02-01", share_date_precision="day")
    spanning = owner.post(
        f"/api/trips/{trip['id']}/visits",
        json={
            "area_id": _area(owner, trip["id"], "Hualien"),
            "starts_on": "2054-02-28",
            "ends_on": "2054-03-02",
            "share_date_precision": "day",
        },
    ).json()
    for record in (past, spanning):
        share(owner, trip["id"], "visit", record["id"], "everyone")
    assert _codes(_overview(trip["id"], BEFORE_START), None) == {FUTURE_DAY_DATES: 1}


# --- when nothing is warned ----------------------------------------------------------------------------------


def test_nothing_is_warned_once_the_trip_has_started_or_ended() -> None:
    owner = client_for("owner-1")
    trip = _trip(owner)
    route = _route(owner, trip["id"], "2054-04-02")
    share(owner, trip["id"], "route", route["id"], "everyone")
    visit = _visit(owner, trip["id"], "2054-04-04", share_date_precision="day")
    share(owner, trip["id"], "visit", visit["id"], "everyone")

    assert _codes(_overview(trip["id"], BEFORE_START), None) != {}
    assert _codes(_overview(trip["id"], date(2054, 4, 1)), None) == {}  # the start day: started
    assert _codes(_overview(trip["id"], date(2054, 4, 10)), None) == {}  # underway
    assert _codes(_overview(trip["id"], date(2054, 4, 21)), None) == {}  # ended


def test_future_counts_are_zero_when_the_trip_started_even_with_a_day_precise_record() -> None:
    owner = client_for("owner-1")
    trip = _trip(owner, starts_on="2020-01-01", ends_on="2099-12-31")
    route = _route(owner, trip["id"], "2054-04-02")
    share(owner, trip["id"], "route", route["id"], "everyone")
    with Session(engine) as session:
        loaded = session.scalar(trip_query().where(Trip.id == trip["id"]))
        assert future_counts(
            loaded, {"routes": [], "visits": [], "stays": [], "updates": [], "dates": None}, BEFORE_START
        ) == {
            "transport": 0,
            "day_dates": 0,
        }


# --- drafts, active links, and the owner-only preview review -----------------------------------------------


def test_a_draft_and_an_active_link_each_get_their_own_warning() -> None:
    owner = client_for("owner-1")
    trip = _trip(owner)
    route = _route(owner, trip["id"], "2054-04-02")
    share(owner, trip["id"], "route", route["id"], "everyone")
    link = owner.post(
        f"/api/trips/{trip['id']}/share-links", json={"label": "Family", "scope": {"defaults": None}}
    ).json()
    assert link["state"] == "draft"

    # Drafts are reviewed too: the link is named by its id and label, and its state is draft.
    overview = owner.get(f"/api/trips/{trip['id']}/overview").json()
    draft = next(entry for entry in overview["audiences"] if entry["id"] == link["id"])
    assert draft["state"] == "draft" and draft["live"] is False
    assert _codes(overview, link["id"]) == {FUTURE_TRANSPORT: 1, FUTURE_DAY_DATES: 1}

    activate(owner, trip["id"], link["id"])
    overview = owner.get(f"/api/trips/{trip['id']}/overview").json()
    active = next(entry for entry in overview["audiences"] if entry["id"] == link["id"])
    assert active["state"] == "active" and active["live"] is True
    assert _codes(overview, link["id"]) == {FUTURE_TRANSPORT: 1, FUTURE_DAY_DATES: 1}
    warning = next(w for w in overview["warnings"] if w["audience_id"] == link["id"])
    assert warning["audience"] == "Family" and warning["severity"] == "warning"


def test_the_warning_payload_carries_counts_and_no_owner_text() -> None:
    owner = client_for("owner-1")
    trip = _trip(owner)
    route = _route(owner, trip["id"], "2054-04-02", label="Secret route label", carrier="EVA Air")
    share(owner, trip["id"], "route", route["id"], "everyone")
    visit = _visit(owner, trip["id"], "2054-04-04", title="Secret visit title", share_date_precision="day")
    share(owner, trip["id"], "visit", visit["id"], "everyone")

    overview = owner.get(f"/api/trips/{trip['id']}/overview").json()
    future = [w for w in overview["warnings"] if w["code"] in (FUTURE_TRANSPORT, FUTURE_DAY_DATES)]
    # The route's day and the visit's day each count as one dated record.
    assert {w["code"]: w["count"] for w in future} == {FUTURE_TRANSPORT: 1, FUTURE_DAY_DATES: 2}
    for warning in future:
        assert warning["text"] is None and warning["kind"] is None and warning["id"] is None
    serialised = str(future)
    for private in ("Secret", "Taiwan 2054 private title", "Amsterdam", "Taoyuan", "Taipei"):
        assert private not in serialised


def test_the_preview_review_counts_the_candidate_scope_not_the_saved_one() -> None:
    owner = client_for("owner-1")
    trip = _trip(owner)
    route = _route(owner, trip["id"], "2054-04-02", carrier="EVA Air")
    link = owner.post(
        f"/api/trips/{trip['id']}/share-links", json={"label": "Family", "scope": {"defaults": None}}
    ).json()
    assert _codes(owner.get(f"/api/trips/{trip['id']}/overview").json(), link["id"]) == {}

    candidate = {"items": [item("route", route["id"])]}
    # The route is private, so the candidate must list it as custom; the saved scope does not.
    share(owner, trip["id"], "route", route["id"], "custom")
    preview = owner.post(f"/api/trips/{trip['id']}/share-links/{link['id']}/future-disclosure", json=candidate)
    assert preview.status_code == 200, preview.text
    assert preview.json() == {"transport": 1, "day_dates": 1}
    # Still nothing saved: the overview of the saved link is unchanged.
    assert _codes(owner.get(f"/api/trips/{trip['id']}/overview").json(), link["id"]) == {}


def test_the_public_preview_review_counts_the_candidate_and_is_zero_once_started() -> None:
    owner = client_for("owner-1")
    trip = _trip(owner)
    route = _route(owner, trip["id"], "2054-04-02")
    share(owner, trip["id"], "route", route["id"], "everyone")
    # No cap: the route keeps its day and its times. A candidate without a setting would start at month.
    response = owner.post(
        f"/api/trips/{trip['id']}/public-projection/future-disclosure", json={"items": [], "defaults": None}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"transport": 1, "day_dates": 1}
    month = owner.post(
        f"/api/trips/{trip['id']}/public-projection/future-disclosure",
        json={"items": [], "defaults": {"date_precision": "month"}},
    )
    # By month the route shows no day and no time, so the candidate discloses nothing of its schedule.
    assert month.json() == {"transport": 0, "day_dates": 0}

    started = _trip(owner, starts_on="2020-01-01", ends_on="2099-12-31")
    started_route = _route(owner, started["id"], "2054-04-02")
    share(owner, started["id"], "route", started_route["id"], "everyone")
    response = owner.post(
        f"/api/trips/{started['id']}/public-projection/future-disclosure", json={"items": [], "defaults": None}
    )
    assert response.json() == {"transport": 0, "day_dates": 0}


def test_the_future_review_is_owner_only() -> None:
    owner = client_for("owner-1")
    trip = _trip(owner)
    stranger = client_for("stranger-9")
    response = stranger.post(f"/api/trips/{trip['id']}/public-projection/future-disclosure", json={"items": []})
    assert response.status_code == 404
