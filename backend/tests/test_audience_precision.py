"""Date precision is set per audience, with a per-record override; the coarser value always wins (#236)."""

import itertools
import json

import pytest
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

from app.models import (
    AuditEvent,
    AuditEventKind,
    DatePrecision,
    PublicSurface,
    ShareLink,
    Stay,
    Trip,
    Visit,
)
from app.precision import DEFAULT_PRECISION, audience_precision, coarser, effective_precision, is_finer
from app.projection import render_projection
from app.routers.trips import trip_query

PRECISIONS = ("day", "month", "year")
LENGTH = {"day": 10, "month": 7, "year": 4}
RANK = {"day": 0, "month": 1, "year": 2}
CODE = "precision_widening_needs_acknowledgement"


# --- the rule itself -----------------------------------------------------------------------------------------


@pytest.mark.parametrize("own", [None, *PRECISIONS])
@pytest.mark.parametrize("cap", [None, *PRECISIONS])
def test_the_coarser_of_the_record_and_the_audience_wins(own: str | None, cap: str | None) -> None:
    set_values = [value for value in (own, cap) if value is not None]
    expected = max(set_values, key=RANK.__getitem__) if set_values else DEFAULT_PRECISION

    assert effective_precision(own, cap) == expected
    assert effective_precision(own, {"defaults": {"date_precision": cap}} if cap else {}) == expected
    # Never finer than either side allows.
    for allowed in set_values:
        assert not is_finer(expected, allowed)
    assert not is_finer(expected, DEFAULT_PRECISION) or set_values


def test_neither_set_reads_by_month_and_an_unknown_stored_value_by_year() -> None:
    assert effective_precision(None, None) == "month"
    assert effective_precision(None, {}) == "month"
    assert effective_precision("day", None) == "day"
    assert audience_precision({"defaults": {"date_precision": "decade"}}) == "year"
    assert audience_precision({"defaults": "garbage"}) is None
    assert audience_precision({"defaults": {"date_precision": None}}) is None
    assert coarser(None, None) is None and coarser("day", None, "month") == "month"


# --- the projection ------------------------------------------------------------------------------------------


class Fixture:
    """A trip with trip dates, a timed visit, a stay and an update, every record shared with everyone."""

    def __init__(self, owner: TestClient) -> None:
        self.owner = owner
        self.trip = create_trip(owner)
        self.base = f"/api/trips/{self.trip['id']}"
        assert owner.patch(self.base, json={"starts_on": "2054-04-01", "ends_on": "2054-04-20"}).status_code == 200, (
            "trip dates"
        )
        area = owner.post(f"{self.base}/areas", json={"label": "Taipei", "country_code": "TW"}).json()
        self.visit = owner.post(
            f"{self.base}/visits",
            json={
                "area_id": area["id"],
                "title": "Night market",
                "starts_on": "2054-04-04",
                "ends_on": "2054-04-06",
                "start_time": "18:30",
                "share_time": True,
            },
        ).json()
        self.stay = owner.post(
            f"{self.base}/stays",
            json={"area_id": area["id"], "check_in_date": "2054-04-01", "check_out_date": "2054-04-05"},
        ).json()
        self.update = owner.post(
            f"{self.base}/travel-updates",
            json={
                "occurred_at": "2054-04-04T10:00:00Z",
                "date_precision": "day",
                "title": "Arrival",
                "body": "We landed.",
                "area_id": area["id"],
            },
        ).json()
        for kind, record in (("visit", self.visit), ("stay", self.stay), ("travel_update", self.update)):
            share(owner, self.trip["id"], kind, record["id"], "everyone")

    def set_own(self, precision: str | None) -> None:
        for kind, record in (("visits", self.visit), ("stays", self.stay)):
            response = self.owner.patch(f"{self.base}/{kind}/{record['id']}", json={"share_date_precision": precision})
            assert response.status_code == 200, response.text

    def render(self, audience: dict | None, *, trip_dates: str | None = "day") -> dict:
        """The projection one audience would receive; ``audience`` is its ``defaults`` (None: the key is absent)."""
        document = {"trip": {"title": True, "summary": True, "dates": trip_dates}, "items": []}
        if audience is not None:
            document["defaults"] = audience
        with Session(engine) as session:
            trip = session.scalar(trip_query().where(Trip.id == self.trip["id"]))
            return render_projection(trip, document, "travel/public-trip@1")


def _dates(document: dict) -> dict:
    (visit,) = document["visits"]
    (stay,) = document["stays"]
    (update,) = document["updates"]
    return {
        "visit": (visit["starts_on"], visit["ends_on"], visit["date_precision"], "start_time" in visit),
        "stay": (stay["starts_on"], stay["ends_on"], stay["date_precision"]),
        "update": (update["story_date"], update["date_precision"]),
        "trip": (document["dates"] or {}).get("starts_on"),
    }


@pytest.mark.parametrize("own", [None, *PRECISIONS])
@pytest.mark.parametrize("cap", [None, *PRECISIONS])
def test_every_record_and_audience_combination_reads_by_the_coarser_precision(own: str | None, cap: str | None) -> None:
    fixture = Fixture(client_for("owner-1"))
    fixture.set_own(own)
    document = fixture.render({"date_precision": cap} if cap else {})

    precision = effective_precision(own, cap)
    year, month, day = "2054", "2054-04", None
    visit_start = {"day": "2054-04-04", "month": month, "year": year}[precision]
    stay_start = {"day": "2054-04-01", "month": month, "year": year}[precision]
    visit_end = {"day": "2054-04-06", "month": month, "year": year}[precision]
    stay_end = {"day": "2054-04-05", "month": month, "year": year}[precision]
    assert day is None
    assert _dates(document)["visit"][:3] == (visit_start, visit_end, precision)
    assert _dates(document)["stay"] == (stay_start, stay_end, precision)
    # A time only means something on a full date, so a coarser precision hides it.
    assert _dates(document)["visit"][3] is (precision == "day")
    # An update has its own day precision; only the audience can make it coarser.
    update_precision = coarser("day", cap) or "day"
    assert document["updates"][0]["date_precision"] == update_precision
    assert document["updates"][0]["story_date"] == "2054-04-04"[: LENGTH[update_precision]]
    # The trip dates are chosen in the scope (day here) and capped by the audience.
    assert document["dates"]["date_precision"] == (coarser("day", cap) or "day")


@pytest.mark.parametrize("trip_dates", [None, *PRECISIONS])
def test_a_visitor_never_receives_a_finer_date_than_the_record_the_audience_or_the_scope_allows(
    trip_dates: str | None,
) -> None:
    fixture = Fixture(client_for("owner-1"))
    for own, cap in itertools.product([None, *PRECISIONS], [None, *PRECISIONS]):
        fixture.set_own(own)
        document = fixture.render({"date_precision": cap} if cap else {}, trip_dates=trip_dates)
        allowed = [value for value in (own, cap) if value is not None] or [DEFAULT_PRECISION]
        limit = min(LENGTH[value] for value in allowed)
        for entry in (*document["visits"], *document["stays"]):
            for field in ("starts_on", "ends_on"):
                assert len(entry[field]) <= limit, (own, cap, entry)
            assert LENGTH[entry["date_precision"]] <= limit
        update_limit = min([LENGTH["day"], *(LENGTH[value] for value in [cap] if value)])
        assert len(document["updates"][0]["story_date"]) <= update_limit
        if trip_dates is None:
            assert document["dates"] is None
        else:
            trip_limit = min(LENGTH[value] for value in (trip_dates, cap) if value)
            assert len(document["dates"]["starts_on"]) <= trip_limit
            assert len(document["dates"]["ends_on"]) <= trip_limit
        # No exact time without a full date.
        if limit < LENGTH["day"]:
            assert all("start_time" not in visit for visit in document["visits"])


# --- setting it on an audience -------------------------------------------------------------------------------


def _public(owner: TestClient, base: str) -> dict:
    return owner.get(f"{base}/public-projection").json()


def test_a_new_public_view_and_a_new_link_read_dates_by_month_until_the_owner_chooses() -> None:
    owner = client_for("owner-1")
    fixture = Fixture(owner)

    assert _public(owner, fixture.base)["scope"]["defaults"] == {"date_precision": "month"}
    link = owner.post(f"{fixture.base}/share-links", json={"label": "Family"}).json()
    assert link["scope"]["defaults"] == {"date_precision": "month"}

    # Saying nothing about it keeps the setting; the choice to remove it is explicit.
    assert owner.put(f"{fixture.base}/public-projection", json={"trip": {"title": True}}).status_code == 200
    assert _public(owner, fixture.base)["scope"]["defaults"] == {"date_precision": "month"}
    saved = owner.put(f"{fixture.base}/public-projection", json={"defaults": {"date_precision": "day"}}).json()
    assert saved["scope"]["defaults"] == {"date_precision": "day"}
    assert (
        owner.put(f"{fixture.base}/public-projection", json={"defaults": None}).json()["scope"].get("defaults") is None
    )
    created = owner.post(f"{fixture.base}/share-links", json={"label": "Open", "scope": {"defaults": None}}).json()
    assert "defaults" not in created["scope"]
    explicit = owner.post(
        f"{fixture.base}/share-links", json={"label": "Days", "scope": {"defaults": {"date_precision": "day"}}}
    ).json()
    assert explicit["scope"]["defaults"] == {"date_precision": "day"}


def test_an_older_client_that_does_not_send_the_setting_cannot_widen_an_audience() -> None:
    owner = client_for("owner-1")
    fixture = Fixture(owner)
    link = owner.post(
        f"{fixture.base}/share-links", json={"label": "Family", "scope": {"defaults": {"date_precision": "year"}}}
    ).json()

    # Patching with a scope that has no ``defaults`` (an app or script from before this setting) keeps the cap.
    updated = owner.patch(
        f"{fixture.base}/share-links/{link['id']}",
        json={
            "scope": {"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": []}
        },
    ).json()
    assert updated["scope"]["defaults"] == {"date_precision": "year"}
    # A preview of such a candidate renders with the stored setting too.
    preview = owner.post(f"{fixture.base}/share-links/{link['id']}/preview", json={"trip": {"dates": "day"}}).json()
    assert preview["dates"]["date_precision"] == "year"
    assert json.loads(
        json.dumps(owner.get(f"{fixture.base}/share-links/{link['id']}").json()["scope"]["defaults"])
    ) == {"date_precision": "year"}


def test_the_preview_and_the_delivery_show_the_same_effective_precision() -> None:
    owner = client_for("owner-1")
    fixture = Fixture(owner)
    fixture.set_own("day")
    candidate = {"trip": {"title": True, "summary": True, "dates": "day"}, "defaults": {"date_precision": "month"}}

    preview = owner.post(f"{fixture.base}/public-projection/preview", json=candidate).json()
    owner.put(f"{fixture.base}/public-projection", json=candidate)
    slug = owner.post(f"{fixture.base}/public-projection/publish").json()["slug"]
    delivered = TestClient(client_for("owner-1").app).get(f"/api/public/trips/{slug}").json()

    assert preview == delivered
    assert delivered["visits"][0]["starts_on"] == "2054-04"
    assert delivered["dates"]["date_precision"] == "month"
    # The saved scope previews the same as the candidate that was saved.
    assert owner.post(f"{fixture.base}/public-projection/preview").json() == delivered


def test_a_collection_member_starts_at_month_and_honours_its_setting() -> None:
    owner = client_for("owner-1")
    fixture = Fixture(owner)
    collection = owner.post("/api/collections", json={"label": "Everything"}).json()
    added = owner.post(f"/api/collections/{collection['id']}/members", json={"trip_id": fixture.trip["id"]}).json()
    member = added["members"][0]
    assert member["scope"]["defaults"] == {"date_precision": "month"}
    preview = owner.post(f"/api/collections/{collection['id']}/members/{member['id']}/preview").json()
    assert preview["visits"][0]["starts_on"] == "2054-04"


# --- following the audience in bulk ---------------------------------------------------------------------------


def _follow(owner: TestClient, fixture: Fixture, **payload) -> tuple[int, dict]:
    response = owner.post(f"{fixture.base}/date-precision/follow-audience", json=payload)
    return response.status_code, response.json()


def _live_public(owner: TestClient, fixture: Fixture, cap: str | None) -> None:
    owner.put(f"{fixture.base}/public-projection", json={"defaults": {"date_precision": cap} if cap else None})
    owner.post(f"{fixture.base}/public-projection/publish")


def _own(fixture: Fixture) -> dict[str, str | None]:
    with Session(engine) as session:
        return {
            "visit": session.get(Visit, fixture.visit["id"]).share_date_precision,
            "stay": session.get(Stay, fixture.stay["id"]).share_date_precision,
        }


def test_following_the_audience_previews_then_needs_the_widening_acknowledged() -> None:
    owner = client_for("owner-1")
    fixture = Fixture(owner)
    fixture.set_own("month")
    _live_public(owner, fixture, "day")

    status, preview = _follow(owner, fixture)
    assert status == 200 and preview["applied"] is False
    assert preview["changed"] == {"visits": 1, "stays": 1}
    assert preview["audiences"] == [
        {
            "audience": "public",
            "label": None,
            "widened": {"visits": 1, "stays": 1},
            "narrowed": {"visits": 0, "stays": 0},
        }
    ]
    assert _own(fixture) == {"visit": DatePrecision.MONTH, "stay": DatePrecision.MONTH}

    status, refused = _follow(owner, fixture, confirm=True)
    assert status == 409 and refused["detail"]["code"] == CODE
    assert refused["detail"]["audiences"][0]["audience"] == "public"
    assert _own(fixture) == {"visit": DatePrecision("month"), "stay": DatePrecision("month")}

    status, applied = _follow(owner, fixture, confirm=True, confirm_widening=True)
    assert status == 200 and applied["applied"] is True
    assert _own(fixture) == {"visit": None, "stay": None}
    document = owner.post(f"{fixture.base}/public-projection/preview").json()
    assert document["visits"][0]["starts_on"] == "2054-04-04" and document["stays"][0]["starts_on"] == "2054-04-01"

    # The change is recorded with audience ids and counts only.
    with Session(engine) as session:
        (event,) = session.scalars(
            select(AuditEvent).where(AuditEvent.kind == AuditEventKind.PRECISION_FOLLOW_AUDIENCE)
        )
        assert event.details["changed"] == {"visits": 1, "stays": 1}
        assert event.details["audiences"][0]["audience"] == "public"
        assert "label" not in json.dumps(event.details)

    # Nothing is left to change, so a second run is quiet.
    _, again = _follow(owner, fixture, confirm=True)
    assert again["changed"] == {"visits": 0, "stays": 0} and again["audiences"] == []


def test_following_an_audience_that_reads_by_month_or_less_widens_nobody() -> None:
    owner = client_for("owner-1")
    fixture = Fixture(owner)
    fixture.set_own("day")
    _live_public(owner, fixture, "month")

    # An audience that already caps at months shows nothing different, so it is not listed.
    status, preview = _follow(owner, fixture, kinds=["visit"])
    assert status == 200 and preview["changed"] == {"visits": 1, "stays": 0} and preview["audiences"] == []
    # One that sets nothing reads followers by month, so a day record narrows.
    _live_public(owner, fixture, None)
    _, preview = _follow(owner, fixture, kinds=["visit"])
    assert preview["audiences"][0]["widened"] == {"visits": 0, "stays": 0}
    assert preview["audiences"][0]["narrowed"] == {"visits": 1, "stays": 0}
    # Narrowing needs no acknowledgement; only the chosen kind changes.
    status, applied = _follow(owner, fixture, kinds=["visit"], confirm=True)
    assert status == 200 and applied["applied"] is True
    assert _own(fixture) == {"visit": None, "stay": DatePrecision("day")}


def test_following_an_audience_that_sets_nothing_reads_by_month_so_a_year_record_widens() -> None:
    owner = client_for("owner-1")
    fixture = Fixture(owner)
    fixture.set_own("year")
    _live_public(owner, fixture, None)

    _, preview = _follow(owner, fixture)
    assert preview["audiences"][0]["widened"] == {"visits": 1, "stays": 1}
    status, refused = _follow(owner, fixture, confirm=True)
    assert status == 409 and refused["detail"]["code"] == CODE


def test_a_draft_or_unpublished_audience_needs_no_acknowledgement() -> None:
    owner = client_for("owner-1")
    fixture = Fixture(owner)
    fixture.set_own("year")
    owner.put(f"{fixture.base}/public-projection", json={"defaults": {"date_precision": "day"}})
    owner.post(f"{fixture.base}/share-links", json={"label": "Draft", "scope": {"defaults": {"date_precision": "day"}}})

    _, preview = _follow(owner, fixture)
    assert preview["audiences"] == []
    status, applied = _follow(owner, fixture, confirm=True)
    assert status == 200 and applied["changed"] == {"visits": 1, "stays": 1}


def test_a_live_link_is_named_by_its_id_and_label_in_the_review() -> None:
    owner = client_for("owner-1")
    fixture = Fixture(owner)
    fixture.set_own("month")
    link = owner.post(
        f"{fixture.base}/share-links", json={"label": "Family", "scope": {"defaults": {"date_precision": "day"}}}
    ).json()
    activate(owner, fixture.trip["id"], link["id"])

    _, preview = _follow(owner, fixture)
    assert [(entry["audience"], entry["label"]) for entry in preview["audiences"]] == [(f"link:{link['id']}", "Family")]


def test_only_the_owner_can_follow_the_audience_and_the_request_is_validated() -> None:
    owner = client_for("owner-1")
    fixture = Fixture(owner)
    fixture.set_own("month")

    assert client_for("owner-2").post(f"{fixture.base}/date-precision/follow-audience", json={}).status_code == 404
    client_for("owner-1")
    assert owner.post(f"{fixture.base}/date-precision/follow-audience", json={"kinds": []}).status_code == 422
    assert owner.post(f"{fixture.base}/date-precision/follow-audience", json={"kinds": ["route"]}).status_code == 422
    assert owner.post(f"{fixture.base}/date-precision/follow-audience", json={"confirm": None}).status_code == 422
    assert _own(fixture) == {"visit": DatePrecision("month"), "stay": DatePrecision("month")}


def test_a_record_can_follow_the_audience_through_the_ordinary_edit_too() -> None:
    owner = client_for("owner-1")
    fixture = Fixture(owner)
    created = owner.post(
        f"{fixture.base}/visits", json={"area_id": fixture.visit["area"]["id"], "starts_on": "2054-04-09"}
    ).json()
    assert created["share_date_precision"] is None
    fixture.set_own("day")
    assert (
        owner.patch(f"{fixture.base}/visits/{fixture.visit['id']}", json={"title": "Renamed"}).json()[
            "share_date_precision"
        ]
        == "day"
    )
    assert (
        owner.patch(f"{fixture.base}/visits/{fixture.visit['id']}", json={"share_date_precision": None}).json()[
            "share_date_precision"
        ]
        is None
    )
    # Other required fields still cannot be nulled.
    assert owner.patch(f"{fixture.base}/visits/{fixture.visit['id']}", json={"status": None}).status_code == 422


# --- the Sharing check ---------------------------------------------------------------------------------------


def test_the_sharing_check_states_each_audiences_effective_precision_and_the_records_held_coarser() -> None:
    owner = client_for("owner-1")
    fixture = Fixture(owner)
    fixture.set_own("month")
    _live_public(owner, fixture, "day")
    link = owner.post(f"{fixture.base}/share-links", json={"label": "Open", "scope": {"defaults": None}}).json()

    audiences = {entry["kind"]: entry for entry in owner.get(f"{fixture.base}/overview").json()["audiences"]}
    public = audiences["public"]
    assert public["date_precision"] == "day"
    assert public["record_precision"]["visits"] == {
        "by_precision": {"month": 1},
        "limited_by_record": 1,
        "default_applied": 0,
    }
    assert public["record_precision"]["stays"]["limited_by_record"] == 1
    open_link = audiences["share_link"]
    assert open_link["id"] == link["id"] and open_link["date_precision"] is None
    # With no audience setting, a record's own month is the only thing holding it coarser than days.
    assert open_link["record_precision"]["visits"]["limited_by_record"] == 1

    # Following the audience removes the record-level limit; the audience's own setting remains.
    _follow(owner, fixture, confirm=True, confirm_widening=True)
    public = owner.get(f"{fixture.base}/overview").json()["audiences"][0]
    assert public["record_precision"]["visits"] == {
        "by_precision": {"day": 1},
        "limited_by_record": 0,
        "default_applied": 0,
    }


def test_an_audience_that_sets_nothing_reports_the_month_default_for_followers() -> None:
    owner = client_for("owner-1")
    fixture = Fixture(owner)
    fixture.set_own(None)
    _live_public(owner, fixture, None)

    public = owner.get(f"{fixture.base}/overview").json()["audiences"][0]
    assert public["date_precision"] is None
    assert public["record_precision"]["stays"] == {
        "by_precision": {"month": 1},
        "limited_by_record": 0,
        "default_applied": 1,
    }


def test_the_stored_scope_never_gains_a_defaults_key_unless_it_sets_something() -> None:
    owner = client_for("owner-1")
    fixture = Fixture(owner)
    owner.put(f"{fixture.base}/public-projection", json={"defaults": {"date_precision": None}})
    with Session(engine) as session:
        assert "defaults" not in session.scalar(select(PublicSurface.scope))
        link = ShareLink(trip_id=fixture.trip["id"], label="Old", series_id="x", scope={"items": []})
        session.add(link)
        session.commit()
        assert audience_precision(link.scope) is None
