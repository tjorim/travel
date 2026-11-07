"""Sharing presets, step 2 of #241: applying a reviewed preset, the display label and the audit event.

The world is the synthetic trip of ``test_sharing_presets``. Every test asserts on stored state or on what a visitor
receives, never on the planner's own bookkeeping alone: ``projection.delivered`` is the one function that says what an
audience gets."""

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_link_exclusions import World, link_scope
from test_publication import (  # noqa: F401
    client_for,
    engine,
    setup_function,
    teardown_function,
)
from test_sharing_presets import (
    PRESET_IDS,
    STORY_PHOTOS,
    TARGETS,
    _bulk_updates,
    add_extras,
    everything,
    make_member,
    names,
    vis,
)

from app import sharing_presets
from app.access import COLLECTIONS
from app.models import (
    AuditEvent,
    AuditEventKind,
    CollectionAuditEvent,
    CollectionMember,
    PublicSurface,
    ShareLink,
    Trip,
    Visibility,
)
from app.projection import ScopeError, delivered
from app.routers.trips import trip_query

KINDS = ["public", "link", "member"]
MONTH = {"date_precision": "month"}


@pytest.fixture
def world(tmp_path: Path) -> World:
    return World(client_for("owner-1"), tmp_path)


@dataclass
class Target:
    """One audience of the world, reachable the way the owner reaches it."""

    kind: str
    id: str
    review_path: str
    apply_path: str
    read: Callable[[], dict]  # the owner's response for the audience: revision, scope, applied_preset, ...


def make_target(world: World, kind: str, *, live: bool = False) -> Target:
    base = world.base
    if kind == "public":
        if live:
            world.publish()
        target = Target(
            kind,
            "public",
            f"{base}/public-projection/preset/review",
            f"{base}/public-projection/preset",
            lambda: world.owner.get(f"{base}/public-projection").json(),
        )
        target.read()  # reading creates the (unpublished) public view, as the owner's editor does
        return target
    if kind == "link":
        link, _ = world.active_link() if live else (world.link(), None)
        path = f"{base}/share-links/{link['id']}"
        return Target(
            kind,
            f"link:{link['id']}",
            f"{path}/preset/review",
            f"{path}/preset",
            lambda: world.owner.get(path).json(),
        )
    collection, member = make_member(world, activate=live)
    path = f"/api/collections/{collection['id']}"
    return Target(
        kind,
        f"collection:{member['id']}",
        f"{path}/members/{member['id']}/preset/review",
        f"{path}/members/{member['id']}/preset",
        lambda: world.owner.get(path).json()["members"][0],
    )


def review_of(world: World, target: Target, preset: str) -> dict:
    response = world.owner.post(target.review_path, json={"preset": preset})
    assert response.status_code == 200, response.text
    return response.json()


def apply(
    world: World,
    target: Target,
    preset: str,
    *,
    fingerprint: str | None = None,
    confirm_widening: bool = False,
    headers: dict | None = None,
    client: TestClient | None = None,
):
    if fingerprint is None:
        fingerprint = review_of(world, target, preset)["fingerprint"]
    body: dict = {"preset": preset, "fingerprint": fingerprint}
    if confirm_widening:
        body["confirm_widening"] = True
    return (client or world.owner).post(target.apply_path, json=body, headers=headers or {})


def received_names(world: World, scope: dict) -> set[str]:
    """The names of the records an audience with this scope receives."""
    by_id = {record_id: name for name, (_, record_id) in world.ids.items()}
    with Session(engine) as session:
        trip = session.scalar(trip_query().where(Trip.id == world.id))
        assert trip is not None
        return {by_id[item.id] for items in delivered(trip, scope).values() for item in items if item.id in by_id}


def received_counts(world: World, scope: dict) -> dict[str, int]:
    """How many records of each kind an audience with this scope receives, like the review's `comparison`."""
    with Session(engine) as session:
        trip = session.scalar(trip_query().where(Trip.id == world.id))
        assert trip is not None
        counts = {kind: len(items) for kind, items in delivered(trip, scope).items()}
        return {kind: count for kind, count in counts.items() if count}


def stored(world: World) -> dict:
    """Everything an apply may write, read back through a fresh session: visibilities, audience rows, audit rows."""
    with Session(engine) as session:
        trip = session.scalar(trip_query().where(Trip.id == world.id))
        assert trip is not None
        return {
            "visibility": {
                (kind, item.id): item.visibility.value for kind in COLLECTIONS for item in COLLECTIONS[kind](trip)
            },
            "public": [(s.revision, s.scope, s.applied_preset) for s in session.scalars(select(PublicSurface))],
            "links": {
                link.id: (link.revision, link.scope, link.applied_preset) for link in session.scalars(select(ShareLink))
            },
            "members": {
                m.id: (m.revision, m.scope, m.applied_preset) for m in session.scalars(select(CollectionMember))
            },
            "audit": session.scalar(select(func.count()).select_from(AuditEvent)),
            "collection_audit": session.scalar(select(func.count()).select_from(CollectionAuditEvent)),
        }


def error_code_of(response) -> str:
    return response.json()["errors"][0]["code"]


def error_code(response) -> str:
    assert response.json()["errors"][0]["code"] == response.json()["detail"]["code"]
    return response.json()["detail"]["code"]


# --- applying each preset to each audience ---------------------------------------------------------


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("preset", PRESET_IDS)
def test_apply_gives_the_audience_exactly_the_preset_and_labels_it(world: World, kind: str, preset: str) -> None:
    add_extras(world)
    everything(world, "private")
    target = make_target(world, kind)
    before = target.read()

    response = apply(world, target, preset)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["applied"] is True and body["review"]["preset"] == preset
    audience = body["audience"]
    assert audience["applied_preset"] == preset and audience["applied_preset_at"]
    assert audience["revision"] == before["revision"] + 1
    assert audience["preset_exceptions"] == {"shown": [], "hidden": [], "count": 0}

    now = target.read()
    assert (now["applied_preset"], now["revision"]) == (preset, audience["revision"])
    assert now["scope"]["defaults"] == MONTH  # a preset never makes dates finer
    assert received_names(world, now["scope"]) == TARGETS[preset]
    # The review's counts are what the apply did: the preview and the write are the same plan.
    assert received_counts(world, now["scope"]) == body["review"]["comparison"]["after"]
    visibility = stored(world)["visibility"]
    # Only private records were promoted, to custom: a preset never writes everyone.
    assert "everyone" not in visibility.values()
    custom = {name for name, ref in world.ids.items() if visibility[ref] == "custom"}
    assert custom == TARGETS[preset] - STORY_PHOTOS
    assert {item["id"] for item in now["scope"]["items"]} == {world.ids[name][1] for name in custom}


@pytest.mark.parametrize("kind", ["link", "member"])
def test_applying_to_everyone_records_only_leaves_them_out_and_changes_no_visibility(world: World, kind: str) -> None:
    everything(world, "everyone")
    target = make_target(world, kind)
    before = stored(world)["visibility"]
    response = apply(world, target, "story_only")
    assert response.status_code == 200, response.text
    assert stored(world)["visibility"] == before and set(before.values()) == {"everyone"}
    # The hidden audience now leaves out what the preset does not include; locations and loose photos stay (their
    # own visibility decides) and so do the areas the included updates name.
    scope = target.read()["scope"]
    assert scope["items"] == [] and scope["exclude"]
    received = received_names(world, scope)
    assert {"U1", "U2", "U3", "H", "S", "P5", "A"} <= received
    assert not received & {"V1", "V2", "ST1", "R1", "R2"}


def test_a_preset_applied_to_a_never_saved_public_view_creates_it_unpublished(world: World) -> None:
    everything(world, "private")
    base = world.base
    target = Target(
        "public", "public", f"{base}/public-projection/preset/review", f"{base}/public-projection/preset", dict
    )
    with Session(engine) as session:
        assert session.get(PublicSurface, world.id) is None
    response = apply(world, target, "story_only")
    assert response.status_code == 200, response.text
    audience = response.json()["audience"]
    assert audience["surface_state"] == "unpublished" and audience["applied_preset"] == "story_only"
    assert received_names(world, audience["scope"]) == TARGETS["story_only"]


# --- the fingerprint -------------------------------------------------------------------------------


@pytest.mark.parametrize("kind", KINDS)
def test_a_stale_fingerprint_is_refused_with_a_fresh_review_and_nothing_changes(world: World, kind: str) -> None:
    everything(world, "private")
    target = make_target(world, kind)
    stale = review_of(world, target, "story_only")["fingerprint"]
    vis(world, "U1", "everyone")  # the records changed after the owner looked
    before = stored(world)

    refused = apply(world, target, "story_only", fingerprint=stale)
    assert refused.status_code == 409
    assert error_code(refused) == "preset_preview_is_stale"
    fresh = refused.json()["detail"]["review"]
    assert fresh["fingerprint"] != stale and fresh["preset"] == "story_only"
    assert stored(world) == before
    # The fresh review's fingerprint is accepted.
    assert apply(world, target, "story_only", fingerprint=fresh["fingerprint"]).status_code == 200


def test_a_missing_or_foreign_fingerprint_is_refused(world: World) -> None:
    everything(world, "private")
    target = make_target(world, "link")
    before = stored(world)
    assert world.owner.post(target.apply_path, json={"preset": "story_only"}).status_code == 422
    assert error_code(apply(world, target, "story_only", fingerprint="0" * 16)) == "preset_preview_is_stale"
    other = review_of(world, target, "planned_trip")["fingerprint"]
    assert error_code(apply(world, target, "story_only", fingerprint=other)) == "preset_preview_is_stale"
    unknown = world.owner.post(target.apply_path, json={"preset": "everything", "fingerprint": "x"})
    assert unknown.status_code == 422
    assert stored(world) == before


# --- widening ---------------------------------------------------------------------------------------


@pytest.mark.parametrize("kind", KINDS)
def test_widening_a_live_audience_needs_an_acknowledgement_and_a_draft_does_not(world: World, kind: str) -> None:
    everything(world, "private")
    live = make_target(world, kind, live=True)
    before = stored(world)

    refused = apply(world, live, "story_only")
    assert refused.status_code == 409
    assert error_code(refused) == "preset_widening_needs_acknowledgement"
    detail = refused.json()["detail"]
    assert detail["audience"] == live.id
    assert detail["counts"] == {"travel_update": 3, "media_derivative": 3}
    assert names(world, detail["widened"]) == TARGETS["story_only"]
    # Nothing is stored and the revision is not claimed.
    assert stored(world) == before

    accepted = apply(world, live, "story_only", confirm_widening=True)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["audience"]["revision"] == live.read()["revision"] == before_revision(before, live) + 1
    # The acknowledgement is part of the audit record.
    assert audit_details(world, kind)["widening_acknowledged"] is True
    assert audit_details(world, kind)["live"] is True


def before_revision(before: dict, target: Target) -> int:
    if target.kind == "public":
        return before["public"][0][0]
    section = before["links"] if target.kind == "link" else before["members"]
    return section[target.id.partition(":")[2]][0]


def test_a_draft_audience_needs_no_acknowledgement_even_when_it_widens(world: World) -> None:
    everything(world, "private")
    for kind in KINDS:
        target = make_target(world, kind)
        assert review_of(world, target, "story_only")["requires_acknowledgement"] is False
        assert apply(world, target, "story_only").status_code == 200
        assert audit_details(world, kind)["widening_acknowledged"] is False


@pytest.mark.parametrize("kind", ["link", "member"])
def test_narrowing_a_live_audience_needs_no_acknowledgement(world: World, kind: str) -> None:
    everything(world, "everyone")
    live = make_target(world, kind, live=True)
    response = apply(world, live, "story_only")
    assert response.status_code == 200, response.text
    assert (
        response.json()["review"]["comparison"]["narrowed"] and not response.json()["review"]["comparison"]["widened"]
    )
    assert audit_details(world, kind)["widening_acknowledged"] is False


# --- atomicity --------------------------------------------------------------------------------------


@pytest.mark.parametrize("kind", KINDS)
def test_a_failure_after_the_writes_leaves_everything_unchanged(
    world: World, kind: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_extras(world)
    everything(world, "private")
    target = make_target(world, kind)
    fingerprint = review_of(world, target, "planned_trip")["fingerprint"]
    before = stored(world)

    def boom(*_args, **_kwargs):
        raise RuntimeError("the audit trail is down")

    monkeypatch.setattr(sharing_presets, "record_audit_event", boom)
    monkeypatch.setattr(sharing_presets, "record_collection_event", boom)
    with pytest.raises(RuntimeError):
        apply(world, target, "planned_trip", fingerprint=fingerprint)
    # The promotions, the scope, the label, the revision: none of it was committed.
    assert stored(world) == before
    monkeypatch.undo()
    assert apply(world, target, "planned_trip", fingerprint=fingerprint).status_code == 200


@pytest.mark.parametrize("kind", KINDS)
def test_a_scope_that_fails_validation_rolls_back_the_promotions(
    world: World, kind: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    everything(world, "private")
    target = make_target(world, kind)
    fingerprint = review_of(world, target, "story_only")["fingerprint"]
    before = stored(world)

    def refuse(*_args, **_kwargs):
        raise ScopeError("Update is no longer part of this trip", code="scope_unavailable")

    monkeypatch.setattr(sharing_presets, "prepare_scope", refuse)
    response = apply(world, target, "story_only", fingerprint=fingerprint)
    assert response.status_code == 422 and response.json()["errors"][0]["code"] == "scope_unavailable"
    assert stored(world) == before


# --- a preset never writes everyone ----------------------------------------------------------------


def test_the_planner_refuses_a_plan_that_would_promote_an_everyone_record(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    everything(world, "everyone")
    target = make_target(world, "link")
    real = sharing_presets.plan_preset

    def faulty(trip, audience, preset_id):
        plan = real(trip, audience, preset_id)
        plan.changes.append(sharing_presets.Change("promote", "travel_update", world.ids["U1"][1]))
        return plan

    monkeypatch.setattr(sharing_presets, "plan_preset", faulty)
    fingerprint = review_of(world, target, "story_only")["fingerprint"]
    before = stored(world)
    response = apply(world, target, "story_only", fingerprint=fingerprint)
    assert response.status_code == 422 and error_code_of(response) == "preset_must_not_write_everyone"
    assert stored(world) == before


def test_a_write_of_everyone_is_caught_and_rolled_back(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    everything(world, "private")
    target = make_target(world, "link")
    fingerprint = review_of(world, target, "story_only")["fingerprint"]
    before = stored(world)

    def wrong(trip, kind, record_id, _visibility):
        record = next(item for item in COLLECTIONS[kind](trip) if item.id == record_id)
        record.visibility = Visibility.EVERYONE
        return record

    monkeypatch.setattr(sharing_presets, "set_visibility", wrong)
    # The scope check would refuse listing an everyone record first (422); take it away to reach the last guard.
    monkeypatch.setattr(sharing_presets, "prepare_scope", lambda _trip, scope, _stored=None, **_options: scope)
    response = apply(world, target, "story_only", fingerprint=fingerprint)
    assert response.status_code == 422 and error_code_of(response) == "preset_must_not_write_everyone"
    assert stored(world) == before


# --- other audiences --------------------------------------------------------------------------------


def outputs(world: World, tokens: dict[str, str], slug: str) -> dict[str, str]:
    """What every visitor-facing audience of the trip receives, as the visitors read it."""
    anonymous = TestClient(world_app())
    found = {"public": anonymous.get(f"/api/public/trips/{slug}").text}
    for name, token in tokens.items():
        found[name] = anonymous.get(f"/api/shared/{token}").text
    return found


def world_app():
    from app.main import app

    return app


@pytest.mark.parametrize("preset", PRESET_IDS)
def test_applying_to_one_audience_leaves_every_other_audience_exactly_as_it_was(world: World, preset: str) -> None:
    add_extras(world)
    for name in ("U1", "U2", "A", "R1", "V1", "V2", "ST1"):
        vis(world, name, "private")
    for name in ("U3", "V3", "P1"):
        vis(world, name, "custom")
    slug = world.publish()
    first, first_token = world.active_link(items=world.ref("U3", "V3"))
    second, second_token = world.active_link(items=world.ref("U3"))
    tokens = {"first": first_token, "second": second_token}
    owner = world.owner

    def read(link: dict) -> dict:
        return owner.get(f"{world.base}/share-links/{link['id']}").json()

    for applied_to in ("public", "second"):
        before = outputs(world, tokens, slug)
        if applied_to == "public":
            target = Target(
                "public",
                "public",
                f"{world.base}/public-projection/preset/review",
                f"{world.base}/public-projection/preset",
                lambda: owner.get(f"{world.base}/public-projection").json(),
            )
        else:
            path = f"{world.base}/share-links/{second['id']}"
            target = Target(
                "link", f"link:{second['id']}", f"{path}/preset/review", f"{path}/preset", lambda: read(second)
            )
        response = apply(world, target, preset, confirm_widening=True)
        assert response.status_code == 200, response.text
        after = outputs(world, tokens, slug)
        for name, text in before.items():
            if name == applied_to:
                continue
            assert after[name] == text, f"{preset} on {applied_to} changed what {name} receives"
        # The audience that was targeted did change, unless the preset left it as it was.
    assert read(first)["applied_preset"] is None  # a label belongs to one audience only


# --- re-apply, exceptions, idempotence --------------------------------------------------------------


def edit_items(world: World, link_id: str, items: list[dict]) -> None:
    response = world.owner.patch(
        f"{world.base}/share-links/{link_id}", json={"scope": link_scope(items=items, defaults=MONTH)}
    )
    assert response.status_code == 200, response.text


def test_manual_edits_keep_the_label_and_show_as_exceptions_and_a_re_apply_resets_them(world: World) -> None:
    add_extras(world)
    everything(world, "private")
    target = make_target(world, "link")
    link_id = target.id.partition(":")[2]
    assert apply(world, target, "story_only").status_code == 200
    # The owner hides one update and shows one visit by hand (a visit is custom and listed).
    vis(world, "V1", "custom")
    edit_items(world, link_id, world.ref("U2", "U3", "V1"))

    current = target.read()
    assert current["applied_preset"] == "story_only"  # a label, not a rule
    exceptions = current["preset_exceptions"]
    assert names(world, exceptions["hidden"]) == {"U1"} and names(world, exceptions["shown"]) == {"V1"}
    assert exceptions["count"] == 2 and {item["label"] for item in exceptions["hidden"]} == {"Update A"}
    # The Sharing check line.
    overview = world.owner.get(f"/api/trips/{world.id}/overview").json()
    audience = next(item for item in overview["audiences"] if item["id"] == target.id.partition(":")[2])
    assert (audience["preset"], audience["preset_exceptions"]) == ("story_only", 2)

    review = review_of(world, target, "story_only")
    assert {(item["reason"], *names(world, [item])) for item in review["replaces_exceptions"]} == {
        ("left_out_by_you", "U1")
    }
    assert {(c["action"], *names(world, [c])) for c in review["changes"]} == {("list", "U1"), ("unlist", "V1")}

    response = apply(world, target, "story_only", fingerprint=review["fingerprint"])
    assert response.status_code == 200, response.text
    after = target.read()
    assert after["preset_exceptions"]["count"] == 0
    assert received_names(world, after["scope"]) == TARGETS["story_only"]
    assert stored(world)["visibility"][world.ids["V1"]] == "custom"  # still custom, just no longer listed


def test_exceptions_follow_new_and_deleted_records_and_everyone_records_on_the_public_view(world: World) -> None:
    everything(world, "private")
    world.publish()
    public = make_target(world, "public", live=False)
    assert apply(world, public, "story_only", confirm_widening=True).status_code == 200
    assert public.read()["preset_exceptions"]["count"] == 0

    # A record created later is private and is not in the audience, but the preset would select it today.
    created = world.owner.post(f"{world.base}/travel-updates", json=World._update("Later update"))
    assert created.status_code == 201
    hidden = public.read()["preset_exceptions"]["hidden"]
    assert [item["label"] for item in hidden] == ["Later update"]
    assert world.owner.delete(f"{world.base}/travel-updates/{created.json()['id']}").status_code == 204
    assert public.read()["preset_exceptions"]["count"] == 0

    # An everyone record outside the preset reaches the public view whatever the preset says.
    vis(world, "V1", "everyone")
    shown = public.read()["preset_exceptions"]["shown"]
    assert names(world, shown) == {"V1"}


def test_applying_the_same_preset_again_writes_nothing(world: World) -> None:
    everything(world, "private")
    for kind in KINDS:
        target = make_target(world, kind)
        assert apply(world, target, "story_only").status_code == 200
        before, audit = stored(world), audit_count(world, kind)
        again = apply(world, target, "story_only")
        assert again.status_code == 200, again.text
        assert again.json()["applied"] is False and again.json()["review"]["changes"] == []
        assert again.json()["audience"]["revision"] == target.read()["revision"]
        assert stored(world) == before and audit_count(world, kind) == audit


def test_a_plan_that_changes_nothing_still_sets_the_label_once(world: World) -> None:
    everything(world, "private")
    for name in ("U1", "U2", "U3"):
        vis(world, name, "custom")
    target = make_target(world, "link")
    link_id = target.id.partition(":")[2]
    edit_items(world, link_id, world.ref("U1", "U2", "U3"))
    before = target.read()
    first = apply(world, target, "story_only")
    assert first.status_code == 200 and first.json()["review"]["changes"] == []
    assert first.json()["applied"] is True  # the audience matched, but it now says which preset it matches
    assert first.json()["audience"]["applied_preset"] == "story_only"
    assert first.json()["audience"]["revision"] == before["revision"] + 1
    assert apply(world, target, "story_only").json()["applied"] is False


# --- the refusals ----------------------------------------------------------------------------------


def test_a_plan_beyond_the_scope_limits_is_refused_and_nothing_changes(world: World) -> None:
    everything(world, "private")
    _bulk_updates(world, 200)
    for kind in KINDS:
        target = make_target(world, kind)
        before = stored(world)
        response = apply(world, target, "story_only")
        assert response.status_code == 409, response.text
        assert error_code(response) == "preset_too_large"
        assert response.json()["detail"]["max_items"] == 200 and response.json()["detail"]["items"] == 203
        assert stored(world) == before


@pytest.mark.parametrize("kind", ["link", "member"])
def test_a_revoked_audience_cannot_be_given_a_preset(world: World, kind: str) -> None:
    everything(world, "private")
    target = make_target(world, kind, live=True)
    fingerprint = review_of(world, target, "story_only")["fingerprint"]
    if kind == "link":
        assert (
            world.owner.post(f"{world.base}/share-links/{target.id.partition(':')[2]}/revoke", json={}).status_code
            == 200
        )
    else:
        collection_id = target.apply_path.split("/")[3]
        assert world.owner.post(f"/api/collections/{collection_id}/revoke", json={}).status_code == 200
    assert apply(world, target, "story_only", fingerprint=fingerprint).status_code == 409


@pytest.mark.parametrize("kind", KINDS)
def test_another_owner_cannot_apply_and_nothing_changes(world: World, kind: str) -> None:
    everything(world, "private")
    target = make_target(world, kind)
    fingerprint = review_of(world, target, "story_only")["fingerprint"]
    before = stored(world)
    outsider = client_for("owner-2")
    assert apply(world, target, "story_only", fingerprint=fingerprint, client=outsider).status_code == 404
    client_for("owner-1")
    assert stored(world) == before


def test_every_apply_route_requires_the_owner(world: World) -> None:
    from app.auth import current_subject
    from app.main import app

    targets = [make_target(world, kind) for kind in KINDS]
    app.dependency_overrides.pop(current_subject)
    anonymous = TestClient(app)
    for target in targets:
        response = anonymous.post(target.apply_path, json={"preset": "story_only", "fingerprint": "x"})
        assert response.status_code == 401, target.apply_path


# --- revisions --------------------------------------------------------------------------------------


@pytest.mark.parametrize("kind", KINDS)
def test_a_stale_if_match_is_a_412_with_the_current_audience_and_nothing_changes(world: World, kind: str) -> None:
    everything(world, "private")
    target = make_target(world, kind)
    revision = target.read()["revision"]
    fingerprint = review_of(world, target, "story_only")["fingerprint"]
    before = stored(world)

    stale = apply(world, target, "story_only", fingerprint=fingerprint, headers={"If-Match": f'"{revision + 5}"'})
    assert stale.status_code == 412
    assert error_code(stale) == "scope_revision_conflict"
    assert stale.json()["detail"]["current"]["revision"] == revision
    assert stored(world) == before
    malformed = apply(world, target, "story_only", fingerprint=fingerprint, headers={"If-Match": "nope"})
    assert malformed.status_code == 400

    fresh = apply(world, target, "story_only", fingerprint=fingerprint, headers={"If-Match": f'"{revision}"'})
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["audience"]["revision"] == revision + 1


def test_a_refused_widening_does_not_claim_the_revision(world: World) -> None:
    everything(world, "private")
    target = make_target(world, "link", live=True)
    revision = target.read()["revision"]
    refused = apply(world, target, "story_only", headers={"If-Match": f'"{revision}"'})
    assert refused.status_code == 409 and target.read()["revision"] == revision
    accepted = apply(world, target, "story_only", confirm_widening=True, headers={"If-Match": f'"{revision}"'})
    assert accepted.status_code == 200 and target.read()["revision"] == revision + 1


# --- the audit event ---------------------------------------------------------------------------------


def audit_count(world: World, kind: str) -> int:
    with Session(engine) as session:
        if kind == "member":
            return session.scalar(
                select(func.count())
                .select_from(CollectionAuditEvent)
                .where(CollectionAuditEvent.kind == "collection.member_preset_apply")
            )
        return session.scalar(
            select(func.count()).select_from(AuditEvent).where(AuditEvent.kind == AuditEventKind.AUDIENCE_PRESET_APPLY)
        )


def audit_details(world: World, kind: str) -> dict:
    with Session(engine) as session:
        if kind == "member":
            event = session.scalars(
                select(CollectionAuditEvent)
                .where(CollectionAuditEvent.kind == "collection.member_preset_apply")
                .order_by(CollectionAuditEvent.occurred_at.desc())
            ).first()
        else:
            event = session.scalars(
                select(AuditEvent)
                .where(AuditEvent.kind == AuditEventKind.AUDIENCE_PRESET_APPLY)
                .order_by(AuditEvent.occurred_at.desc())
            ).first()
        assert event is not None
        return event.details


@pytest.mark.parametrize("kind", KINDS)
def test_an_apply_is_one_audit_event_with_ids_and_counts_and_no_owner_text(world: World, kind: str) -> None:
    add_extras(world)
    everything(world, "private")
    target = make_target(world, kind, live=True)
    visibility_events = len(world.owner.get(f"{world.base}/audit-events").json())
    assert apply(world, target, "planned_trip", confirm_widening=True).status_code == 200
    assert audit_count(world, kind) == 1
    details = audit_details(world, kind)
    assert details["preset"] == "planned_trip" and details["audience"] == target.id
    assert details["on_creation"] is False and details["widening_acknowledged"] is True
    assert details["widened"] == {
        "area": 2,
        "visit": 4,
        "stay": 2,
        "route": 2,
        "travel_update": 3,
        "media_derivative": 3,
    }
    assert details["narrowed"] == {} and details["precision"] == {"before": None, "after": "month"}
    assert details["changes"] == {"promote": 13}
    assert details["needs_decision"]  # kinds and counts of what the preset did not sweep in
    assert set(details["needs_decision"].values()) <= {1, 2, 3}
    assert details["scope_version_before"] != details["scope_version_after"]
    # Never a title, label, note or caption: only ids, fingerprints and counts.
    text = json.dumps(details)
    for owner_text in ("Update A", "Alpha Town", "Visit A", "Friends", "Family", "PRIVATE NOTE", "Photo of A"):
        assert owner_text not in text
    # The per-record visibility events are not written for a preset's promotions: this one event covers them.
    events = world.owner.get(f"{world.base}/audit-events").json()
    assert len(events) == visibility_events + (kind != "member")


# --- the label never reaches a visitor ---------------------------------------------------------------


def test_the_label_and_exceptions_are_owner_only(world: World) -> None:
    add_extras(world)
    everything(world, "private")
    slug = world.publish()
    link, token = world.active_link()
    collection, member = make_member(world, activate=True)
    for target in (
        Target("public", "public", "", f"{world.base}/public-projection/preset", lambda: {}),
        Target("link", "", "", f"{world.base}/share-links/{link['id']}/preset", lambda: {}),
        Target("member", "", "", f"/api/collections/{collection['id']}/members/{member['id']}/preset", lambda: {}),
    ):
        review_path = target.apply_path + "/review"
        fingerprint = world.owner.post(review_path, json={"preset": "planned_trip"}).json()["fingerprint"]
        assert apply(world, target, "planned_trip", fingerprint=fingerprint, confirm_widening=True).status_code == 200

    collection_token = world.owner.get(f"/api/collections/{collection['id']}").json()["token"]
    anonymous = TestClient(world_app())
    bodies = [
        anonymous.get(f"/api/public/trips/{slug}").text,
        anonymous.get("/api/public/trips").text,
        anonymous.get(f"/api/shared/{token}").text,
        anonymous.get(f"/api/shared/{collection_token}").text,
        anonymous.get(f"/api/shared/{collection_token}/trips/{member['id']}").text,
    ]
    for text in bodies:
        assert "planned_trip" not in text
        for word in ("preset", "applied_", "exception"):
            assert word not in text.lower()


def test_the_label_is_never_read_by_delivery(world: World) -> None:
    """Changing or clearing the label changes what no audience receives: it is a display label, not a rule."""
    everything(world, "private")
    target = make_target(world, "link", live=True)
    assert apply(world, target, "planned_trip", confirm_widening=True).status_code == 200
    link_id = target.id.partition(":")[2]
    before = received_names(world, target.read()["scope"])
    with Session(engine) as session:
        link = session.get(ShareLink, link_id)
        assert link is not None
        link.applied_preset, link.applied_preset_at = "story_only", None
        session.commit()
    assert received_names(world, target.read()["scope"]) == before
    with Session(engine) as session:
        link = session.get(ShareLink, link_id)
        assert link is not None
        link.applied_preset = "a_preset_from_a_newer_application"
        session.commit()
    read = target.read()
    assert received_names(world, read["scope"]) == before
    assert read["applied_preset"] == "a_preset_from_a_newer_application" and read["preset_exceptions"] is None


def test_rotating_a_link_keeps_its_label(world: World) -> None:
    everything(world, "private")
    target = make_target(world, "link", live=True)
    assert apply(world, target, "story_only", confirm_widening=True).status_code == 200
    rotated = world.owner.post(f"{world.base}/share-links/{target.id.partition(':')[2]}/rotate", json={})
    assert rotated.status_code == 200, rotated.text
    assert rotated.json()["applied_preset"] == "story_only" and rotated.json()["preset_exceptions"]["count"] == 0


def test_the_label_is_part_of_the_owner_export(world: World) -> None:
    everything(world, "private")
    target = make_target(world, "link")
    assert apply(world, target, "story_only").status_code == 200
    document = world.owner.get(f"{world.base}/export").json()
    (link,) = document["publication"]["share_links"]
    assert link["applied_preset"] == "story_only" and link["applied_preset_at"]


# --- creating an audience from a preset --------------------------------------------------------------


def test_a_new_link_can_start_from_a_preset_in_the_same_transaction(world: World) -> None:
    everything(world, "private")
    response = world.owner.post(
        f"{world.base}/share-links",
        json={"label": "Friends", "scope": link_scope(defaults=MONTH), "preset": "story_only"},
    )
    assert response.status_code == 201, response.text
    link = response.json()
    assert link["applied_preset"] == "story_only" and link["revision"] == 1
    assert received_names(world, link["scope"]) == TARGETS["story_only"]
    assert "everyone" not in stored(world)["visibility"].values()
    with Session(engine) as session:
        kinds = [event.kind for event in session.scalars(select(AuditEvent).order_by(AuditEvent.occurred_at))]
    assert kinds.count(AuditEventKind.SHARE_LINK_CREATE) == 1 and kinds.count(AuditEventKind.AUDIENCE_PRESET_APPLY) == 1
    assert audit_details(world, "link")["on_creation"] is True


def test_a_new_link_without_a_preset_starts_as_before(world: World) -> None:
    everything(world, "private")
    link = world.link()
    assert link["applied_preset"] is None and link["applied_preset_at"] is None and link["preset_exceptions"] is None
    assert audit_count(world, "link") == 0


def test_a_new_link_with_a_preset_that_cannot_be_applied_is_not_created(world: World) -> None:
    everything(world, "private")
    _bulk_updates(world, 200)
    response = world.owner.post(
        f"{world.base}/share-links", json={"label": "Friends", "scope": link_scope(), "preset": "story_only"}
    )
    assert response.status_code == 409 and error_code(response) == "preset_too_large"
    assert world.owner.get(f"{world.base}/share-links").json() == []
    assert set(stored(world)["visibility"].values()) == {"private"}
    assert (
        world.owner.post(
            f"{world.base}/share-links", json={"label": "Friends", "scope": link_scope(), "preset": "everything"}
        ).status_code
        == 422
    )


@pytest.mark.parametrize("active", [False, True])
def test_a_new_collection_member_can_start_from_a_preset(world: World, active: bool) -> None:
    everything(world, "private")
    owner = world.owner
    collection = owner.post("/api/collections", json={"label": "Family", "title": None}).json()
    if active:
        assert (
            owner.post(f"/api/collections/{collection['id']}/activate", json={"expires_in_days": 30}).status_code == 200
        )
    response = owner.post(
        f"/api/collections/{collection['id']}/members",
        json={"trip_id": world.id, "scope": link_scope(defaults=MONTH), "preset": "story_and_route"},
    )
    assert response.status_code == 201, response.text
    (member,) = response.json()["members"]
    assert member["applied_preset"] == "story_and_route" and member["revision"] == 1
    assert received_names(world, member["scope"]) == TARGETS["story_and_route"]
    assert member["delivered_records"] > 0
    assert audit_details(world, "member")["on_creation"] is True
    assert audit_details(world, "member")["widening_acknowledged"] is False
