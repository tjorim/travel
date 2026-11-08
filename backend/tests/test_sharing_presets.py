"""Sharing presets, steps 1 and 2 of #241: the planner and a read-only review (applying is in ``test_sharing_presets_apply``).

The world is the synthetic trip of ``test_link_exclusions`` (two areas, a hotel and a station, visits, stays, routes,
updates with photos, a cover) plus a few records a preset must not sweep in: ideas, a cancelled visit, a visit that
shows its time, an update without text, an unnamed area and a photo that is not approved. These tests plan and review;
the tests that need an "after" apply the plan in memory and then ask ``projection.delivered`` what every audience
receives."""

import random
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_link_exclusions import World, link_scope
from test_publication import (  # noqa: F401
    _photo_copy,
    client_for,
    engine,
    setup_function,
    teardown_function,
)

from app import sharing_presets
from app.access import COLLECTIONS
from app.audit import scope_fingerprint
from app.database import Base
from app.errors import ServiceError
from app.main import app
from app.models import AuditEvent, ShareLink, Trip, Visibility
from app.precision import audience_precision, effective_precision, is_finer, own_value
from app.projection import delivered
from app.routers.trips import trip_query
from app.sharing_presets import PRESETS, PresetAudience, plan_preset

PRESET_IDS = list(PRESETS)


@pytest.fixture
def world(tmp_path: Path) -> World:
    return World(client_for("owner-1"), tmp_path)


def vis(world: World, name: str, visibility: str) -> None:
    kind, record_id = world.ids[name]
    response = world.owner.put(f"{world.base}/visibility/{kind}/{record_id}", json={"visibility": visibility})
    assert response.status_code == 200, response.text


def everything(world: World, visibility: str) -> None:
    for name in world.ids:
        vis(world, name, visibility)


def add_extras(world: World) -> None:
    """Records a preset selects by kind but must not sweep in, all set to everyone where that is allowed."""
    area_a, area_b = world.ids["A"][1], world.ids["B"][1]
    post = world._post
    post(
        "visit", "V5", "visits", {"area_id": area_a, "title": "Idea visit", "starts_on": "2054-04-20", "status": "idea"}
    )
    post(
        "visit",
        "V6",
        "visits",
        {"area_id": area_a, "title": "Cancelled visit", "starts_on": "2054-04-21", "status": "cancelled"},
    )
    post(
        "visit",
        "V7",
        "visits",
        {
            "area_id": area_b,
            "title": "Timed visit",
            "starts_on": "2054-04-22",
            "start_time": "10:00",
            "end_time": "11:00",
            "share_time": True,
        },
    )
    post(
        "stay",
        "ST3",
        "stays",
        {"area_id": area_b, "check_in_date": "2054-06-01", "check_out_date": "2054-06-03", "status": "idea"},
    )
    post(
        "route",
        "R3",
        "routes",
        {
            "mode": "bus",
            "label": "Idea route",
            "departure_area_id": area_a,
            "arrival_area_id": area_b,
            "status": "idea",
        },
    )
    post("travel_update", "U4", "travel-updates", world._update("Draft update") | {"body": ""})
    post("area", "C", "areas", {})
    copy = _photo_copy(world.owner, world.id, approve=False)
    patch = {"caption": "Unapproved photo", "travel_update_id": world.ids["U1"][1]}
    assert world.owner.patch(f"{copy['path']}/presentation", json=patch).status_code == 200
    world.ids["P6"] = ("media_derivative", copy["derivative"]["id"])


# What each preset must select in the world above (the planned, shareable, text-bearing records only).
UPDATES = {"U1", "U2", "U3"}
STORY_PHOTOS = {"P1", "P2", "P3"}
ROUTE_KINDS = {"A", "B", "R1", "R2"}
TRIP_KINDS = {"V1", "V2", "V3", "V4", "ST1", "ST2"}
TARGETS = {
    "story_only": UPDATES | STORY_PHOTOS,
    "story_and_route": UPDATES | STORY_PHOTOS | ROUTE_KINDS,
    "planned_trip": UPDATES | STORY_PHOTOS | ROUTE_KINDS | TRIP_KINDS,
}


def review(world: World, audience: str, preset: str, client: TestClient | None = None):
    base = world.base
    path = {
        "public": f"{base}/public-projection/preset/review",
    }.get(audience, f"{base}/share-links/{audience.removeprefix('link:')}/preset/review")
    return (client or world.owner).post(path, json={"preset": preset})


def names(world: World, refs: list[dict]) -> set[str]:
    by_id = {record_id: name for name, (_, record_id) in world.ids.items()}
    return {by_id[item["id"]] for item in refs}


def snapshot(world: World) -> dict:
    """Everything a review must leave alone: every record's visibility and every scope, revision and audit row."""
    with Session(engine) as session:
        trip = session.scalar(trip_query().where(Trip.id == world.id))
        assert trip is not None
        visibilities = {
            (kind, item.id): item.visibility.value for kind in COLLECTIONS for item in COLLECTIONS[kind](trip)
        }
        links = {link.id: (link.revision, link.scope, link.state) for link in session.scalars(select(ShareLink))}
        rows = {
            table.name: session.scalar(select(func.count()).select_from(table)) for table in Base.metadata.sorted_tables
        }
        return {"visibility": visibilities, "links": links, "rows": rows}


def load(session: Session, world: World) -> Trip:
    trip = session.scalar(trip_query().where(Trip.id == world.id))
    assert trip is not None
    return trip


def link_audience(session: Session, link_id: str, *, live: bool = False) -> PresetAudience:
    link = session.get(ShareLink, link_id)
    assert link is not None
    return PresetAudience(
        id=f"link:{link.id}", kind="link", label=link.label, scope=link.scope, live=live, can_exclude=True
    )


def public_audience(scope: dict | None = None) -> PresetAudience:
    return PresetAudience(
        id="public",
        kind="public",
        label=None,
        scope=scope or {"defaults": {"date_precision": "month"}},
        live=True,
        can_exclude=False,
    )


# --- the first preset set ------------------------------------------------------------


def test_the_catalog_lists_the_three_presets_with_what_each_selects(world: World) -> None:
    response = world.owner.get(f"{world.base}/sharing-presets")
    assert response.status_code == 200, response.text
    catalog = response.json()
    assert catalog["schema_version"] == "travel/sharing-preset@1"
    assert (
        [preset["id"] for preset in catalog["presets"]]
        == PRESET_IDS
        == ["story_only", "story_and_route", "planned_trip"]
    )
    kinds = {preset["id"]: [rule["kind"] for rule in preset["selects"]] for preset in catalog["presets"]}
    assert kinds["story_only"] == ["travel_update"]
    assert kinds["story_and_route"] == ["travel_update", "area", "route"]
    assert kinds["planned_trip"] == ["travel_update", "area", "route", "visit", "stay"]
    planned = {rule["kind"]: rule["statuses"] for rule in catalog["presets"][2]["selects"]}
    assert planned["visit"] == planned["stay"] == planned["route"] == ["confirmed", "planned"]
    assert planned["travel_update"] is None
    assert all(preset["date_precision"] == "month" for preset in catalog["presets"])
    assert catalog["presets"][1]["extends"] == "story_only" and catalog["presets"][0]["extends"] is None


@pytest.mark.parametrize("preset", PRESET_IDS)
def test_each_preset_selects_its_target_set_and_nothing_else(world: World, preset: str) -> None:
    add_extras(world)
    everything(world, "private")
    link = world.link()
    response = review(world, f"link:{link['id']}", preset)
    assert response.status_code == 200, response.text
    body = response.json()
    expected = TARGETS[preset]
    # Everything was private, so the link receives exactly the target afterwards.
    assert names(world, body["comparison"]["widened"]) == expected
    assert body["comparison"]["narrowed"] == []
    assert body["comparison"]["before"] == {}
    # Photos are the approved copies attached to the included updates; they travel with the update and need no write.
    assert {change["action"] for change in body["changes"]} == {"promote"}
    assert names(world, body["changes"]) == expected - STORY_PHOTOS
    # What it did not sweep in, and why.
    needs = {(name, item["reason"]) for item in body["needs_decision"] for name in names(world, [item])}
    assert ("U4", "write_the_text_for_visitors_before_sharing_this_update") in needs
    assert ("P6", "approve_this_copy_before_sharing_it") in needs
    assert ("C", "name_this_area_before_sharing_it") in needs or preset == "story_only"
    assert ("V7", "share_time_is_on") in needs or preset != "planned_trip"
    # Ideas and cancelled plans are outside the preset and are not "needs your decision".
    assert not {"V5", "V6", "ST3", "R3"} & {name for name, _ in needs}


def test_presets_extend_one_another(world: World) -> None:
    add_extras(world)
    everything(world, "private")
    link = world.link()
    sizes = [
        sum(review(world, f"link:{link['id']}", preset).json()["comparison"]["after"].values()) for preset in PRESET_IDS
    ]
    assert sizes == sorted(sizes) and len(set(sizes)) == 3


def test_a_preset_never_adds_a_location_or_a_loose_photo(world: World) -> None:
    add_extras(world)
    everything(world, "private")
    link = world.link()
    for preset in PRESET_IDS:
        after = review(world, f"link:{link['id']}", preset).json()["comparison"]["after"]
        assert "location" not in after
        assert after.get("media_derivative", 0) == len(STORY_PHOTOS)


def test_photos_are_only_approved_copies_attached_to_included_updates(world: World) -> None:
    add_extras(world)
    everything(world, "private")
    # An approved photo attached to an update the preset does not include (no text) is not swept in either.
    copy = _photo_copy(world.owner, world.id)
    patch = {"caption": "Photo of the draft", "travel_update_id": world.ids["U4"][1]}
    assert world.owner.patch(f"{copy['path']}/presentation", json=patch).status_code == 200
    link = world.link()
    body = review(world, f"link:{link['id']}", "story_only").json()
    shown = {item["label"] for item in body["comparison"]["widened"] if item["kind"] == "media_derivative"}
    assert shown == {"Photo of A", "Photo of station", "Photo of plain"}


def test_a_stay_is_named_by_its_area_and_carries_its_check_in_day_separately(world: World) -> None:
    add_extras(world)
    everything(world, "private")
    link = world.link()
    body = review(world, f"link:{link['id']}", "planned_trip").json()
    stays = [item for item in body["comparison"]["widened"] if item["kind"] == "stay"]
    assert stays
    for stay in stays:
        # The label never carries a date: the interface formats the day for the reader's locale.
        assert stay["label"] in {"Alpha Town", "Beta City"} and stay["day"].startswith("2054-")
    assert all(item["day"] is None for item in body["comparison"]["widened"] if item["kind"] != "stay")


# --- a preset never writes everyone, never widens another audience -------------------


def test_a_preset_only_promotes_private_records_to_custom_and_lists_them(world: World) -> None:
    add_extras(world)
    for name in ("U1", "U2", "A", "R1", "V1", "V2"):
        vis(world, name, "private")
    vis(world, "U3", "custom")
    link = world.link()
    with Session(engine) as session:
        trip = load(session, world)
        before = {(kind, item.id): item.visibility for kind in COLLECTIONS for item in COLLECTIONS[kind](trip)}
        for preset in PRESET_IDS:
            plan = plan_preset(trip, link_audience(session, link["id"]), preset)
            for change in plan.changes:
                was = before[(change.kind, change.id)]
                if change.action == "promote":
                    assert was == Visibility.PRIVATE
                elif change.action == "list" or change.action == "unlist":
                    assert was == Visibility.CUSTOM
                else:
                    assert change.action in {"exclude", "remove_exclusion"} and was == Visibility.EVERYONE
            # The planned scope lists only what is custom or about to become custom, never an everyone record.
            promoted = set(plan.promoted())
            for item in plan.scope_after["items"]:
                key = (item["kind"], item["id"])
                assert before[key] == Visibility.CUSTOM or key in promoted
        # Planning wrote nothing to any record.
        assert {(kind, item.id): item.visibility for kind in COLLECTIONS for item in COLLECTIONS[kind](trip)} == before
        assert not session.dirty


@pytest.mark.parametrize("preset", PRESET_IDS)
def test_no_other_audience_receives_anything_new(world: World, preset: str) -> None:
    add_extras(world)
    for name in ("U1", "U2", "A", "R1", "V1", "V2", "ST1"):
        vis(world, name, "private")
    for name in ("U3", "V3", "P1"):
        vis(world, name, "custom")
    world.publish()
    first, _ = world.active_link(items=world.ref("U3", "V3"))
    second = world.link("Second", items=world.ref("U3"))
    with Session(engine) as session:
        trip = load(session, world)
        audiences = {
            "public": public_audience(),
            **{f"link:{item['id']}": link_audience(session, item["id"]) for item in (first, second)},
        }
        stored = {name: audience.scope for name, audience in audiences.items()}
        for name, audience in audiences.items():
            plan = plan_preset(trip, audience, preset)
            others_before = {
                other: {kind: {i.id for i in items} for kind, items in delivered(trip, scope).items()}
                for other, scope in stored.items()
                if other != name
            }
            for kind, record_id in plan.promoted():
                next(i for i in COLLECTIONS[kind](trip) if i.id == record_id).visibility = Visibility.CUSTOM
            for other, scope in stored.items():
                if other != name:
                    now = {kind: {i.id for i in items} for kind, items in delivered(trip, scope).items()}
                    assert now == others_before[other], f"{preset} for {name} changed {other}"
            session.rollback()


def test_the_review_fails_instead_of_reviewing_a_plan_that_would_change_another_audience(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    everything(world, "everyone")
    world.publish()
    link = world.link()
    real = sharing_presets.plan_preset

    def faulty(trip, audience, preset_id):
        plan = real(trip, audience, preset_id)
        # An everyone record "promoted" to custom would drop out of the public view, which does not list it.
        plan.changes.append(sharing_presets.Change("promote", "travel_update", world.ids["U1"][1]))
        return plan

    monkeypatch.setattr(sharing_presets, "plan_preset", faulty)
    before = snapshot(world)
    with pytest.raises(ServiceError) as caught:
        review(world, f"link:{link['id']}", "story_only")
    assert caught.value.code == "preset_changed_another_audience"
    assert snapshot(world) == before  # the nested transaction was rolled back


# --- precision ------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("current", "expected"),
    [(None, "month"), ("day", "month"), ("month", "month"), ("year", "year")],
)
def test_a_preset_makes_dates_at_most_month_precise_and_never_finer(
    world: World, current: str | None, expected: str
) -> None:
    link = world.link(defaults={"date_precision": current} if current else None)
    for preset in PRESET_IDS:
        body = review(world, f"link:{link['id']}", preset).json()
        precision = body["precision"]
        assert precision["before"] == current and precision["after"] == expected
        assert precision["changed"] is (current != expected)
        assert not is_finer(precision["after"], current or "year") or current is None


def test_the_review_counts_dates_that_would_read_coarser(world: World) -> None:
    everything(world, "everyone")
    # Days now: the shared visits and stay read by day and would read by month afterwards.
    link = world.link(defaults={"date_precision": "day"})
    for name in ("V1", "V2", "V3", "V4", "ST1", "ST2"):
        kind, record_id = world.ids[name]
        world.owner.patch(f"{world.base}/{kind}s/{record_id}", json={"share_date_precision": None})
    body = review(world, f"link:{link['id']}", "planned_trip").json()
    assert body["precision"]["reads_coarser"] == {"visit": 4, "stay": 2, "travel_update": 3}
    # Story only keeps the visits and stays out of the audience, so their dates do not count.
    story = review(world, f"link:{link['id']}", "story_only").json()
    assert story["precision"]["reads_coarser"] == {"travel_update": 3}

    # A dated route follows the audience too (#262): by day now, by month afterwards. An undated one reads no date.
    for name in ("R1", "R2"):
        kind, record_id = world.ids[name]
        world.owner.patch(f"{world.base}/{kind}s/{record_id}", json={"departs_on": "2054-04-04"})
    dated = review(world, f"link:{link['id']}", "story_and_route").json()
    assert dated["precision"]["reads_coarser"] == {"route": 2, "travel_update": 3}
    # With no cap a route reads by day as well, so the month preset narrows it there too.
    open_link = world.link(defaults=None)
    assert review(world, f"link:{open_link['id']}", "story_and_route").json()["precision"]["reads_coarser"] == {
        "route": 2,
        "travel_update": 3,
    }


def test_a_previewed_audience_with_no_cap_is_capped_at_month_afterwards(world: World) -> None:
    link = world.link(defaults=None)
    with Session(engine) as session:
        trip = load(session, world)
        plan = plan_preset(trip, link_audience(session, link["id"]), "story_only")
    assert audience_precision(plan.scope_after) == "month"
    assert effective_precision(None, plan.scope_after) == "month"


# --- exclude: a hidden link subtracts, the public view cannot -----------------------


def test_a_hidden_link_leaves_out_the_everyone_records_the_preset_does_not_include(world: World) -> None:
    everything(world, "everyone")
    link = world.link()
    body = review(world, f"link:{link['id']}", "story_only").json()
    excluded = names(world, [c for c in body["changes"] if c["action"] == "exclude"])
    # The visits, stays and routes go; the areas stay because the updates name them (below).
    assert excluded == {"V1", "V2", "V3", "V4", "ST1", "ST2", "R1", "R2"}
    assert {c["action"] for c in body["changes"]} == {"exclude"}
    assert names(world, body["comparison"]["narrowed"]) >= {"V1", "ST1", "R1", "R2"}
    assert body["comparison"]["added"] == {}
    assert body["requires_acknowledgement"] is False  # narrowing never needs one
    # The updates and their photos are what the link is left with, plus what the preset cannot take away.
    after = body["comparison"]["after"]
    assert after["travel_update"] == 3 and after["media_derivative"] >= 3


def test_an_exclusion_that_would_also_hide_an_included_record_is_not_made(world: World) -> None:
    everything(world, "everyone")
    link = world.link()
    body = review(world, f"link:{link['id']}", "story_only").json()
    left = {(name, item["reason"], item["way_out"]) for item in body["left_as_is"] for name in names(world, [item])}
    # Area A is named by update U1 and area B holds the station of U2: excluding either would hide an update.
    assert ("A", "needed_by_included_records", "change_visibility") in left
    assert ("B", "needed_by_included_records", "change_visibility") in left
    assert not {"A", "B"} & names(world, [c for c in body["changes"] if c["action"] == "exclude"])


def test_locations_and_loose_photos_stay_as_they_are_with_the_way_out(world: World) -> None:
    everything(world, "everyone")
    link = world.link()
    body = review(world, f"link:{link['id']}", "story_only").json()
    left = {(name, item["reason"], item["way_out"]) for item in body["left_as_is"] for name in names(world, [item])}
    for name in ("H", "S", "P4", "P5"):
        assert (name, "outside_preset", "exclude") in left
    assert not {"H", "S", "P4", "P5"} & names(world, body["changes"])


def test_a_custom_location_the_link_lists_is_left_alone_and_can_be_unlisted(world: World) -> None:
    everything(world, "private")
    vis(world, "H", "custom")
    link = world.link(items=world.ref("H"))
    body = review(world, f"link:{link['id']}", "story_only").json()
    assert names(world, body["changes"]) == UPDATES
    assert [(item["reason"], item["way_out"]) for item in body["left_as_is"]] == [("outside_preset", "unlist")]
    assert names(world, body["left_as_is"]) == {"H"}


def test_the_public_view_cannot_exclude_so_everyone_records_are_left_as_is(world: World) -> None:
    everything(world, "everyone")
    world.publish()
    body = review(world, "public", "story_only").json()
    assert body["changes"] == []
    assert body["comparison"]["added"] == {} and body["comparison"]["removed"] == {}
    left = names(world, body["left_as_is"])
    assert {"V1", "V2", "ST1", "R1", "A", "H"} <= left
    assert {item["reason"] for item in body["left_as_is"]} == {"everyone_on_public_view"}
    assert {item["way_out"] for item in body["left_as_is"]} == {"change_visibility"}
    assert body["audience"] == {"id": "public", "kind": "public", "label": None, "live": True}


def test_planning_never_gives_the_public_view_an_exclude_entry(world: World) -> None:
    everything(world, "everyone")
    with Session(engine) as session:
        trip = load(session, world)
        for preset in PRESET_IDS:
            plan = plan_preset(trip, public_audience(), preset)
            assert "exclude" not in plan.scope_after
            assert not [change for change in plan.changes if change.action in {"exclude", "remove_exclusion"}]


# --- exceptions the owner made by hand --------------------------------------------


def test_a_preset_replaces_exceptions_and_says_so(world: World) -> None:
    everything(world, "everyone")
    # Hand-made exceptions: U2 is left out of this link although the preset includes it, and a custom stay that
    # the link does not list stays unlisted by hand.
    vis(world, "ST2", "custom")
    link = world.link(exclude=world.ref("U2", "P5"))
    body = review(world, f"link:{link['id']}", "planned_trip").json()
    replaced = {(name, item["reason"]) for item in body["replaces_exceptions"] for name in names(world, [item])}
    assert ("U2", "exclusion_removed") in replaced
    assert ("ST2", "left_out_by_you") in replaced
    # P5 is a loose photo outside the preset, so its exclusion is kept and not reported.
    assert "P5" not in {name for name, _ in replaced}
    removed = {c["action"] for c in body["changes"] if names(world, [c]) == {"U2"}}
    assert removed == {"remove_exclusion"}
    assert body["comparison"]["widened"] and "U2" in names(world, body["comparison"]["widened"])


def test_an_exclusion_that_hides_an_included_record_through_its_area_is_removed(world: World) -> None:
    everything(world, "everyone")
    link = world.link(exclude=world.ref("A"))
    body = review(world, f"link:{link['id']}", "story_only").json()
    assert ("A", "exclusion_removed") in {
        (name, item["reason"]) for item in body["replaces_exceptions"] for name in names(world, [item])
    }


def test_re_applying_a_plan_is_an_empty_plan(world: World) -> None:
    add_extras(world)
    everything(world, "private")
    vis(world, "H", "everyone")
    link = world.link()
    with Session(engine) as session:
        trip = load(session, world)
        audience = link_audience(session, link["id"])
        for preset in PRESET_IDS:
            plan = plan_preset(trip, audience, preset)
            for kind, record_id in plan.promoted():
                next(i for i in COLLECTIONS[kind](trip) if i.id == record_id).visibility = Visibility.CUSTOM
            applied = PresetAudience(**{**audience.__dict__, "scope": plan.scope_after})
            again = plan_preset(trip, applied, preset)
            assert again.changes == [] and again.scope_after == plan.scope_after
            assert scope_fingerprint(again.scope_after) == scope_fingerprint(plan.scope_after)
            session.rollback()


# --- the review: before and after through delivered -------------------------------


def test_the_review_matches_what_delivered_returns_for_the_planned_scope(world: World) -> None:
    add_extras(world)
    everything(world, "private")
    vis(world, "H", "everyone")
    link = world.link()
    body = review(world, f"link:{link['id']}", "planned_trip").json()
    with Session(engine) as session:
        trip = load(session, world)
        plan = plan_preset(trip, link_audience(session, link["id"]), "planned_trip")
        for kind, record_id in plan.promoted():
            next(i for i in COLLECTIONS[kind](trip) if i.id == record_id).visibility = Visibility.CUSTOM
        before = {
            kind: len(items)
            for kind, items in delivered(trip, link_audience(session, link["id"]).scope).items()
            if items
        }
        after = {kind: len(items) for kind, items in delivered(trip, plan.scope_after).items() if items}
        session.rollback()
    assert body["comparison"]["before"] == before == {"location": 1}
    assert body["comparison"]["after"] == after
    assert sum(body["comparison"]["added"].values()) == sum(after.values()) - sum(before.values())


def test_a_live_audience_that_would_newly_receive_records_needs_an_acknowledgement(world: World) -> None:
    everything(world, "private")
    world.publish()
    body = review(world, "public", "story_only").json()
    assert body["audience"]["live"] is True
    assert body["requires_acknowledgement"] is True
    assert names(world, body["comparison"]["widened"]) == UPDATES | STORY_PHOTOS
    # A draft link delivers nothing yet, so nothing needs acknowledging.
    draft = world.link()
    drafted = review(world, f"link:{draft['id']}", "story_only").json()
    assert drafted["audience"]["live"] is False and drafted["requires_acknowledgement"] is False
    # An active link does.
    active, _ = world.active_link()
    assert review(world, f"link:{active['id']}", "story_only").json()["requires_acknowledgement"] is True


def test_narrowing_needs_no_acknowledgement_even_when_live(world: World) -> None:
    everything(world, "everyone")
    active, _ = world.active_link()
    body = review(world, f"link:{active['id']}", "story_only").json()
    assert body["audience"]["live"] is True
    assert body["comparison"]["narrowed"] and not body["comparison"]["widened"]
    assert body["requires_acknowledgement"] is False


def test_the_fingerprint_follows_the_plan(world: World) -> None:
    everything(world, "private")
    link = world.link()
    first = review(world, f"link:{link['id']}", "story_only").json()["fingerprint"]
    assert review(world, f"link:{link['id']}", "story_only").json()["fingerprint"] == first
    assert review(world, f"link:{link['id']}", "story_and_route").json()["fingerprint"] != first
    vis(world, "U1", "everyone")
    assert review(world, f"link:{link['id']}", "story_only").json()["fingerprint"] != first


# --- the caps ---------------------------------------------------------------------


def _bulk_updates(world: World, count: int) -> None:
    from app.models import TravelUpdate

    with Session(engine) as session:
        base = session.scalar(select(TravelUpdate).where(TravelUpdate.id == world.ids["U1"][1]))
        assert base is not None
        for number in range(count):
            session.add(
                TravelUpdate(
                    trip_id=world.id,
                    occurred_at=base.occurred_at,
                    date_precision=base.date_precision,
                    title=f"Bulk {number}",
                    body="A safe note.",
                    visibility=Visibility.PRIVATE,
                )
            )
        session.commit()


def test_a_plan_beyond_the_items_cap_is_refused_with_a_reason(world: World) -> None:
    everything(world, "private")
    _bulk_updates(world, 200)  # 3 + 200 updates would be listed: more than the 200 a scope may hold
    link = world.link()
    response = review(world, f"link:{link['id']}", "story_only")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["applicable"] is False
    assert body["refusal"] == {
        "code": "preset_too_large",
        "items": 203,
        "exclude": 0,
        "max_items": 200,
        "max_exclude": 500,
    }
    assert body["comparison"] is None
    # The same scope with room left is fine.
    assert review(world, "public", "story_only").json()["refusal"]["code"] == "preset_too_large"


def test_a_plan_beyond_the_exclusion_cap_is_refused_with_a_reason(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    everything(world, "everyone")
    monkeypatch.setattr(sharing_presets, "MAX_SCOPE_EXCLUSIONS", 5)
    link = world.link()
    body = review(world, f"link:{link['id']}", "story_only").json()
    assert body["applicable"] is False
    assert body["refusal"]["code"] == "preset_too_large" and body["refusal"]["exclude"] == 8
    assert body["refusal"]["max_exclude"] == 5


def test_a_plan_within_the_caps_is_applicable(world: World) -> None:
    everything(world, "private")
    link = world.link()
    body = review(world, f"link:{link['id']}", "story_only").json()
    assert body["applicable"] is True and body["refusal"] is None


# --- the review writes nothing -----------------------------------------------------


def test_a_review_stores_nothing_claims_no_revision_and_records_no_audit_event(world: World) -> None:
    add_extras(world)
    everything(world, "private")
    vis(world, "U1", "custom")
    world.publish()
    active, _ = world.active_link(items=world.ref("U1"))
    draft = world.link("Draft")
    before = snapshot(world)
    audit_before = len(world.owner.get(f"{world.base}/audit-events").json())
    for preset in PRESET_IDS:
        for audience in ("public", f"link:{active['id']}", f"link:{draft['id']}"):
            assert review(world, audience, preset).status_code == 200
    assert snapshot(world) == before
    assert len(world.owner.get(f"{world.base}/audit-events").json()) == audit_before
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.trip_id == world.id)) == (
            audit_before
        )
    # The owner's own read agrees: a rolled-back promotion left no trace in the link or its revision.
    current = world.owner.get(f"{world.base}/share-links/{active['id']}").json()
    assert current["revision"] == before["links"][active["id"]][0]
    assert current["scope"] == before["links"][active["id"]][1]


def test_a_review_leaves_the_session_clean_so_a_later_commit_cannot_persist_it(world: World) -> None:
    everything(world, "private")
    link = world.link()
    with Session(engine) as session:
        trip = load(session, world)
        audience = link_audience(session, link["id"])
        review = sharing_presets.review_preset(session, trip, audience, "planned_trip")
        assert review.changes
        assert not session.dirty and not session.new and not session.deleted
        session.commit()
    after = snapshot(world)
    assert set(after["visibility"].values()) == {"private"}


def test_a_review_of_an_unsaved_public_view_does_not_create_it(world: World) -> None:
    everything(world, "private")
    assert review(world, "public", "story_only").status_code == 200
    from app.models import PublicSurface

    with Session(engine) as session:
        assert session.get(PublicSurface, world.id) is None


# --- owner-only -------------------------------------------------------------------


def test_another_owner_cannot_reach_a_review_or_the_catalog(world: World) -> None:
    link = world.link()
    outsider = client_for("owner-2")
    for audience in ("public", f"link:{link['id']}"):
        assert review(world, audience, "story_only", outsider).status_code == 404
    assert outsider.get(f"{world.base}/sharing-presets").status_code == 404
    # Restore the owner's overrides: client_for replaces the subject for every client.
    client_for("owner-1")


def test_an_unknown_preset_or_audience_is_refused(world: World) -> None:
    link = world.link()
    assert review(world, f"link:{link['id']}", "everything").status_code == 422
    assert (
        world.owner.post(f"{world.base}/share-links/nope/preset/review", json={"preset": "story_only"}).status_code
        == 404
    )
    extra = world.owner.post(
        f"{world.base}/public-projection/preset/review", json={"preset": "story_only", "confirm": True}
    )
    assert extra.status_code == 422  # a review never applies: an unknown field is refused, never ignored


def test_a_revoked_link_has_nothing_to_review(world: World) -> None:
    link, _ = world.active_link()
    assert world.owner.post(f"{world.base}/share-links/{link['id']}/revoke", json={}).status_code == 200
    assert review(world, f"link:{link['id']}", "story_only").status_code == 409


def test_every_preset_route_requires_the_owner() -> None:
    from fastapi.routing import APIRoute

    from app.auth import current_subject

    found = []
    pending = list(app.routes)
    while pending:
        route = pending.pop()
        if isinstance(route, APIRoute) and "preset" in route.path:
            found.append(route.path)
            assert route.path.startswith(("/trips/", "/collections/")), route.path
            assert any(dep.call is current_subject for dep in route.dependant.dependencies), route.path
        # FastAPI keeps an included router as one entry that wraps the router's own routes.
        elif (included := getattr(route, "original_router", None)) is not None:
            pending.extend(included.routes)
    assert len(found) == 7  # three review routes, three apply routes and the catalog


def test_a_review_is_not_part_of_any_visitor_response(world: World) -> None:
    everything(world, "everyone")
    slug = world.publish()
    link, token = world.active_link()
    anonymous = TestClient(app)
    for path in (f"/api/public/trips/{slug}", f"/api/shared/{token}"):
        text = anonymous.get(path).text
        for word in ("preset", "left_as_is", "requires_acknowledgement"):
            assert word not in text
    # Without the owner's identity (the test override removed) every preset route is refused.
    from app.auth import current_subject

    app.dependency_overrides.pop(current_subject)
    for path in ("public-projection", f"share-links/{link['id']}"):
        assert anonymous.post(f"{world.base}/{path}/preset/review", json={"preset": "story_only"}).status_code == 401
    assert anonymous.get(f"{world.base}/sharing-presets").status_code == 401


# --- property: never more than the preset, the baseline and the owner's own choices --


def _random_world(world: World, rng: random.Random) -> None:
    add_extras(world)
    choices = ["private", "private", "everyone", "custom"]
    for name in world.ids:
        kind, record_id = world.ids[name]
        want = rng.choice(choices)
        response = world.owner.put(f"{world.base}/visibility/{kind}/{record_id}", json={"visibility": want})
        if response.status_code != 200:
            world.owner.put(f"{world.base}/visibility/{kind}/{record_id}", json={"visibility": "private"})


@pytest.mark.parametrize("seed", range(12))
def test_whatever_the_records_are_a_preset_adds_only_what_it_selects(world: World, seed: int) -> None:
    rng = random.Random(seed)
    _random_world(world, rng)
    # A mixed audience: some custom records listed, some everyone records excluded.
    with Session(engine) as session:
        trip = load(session, world)
        custom = [
            {"kind": kind, "id": item.id}
            for kind in COLLECTIONS
            for item in COLLECTIONS[kind](trip)
            if item.visibility == Visibility.CUSTOM and rng.random() < 0.6 and kind != "media_derivative"
        ]
        baseline = [
            {"kind": kind, "id": item.id}
            for kind in COLLECTIONS
            for item in COLLECTIONS[kind](trip)
            if item.visibility == Visibility.EVERYONE and rng.random() < 0.3
        ]
    link = world.owner.post(
        f"{world.base}/share-links", json={"label": "Mixed", "scope": link_scope(items=custom, exclude=baseline)}
    )
    assert link.status_code == 201, link.text
    link_id = link.json()["id"]
    with Session(engine) as session:
        trip = load(session, world)
        everyone = {
            (kind, item.id)
            for kind in COLLECTIONS
            for item in COLLECTIONS[kind](trip)
            if item.visibility == Visibility.EVERYONE
        }
        visibility = {(kind, item.id): item.visibility for kind in COLLECTIONS for item in COLLECTIONS[kind](trip)}
        audiences = [
            link_audience(session, link_id),
            public_audience({"defaults": {"date_precision": rng.choice(["day", "month", "year"])}}),
        ]
        for audience in audiences:
            before = delivered(trip, audience.scope)
            before_refs = {(kind, item.id) for kind in before for item in before[kind]}
            for preset_id in PRESET_IDS:
                plan = plan_preset(trip, audience, preset_id)
                target = {(kind, record_id) for kind, ids in plan.target.items() for record_id in ids}
                for kind, record_id in plan.promoted():
                    next(i for i in COLLECTIONS[kind](trip) if i.id == record_id).visibility = Visibility.CUSTOM
                after = delivered(trip, plan.scope_after)
                after_refs = {(kind, item.id) for kind in after for item in after[kind]}

                # It delivers the whole target (the preset does what it says) ...
                assert target <= after_refs, (seed, preset_id, target - after_refs)
                # ... and only that, the public baseline, and what the owner had chosen for the unmanaged kinds.
                # (a listed one may be hidden today by an exclusion the preset resets).
                unmanaged_before = {ref for ref in before_refs if ref[0] not in sharing_presets.MANAGED_KINDS} | {
                    (item["kind"], item["id"])
                    for item in audience.scope.get("items", [])
                    if item["kind"] not in sharing_presets.MANAGED_KINDS
                }
                allowed = target | (everyone & after_refs) | unmanaged_before
                extra = after_refs - allowed
                assert not extra, (seed, preset_id, audience.id, extra)

                # No visibility became everyone; no everyone record changed.
                now = {(kind, item.id): item.visibility for kind in COLLECTIONS for item in COLLECTIONS[kind](trip)}
                for key, was in visibility.items():
                    assert (now[key] == Visibility.EVERYONE) == (was == Visibility.EVERYONE)
                # What the preset lists is the target; an idea, a cancelled plan, a record with a blocker, a time it
                # would reveal, a location and a loose photo are never listed or promoted.
                listed = {(c.kind, c.id) for c in plan.changes if c.action in {"promote", "list"}}
                assert listed <= target
                not_swept = {
                    ref
                    for name, ref in world.ids.items()
                    if name in {"V5", "V6", "V7", "ST3", "R3", "U4", "C", "P6", "P4", "P5", "H", "S"}
                }
                assert not listed & not_swept
                assert not [ref for ref in listed if ref[0] in {"location", "media_derivative"}]

                # Dates never read finer.
                cap = audience_precision(plan.scope_after)
                assert cap in {"month", "year"}
                for kind in ("visit", "stay"):
                    for item in after[kind]:
                        assert not is_finer(effective_precision(own_value(item), cap), "month")
                session.rollback()
                trip = load(session, world)


# --- collection members ---------------------------------------------------------------


def make_member(world: World, *, activate: bool = False, **scope_fields) -> tuple[dict, dict]:
    owner = world.owner
    collection = owner.post("/api/collections", json={"label": "Family", "title": None})
    assert collection.status_code == 201, collection.text
    collection_id = collection.json()["id"]
    response = owner.post(
        f"/api/collections/{collection_id}/members", json={"trip_id": world.id, "scope": link_scope(**scope_fields)}
    )
    assert response.status_code == 201, response.text
    if activate:
        assert owner.post(f"/api/collections/{collection_id}/activate", json={"expires_in_days": 30}).status_code == 200
    members = owner.get(f"/api/collections/{collection_id}").json()["members"]
    return {"id": collection_id}, members[0]


def member_review(world: World, collection_id: str, member_id: str, preset: str, client: TestClient | None = None):
    return (client or world.owner).post(
        f"/api/collections/{collection_id}/members/{member_id}/preset/review", json={"preset": preset}
    )


def test_a_collection_member_is_reviewed_like_a_hidden_link(world: World) -> None:
    everything(world, "everyone")
    collection, member = make_member(world)
    link = world.link()
    on_member = member_review(world, collection["id"], member["id"], "story_only")
    assert on_member.status_code == 200, on_member.text
    body = on_member.json()
    on_link = review(world, f"link:{link['id']}", "story_only").json()
    assert body["audience"] == {
        "id": f"collection:{member['id']}",
        "kind": "collection_member",
        "label": "Family",
        "live": False,
    }
    # The same plan: a member has the same scope shape and rules as a link.
    assert body["changes"] == on_link["changes"] and body["comparison"] == on_link["comparison"]
    assert {c["action"] for c in body["changes"]} == {"exclude"}
    # Nothing was stored for the member either.
    assert world.owner.get(f"/api/collections/{collection['id']}").json()["members"][0]["scope"] == member["scope"]


def test_an_active_collection_member_is_live(world: World) -> None:
    everything(world, "private")
    collection, member = make_member(world, activate=True)
    body = member_review(world, collection["id"], member["id"], "story_only").json()
    assert body["audience"]["live"] is True and body["requires_acknowledgement"] is True


def test_a_collection_member_review_is_owner_only_and_checks_the_collection(world: World) -> None:
    collection, member = make_member(world, activate=True)
    other_collection, _ = make_member(world)
    stranger = client_for("owner-2")
    assert member_review(world, collection["id"], member["id"], "story_only", stranger).status_code == 404
    client_for("owner-1")
    # The member belongs to another collection of the same owner.
    assert member_review(world, other_collection["id"], member["id"], "story_only").status_code == 404
    assert member_review(world, collection["id"], "missing", "story_only").status_code == 404
    revoked = world.owner.post(f"/api/collections/{collection['id']}/revoke", json={})
    assert revoked.status_code == 200, revoked.text
    assert member_review(world, collection["id"], member["id"], "story_only").status_code == 409


@pytest.mark.parametrize("preset", ["story_and_route", "planned_trip"])
def test_a_preset_shares_only_areas_that_an_included_record_names(world: World, preset: str) -> None:
    add_extras(world)
    world._post(
        "area",
        "HOME",
        "areas",
        {"label": "Home Town", "country_code": "TW", "latitude": 24.0, "longitude": 120.5},
    )
    everything(world, "private")
    link = world.link()
    body = review(world, f"link:{link['id']}", preset).json()
    assert "HOME" not in names(world, body["comparison"]["widened"])
    assert {"A", "B"} <= names(world, body["comparison"]["widened"])
