"""Synthetic audience figures; the finished projection is the only source."""

from copy import deepcopy
from datetime import UTC, date, datetime

import pytest

from app.models import Area, DatePrecision, PlanningStatus, Stay, TravelUpdate, Trip, Visibility
from app.projection import render_projection, summary_numbers
from app.schemas import ShareScopeInput
from app.sharing_presets import PresetAudience, plan_preset

ALL = ["days", "areas", "countries", "nights"]


def fixture():
    trip = Trip(id="trip", owner_subject="owner", title="Synthetic")
    area = Area(id="area", trip_id="trip", label="Synthetic area", country_code="BE", visibility=Visibility.EVERYONE)
    trip.areas.append(area)
    TravelUpdate(
        id="update",
        share_id="stable",
        trip=trip,
        title="Synthetic",
        body="Story",
        occurred_at=datetime(2054, 4, 4, tzinfo=UTC),
        share_date_precision=DatePrecision.DAY,
        visibility=Visibility.EVERYONE,
    )
    for i, (start, end) in enumerate([(1, 5), (3, 7)]):
        Stay(
            id=f"stay{i}",
            trip=trip,
            area=area,
            check_in_date=date(2054, 4, start),
            check_out_date=date(2054, 4, end),
            share_date_precision=DatePrecision.DAY,
            status=PlanningStatus.PLANNED,
            visibility=Visibility.EVERYONE,
        )
    return trip


def test_projection_only_and_private_unshared_invariance():
    trip = fixture()
    scope = {"numbers": ALL, "defaults": {"date_precision": "day"}}
    before = render_projection(trip, scope, "test")
    assert before["numbers"] == {"days": 1, "areas": 1, "countries": 1, "nights": 6}
    for visibility in [Visibility.PRIVATE, Visibility.CUSTOM]:
        hidden = Area(
            id=f"hidden-{visibility}", trip_id="trip", label="Secret", country_code="US", visibility=visibility
        )
        trip.areas.append(hidden)
        hidden_stay = Stay(
            id=f"hiddenstay-{visibility}",
            trip=trip,
            area=hidden,
            check_in_date=date(2000, 1, 1),
            check_out_date=date(2100, 1, 1),
            visibility=visibility,
        )
        update = TravelUpdate(
            id=f"hiddenupdate-{visibility}",
            share_id=f"hidden-{visibility}",
            trip=trip,
            title="Secret",
            body="Secret",
            occurred_at=datetime(2050, 1, 1, tzinfo=UTC),
            share_date_precision=DatePrecision.DAY,
            visibility=visibility,
        )
        assert render_projection(trip, scope, "test") == before
        assert update in trip.travel_updates
        hidden_stay.check_out_date = date(2200, 1, 1)
        hidden.country_code = "FR"
        update.occurred_at = datetime(2060, 1, 1, tzinfo=UTC)
        trip.starts_on = date(2000, 1, 1)
        trip.ends_on = date(2100, 1, 1)
        assert render_projection(trip, scope, "test") == before
    # Fields of delivered records that aren't delivered cannot influence figures either.
    trip.stays[0].property_name = "Private hotel"
    trip.travel_updates[0].occurred_at = datetime(2054, 4, 4, 23, 59, tzinfo=UTC)
    assert render_projection(trip, scope, "test")["numbers"] == before["numbers"]
    assert summary_numbers(deepcopy(before), ALL) == before["numbers"]


@pytest.mark.parametrize("precision", ["month", "year"])
def test_coarse_dates_and_exclusions(precision):
    trip = fixture()
    scope = {"numbers": ALL, "defaults": {"date_precision": precision}}
    assert render_projection(trip, scope, "test")["numbers"] == {
        "days": 0,
        "areas": 1,
        "countries": 1,
        "nights": 0,
    }
    before = render_projection(trip, scope, "test")["numbers"]
    trip.travel_updates[0].occurred_at = datetime(2054, 4, 20, tzinfo=UTC)
    trip.stays[0].check_in_date = date(2054, 4, 2)
    trip.stays[0].check_out_date = date(2054, 4, 30)
    assert render_projection(trip, scope, "test")["numbers"] == before
    scope["exclude"] = [{"kind": "area", "id": "area"}]
    assert render_projection(trip, scope, "test")["numbers"] == {
        "days": 0,
        "areas": 0,
        "countries": 0,
        "nights": 0,
    }


def test_selection_validation_legacy_and_presets():
    trip = fixture()
    assert "numbers" not in render_projection(trip, {}, "test")
    stored = {"numbers": ALL}
    assert set(ShareScopeInput().document(stored)["numbers"]) == set(ALL)
    assert "numbers" not in ShareScopeInput(numbers=[]).document(stored)
    with pytest.raises(ValueError):
        ShareScopeInput(numbers=["distance"])
    for preset in ["story_only", "story_and_route", "planned_trip"]:
        audience = PresetAudience(
            kind="public", id="public", label="public", scope=stored, live=False, can_exclude=False
        )
        plan = plan_preset(trip, audience, preset)
        assert plan.scope_after["numbers"] == ALL
        assert render_projection(trip, plan.scope_after, "test")["numbers"]["nights"] == 0


def test_record_precision_and_duplicate_days_countries():
    trip = fixture()
    scope = {"numbers": ALL, "defaults": {"date_precision": "day"}}
    trip.travel_updates[0].share_date_precision = DatePrecision.MONTH
    trip.stays[0].share_date_precision = DatePrecision.YEAR
    result = render_projection(trip, scope, "test")["numbers"]
    assert result == {"days": 0, "areas": 1, "countries": 1, "nights": 4}
    trip.travel_updates[0].share_date_precision = DatePrecision.DAY
    trip.areas.append(
        Area(id="second", trip_id="trip", label="Another area", country_code="BE", visibility=Visibility.EVERYONE)
    )
    TravelUpdate(
        id="duplicate",
        share_id="duplicate",
        trip=trip,
        title="Another story",
        body="Story",
        occurred_at=datetime(2054, 4, 4, 22, tzinfo=UTC),
        share_date_precision=DatePrecision.DAY,
        visibility=Visibility.EVERYONE,
    )
    assert render_projection(trip, scope, "test")["numbers"] == {
        "days": 1,
        "areas": 2,
        "countries": 1,
        "nights": 4,
    }
