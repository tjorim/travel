"""Alternative groups (#238): private, owner-confirmed sets of stays, visits or routes and the one choice."""

import json
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.database import Base, get_session
from app.main import app
from app.models import AlternativeGroupMember, AuditEvent, Stay, Visit

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

CANARY = "ALT-CANARY-GROUP-LABEL"


def override_session() -> Generator[Session]:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def client_for(subject: str) -> TestClient:
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[current_subject] = lambda: subject
    return TestClient(app)


def setup_function() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def teardown_function() -> None:
    app.dependency_overrides.clear()


class Trip:
    """A synthetic trip with helpers to add the records alternatives are made of."""

    def __init__(self, client: TestClient) -> None:
        self.client = client
        response = client.post("/api/trips", json={"title": "Exampleland 2054"})
        assert response.status_code == 201, response.text
        self.id = response.json()["id"]
        self.path = f"/api/trips/{self.id}"
        self.areas: dict[str, str] = {}

    def area(self, label: str) -> str:
        if label not in self.areas:
            response = self.client.post(f"{self.path}/areas", json={"label": label, "country_code": "TW"})
            assert response.status_code == 201, response.text
            self.areas[label] = response.json()["id"]
        return self.areas[label]

    def stay(self, check_in: str, check_out: str, name: str, status: str = "idea", area: str = "Tainan") -> str:
        response = self.client.post(
            f"{self.path}/stays",
            json={
                "check_in_date": check_in,
                "check_out_date": check_out,
                "area_id": self.area(area),
                "status": status,
                "property_name": name,
            },
        )
        assert response.status_code == 201, response.text
        return response.json()["id"]

    def visit(self, title: str, starts_on: str | None, ends_on: str | None, status: str = "idea") -> str:
        response = self.client.post(
            f"{self.path}/visits",
            json={
                "title": title,
                "area_id": self.area("Tainan"),
                "status": status,
                "starts_on": starts_on,
                "ends_on": ends_on,
            },
        )
        assert response.status_code == 201, response.text
        return response.json()["id"]

    def route(self, departs_on: str | None, start: str = "Tainan", end: str = "Taipei", status: str = "idea") -> str:
        response = self.client.post(
            f"{self.path}/routes",
            json={
                "mode": "train",
                "status": status,
                "departure_area_id": self.area(start),
                "arrival_area_id": self.area(end),
                "departs_on": departs_on,
            },
        )
        assert response.status_code == 201, response.text
        return response.json()["id"]

    def group(self, kind: str, ids: list[str], label: str | None = None) -> dict:
        response = self.client.post(
            f"{self.path}/alternative-groups", json={"kind": kind, "member_ids": ids, "label": label}
        )
        assert response.status_code == 201, response.text
        return response.json()

    def statuses(self, collection: str) -> dict[str, str]:
        return {item["id"]: item["status"] for item in self.client.get(f"{self.path}/{collection}").json()}

    def suggestions(self) -> list[dict]:
        response = self.client.get(f"{self.path}/alternative-groups/suggestions")
        assert response.status_code == 200, response.text
        return response.json()


def test_stay_suggestions_chain_overlapping_but_not_identical_nights() -> None:
    trip = Trip(client_for("owner-1"))
    a = trip.stay("2054-04-01", "2054-04-04", "Hotel A")
    b = trip.stay("2054-04-02", "2054-04-05", "Hotel B")  # overlaps A by two nights, different dates
    c = trip.stay("2054-04-04", "2054-04-06", "Hotel C")  # checks in the morning A leaves: overlaps B only
    trip.stay("2054-04-06", "2054-04-08", "Hotel D")  # starts the morning C leaves: touches, no shared night
    trip.stay("2054-04-02", "2054-04-04", "Hotel E", status="planned")  # planned, not a candidate
    trip.stay("2054-05-01", "2054-05-03", "Lonely hotel")  # one idea alone is no alternative
    (suggestion,) = trip.suggestions()
    assert suggestion["kind"] == "stay" and suggestion["reason"] == "overlapping_nights"
    assert sorted(suggestion["member_ids"]) == sorted([a, b, c])
    assert (suggestion["starts_on"], suggestion["ends_on"]) == ("2054-04-01", "2054-04-06")


def test_suggestions_for_visits_and_routes_and_nothing_is_stored_or_grouped_automatically() -> None:
    trip = Trip(client_for("owner-1"))
    # Two multi-day visits sharing a day are alternatives; two one-day visits on one day are both done.
    long_a = trip.visit("Lakeside week", "2054-05-01", "2054-05-04")
    long_b = trip.visit("Mountain week", "2054-05-04", "2054-05-07")
    trip.visit("Museum", "2054-05-10", "2054-05-10")
    trip.visit("Market", "2054-05-10", "2054-05-10")
    trip.visit("Someday", None, None)
    train_a = trip.route("2054-05-02")
    train_b = trip.route("2054-05-02")
    trip.route("2054-05-03")
    trip.route("2054-05-02", start="Taipei", end="Tainan")
    suggestions = {item["kind"]: item for item in trip.suggestions()}
    assert set(suggestions) == {"visit", "route"}
    assert sorted(suggestions["visit"]["member_ids"]) == sorted([long_a, long_b])
    assert suggestions["visit"]["reason"] == "overlapping_days"
    assert sorted(suggestions["route"]["member_ids"]) == sorted([train_a, train_b])
    assert suggestions["route"]["reason"] == "same_journey"
    # Suggesting stores nothing: the ideas stay ungrouped until the owner confirms.
    assert trip.client.get(f"{trip.path}/alternative-groups").json() == []


def test_a_confirmed_group_leaves_the_suggestions_and_keeps_its_members() -> None:
    trip = Trip(client_for("owner-1"))
    a = trip.stay("2054-04-01", "2054-04-04", "Hotel A")
    b = trip.stay("2054-04-02", "2054-04-05", "Hotel B")
    c = trip.stay("2054-04-03", "2054-04-04", "Hotel C")
    group = trip.group("stay", [a, b], CANARY)
    assert group["label"] == CANARY and group["chosen_id"] is None
    assert sorted(member["record_id"] for member in group["members"]) == sorted([a, b])
    assert group["members"][0]["stay"]["property_name"] == "Hotel A"
    # C is alone now: one ungrouped idea is not a suggestion.
    assert trip.suggestions() == []
    assert trip.client.get(f"{trip.path}/alternative-groups/{group['id']}").json()["id"] == group["id"]
    added = trip.client.patch(
        f"{trip.path}/alternative-groups/{group['id']}", json={"add_member_ids": [c], "label": None}
    ).json()
    assert sorted(member["record_id"] for member in added["members"]) == sorted([a, b, c])
    assert added["label"] is None
    removed = trip.client.patch(f"{trip.path}/alternative-groups/{group['id']}", json={"remove_member_ids": [b]})
    assert sorted(member["record_id"] for member in removed.json()["members"]) == sorted([a, c])
    # Taking a record out of the group leaves the record as it was.
    assert trip.statuses("stays")[b] == "idea"
    assert trip.client.delete(f"{trip.path}/alternative-groups/{group['id']}").status_code == 204
    assert set(trip.statuses("stays")) == {a, b, c}


def test_group_membership_rules() -> None:
    trip = Trip(client_for("owner-1"))
    a = trip.stay("2054-04-01", "2054-04-04", "Hotel A")
    b = trip.stay("2054-04-01", "2054-04-04", "Hotel B")
    visit = trip.visit("Lake", "2054-05-01", "2054-05-03")
    group = trip.group("stay", [a, b])
    path = f"{trip.path}/alternative-groups"
    # A record is in one group at most.
    again = trip.client.post(path, json={"kind": "stay", "member_ids": [a, trip.stay("2054-04-01", "2054-04-02", "C")]})
    assert again.status_code == 409
    assert again.json()["errors"][0]["code"] == "a_record_is_in_at_most_one_alternative_group"
    # A group holds one kind, and records of another kind or an unknown id are not found.
    other = trip.stay("2054-06-01", "2054-06-02", "Z")
    assert trip.client.post(path, json={"kind": "stay", "member_ids": [other, visit]}).status_code == 404
    assert trip.client.post(path, json={"kind": "stay", "member_ids": ["nope", "nada"]}).status_code == 404
    # Two different records at least.
    assert trip.client.post(path, json={"kind": "stay", "member_ids": [other]}).status_code == 422
    assert trip.client.post(path, json={"kind": "stay", "member_ids": [other, other]}).status_code == 422
    assert trip.client.patch(f"{path}/{group['id']}", json={"add_member_ids": [visit]}).status_code == 404
    assert trip.client.patch(f"{path}/{group['id']}", json={"remove_member_ids": [other]}).status_code == 404
    assert trip.client.patch(f"{path}/{group['id']}", json={"colour": "red"}).status_code == 422


def test_deleting_a_record_leaves_its_group_and_deleting_the_trip_removes_the_groups() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    a = trip.stay("2054-04-01", "2054-04-04", "Hotel A")
    b = trip.stay("2054-04-01", "2054-04-04", "Hotel B")
    group = trip.group("stay", [a, b])
    assert owner.delete(f"{trip.path}/stays/{a}").status_code == 204
    remaining = owner.get(f"{trip.path}/alternative-groups/{group['id']}").json()
    assert [member["record_id"] for member in remaining["members"]] == [b]
    assert owner.delete(trip.path).status_code == 204
    with TestingSessionLocal() as session:
        assert session.scalars(select(AlternativeGroupMember)).all() == []


def test_choosing_plans_one_and_cancels_the_others_in_one_operation_with_an_audit_event() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    a = trip.stay("2054-04-01", "2054-04-04", "Hotel A")
    b = trip.stay("2054-04-02", "2054-04-05", "Hotel B")
    c = trip.stay("2054-04-01", "2054-04-04", "Hotel C", status="confirmed")  # mixed statuses
    group = trip.group("stay", [a, b, c])
    chosen = owner.post(f"{trip.path}/alternative-groups/{group['id']}/choose", json={"member_id": b})
    assert chosen.status_code == 200, chosen.text
    body = chosen.json()
    assert body["chosen_id"] == b and body["undoable"] is True and body["removed_ids"] == []
    assert sorted(body["cancelled_ids"]) == sorted([a, c])
    assert body["group"]["chosen_id"] == b
    assert trip.statuses("stays") == {a: "cancelled", b: "planned", c: "cancelled"}
    events = owner.get(f"{trip.path}/audit-events").json()
    (event,) = [item for item in events if item["kind"] == "alternative_group.choose"]
    assert event["id"] == body["event_id"] and event["target_type"] == "alternative_group"
    assert event["target_id"] == group["id"] and event["details"]["chosen_id"] == b
    # Only ids and statuses are recorded, never names or notes.
    assert "Hotel" not in json.dumps(event["details"])


def test_an_already_planned_or_confirmed_choice_keeps_its_status() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    a = trip.stay("2054-04-01", "2054-04-04", "Hotel A", status="confirmed")
    b = trip.stay("2054-04-01", "2054-04-04", "Hotel B", status="planned")
    group = trip.group("stay", [a, b])
    owner.post(f"{trip.path}/alternative-groups/{group['id']}/choose", json={"member_id": a})
    assert trip.statuses("stays") == {a: "confirmed", b: "cancelled"}


def test_undo_restores_statuses_and_visibility() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    a = trip.stay("2054-04-01", "2054-04-04", "Hotel A", status="planned")
    b = trip.stay("2054-04-01", "2054-04-04", "Hotel B")
    c = trip.stay("2054-04-01", "2054-04-04", "Hotel C", status="confirmed")
    assert owner.put(f"{trip.path}/visibility/stay/{a}", json={"visibility": "everyone"}).status_code == 200
    group = trip.group("stay", [a, b, c])
    base = f"{trip.path}/alternative-groups/{group['id']}"
    choice = owner.post(f"{base}/choose", json={"member_id": b}).json()
    # The rejected planned hotel was shared; a rejected alternative leaves the page, and that is audited.
    visibility = {item["id"]: item["visibility"] for item in owner.get(f"{trip.path}/stays").json()}
    assert visibility[a] == "private"
    assert trip.statuses("stays") == {a: "cancelled", b: "planned", c: "cancelled"}
    kinds = [item["kind"] for item in owner.get(f"{trip.path}/audit-events").json()]
    assert "record.visibility_change" in kinds

    undone = owner.post(f"{base}/undo-choice", json={"event_id": choice["event_id"]})
    assert undone.status_code == 200, undone.text
    assert undone.json()["chosen_id"] is None
    assert trip.statuses("stays") == {a: "planned", b: "idea", c: "confirmed"}
    restored = {item["id"]: item["visibility"] for item in owner.get(f"{trip.path}/stays").json()}
    assert restored[a] == "everyone"
    # There is nothing left to undo, and both the choice and its undo are in the audit trail.
    gone = owner.post(f"{base}/undo-choice")
    assert gone.status_code == 409
    assert gone.json()["errors"][0]["code"] == "there_is_no_alternative_choice_to_undo"
    kinds = [item["kind"] for item in owner.get(f"{trip.path}/audit-events").json()]
    assert kinds.count("alternative_group.choose") == 1 and kinds.count("alternative_group.undo_choice") == 1


def test_only_the_latest_choice_can_be_undone_and_it_restores_the_earlier_choice() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    a = trip.stay("2054-04-01", "2054-04-04", "Hotel A")
    b = trip.stay("2054-04-01", "2054-04-04", "Hotel B")
    group = trip.group("stay", [a, b])
    base = f"{trip.path}/alternative-groups/{group['id']}"
    first = owner.post(f"{base}/choose", json={"member_id": a}).json()
    second = owner.post(f"{base}/choose", json={"member_id": b}).json()
    assert trip.statuses("stays") == {a: "cancelled", b: "planned"}
    stale = owner.post(f"{base}/undo-choice", json={"event_id": first["event_id"]})
    assert stale.status_code == 409
    assert stale.json()["errors"][0]["code"] == "a_newer_alternative_choice_replaced_this_one"
    undone = owner.post(f"{base}/undo-choice", json={"event_id": second["event_id"]})
    assert undone.status_code == 200, undone.text
    assert undone.json()["chosen_id"] == a
    assert trip.statuses("stays") == {a: "planned", b: "cancelled"}


def test_undo_is_refused_when_a_member_was_edited_after_the_choice() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    a = trip.stay("2054-04-01", "2054-04-04", "Hotel A")
    b = trip.stay("2054-04-01", "2054-04-04", "Hotel B")
    group = trip.group("stay", [a, b])
    base = f"{trip.path}/alternative-groups/{group['id']}"
    owner.post(f"{base}/choose", json={"member_id": a})
    owner.patch(f"{trip.path}/stays/{b}", json={"status": "idea"})  # the owner changed their mind by hand
    refused = owner.post(f"{base}/undo-choice")
    assert refused.status_code == 409
    assert refused.json()["errors"][0]["code"] == "the_alternatives_changed_since_this_choice"
    assert trip.statuses("stays") == {a: "planned", b: "idea"}


def test_removing_the_others_deletes_them_and_cannot_be_undone() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    a = trip.stay("2054-04-01", "2054-04-04", "Hotel A")
    b = trip.stay("2054-04-01", "2054-04-04", "Hotel B")
    c = trip.stay("2054-04-02", "2054-04-04", "Hotel C")
    group = trip.group("stay", [a, b, c])
    base = f"{trip.path}/alternative-groups/{group['id']}"
    chosen = owner.post(f"{base}/choose", json={"member_id": a, "others": "remove"}).json()
    assert chosen["undoable"] is False and chosen["cancelled_ids"] == []
    assert sorted(chosen["removed_ids"]) == sorted([b, c])
    assert trip.statuses("stays") == {a: "planned"}
    assert [member["record_id"] for member in chosen["group"]["members"]] == [a]
    refused = owner.post(f"{base}/undo-choice")
    assert refused.status_code == 409
    assert refused.json()["errors"][0]["code"] == "removed_alternatives_cannot_be_restored"


def test_choosing_among_visits_and_routes_and_removing_visits_keeps_positions_compact() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    first = trip.visit("Lake", "2054-05-01", "2054-05-03")
    lake = trip.visit("Lake B", "2054-05-02", "2054-05-04")
    last = trip.visit("Market", "2054-05-09", "2054-05-09", status="planned")
    group = trip.group("visit", [first, lake])
    owner.post(f"{trip.path}/alternative-groups/{group['id']}/choose", json={"member_id": lake, "others": "remove"})
    visits = owner.get(f"{trip.path}/visits").json()
    assert [(item["id"], item["position"], item["status"]) for item in visits] == [
        (lake, 0, "planned"),
        (last, 1, "planned"),
    ]
    one, two = trip.route("2054-05-02"), trip.route("2054-05-02")
    routes = trip.group("route", [one, two])
    owner.post(f"{trip.path}/alternative-groups/{routes['id']}/choose", json={"member_id": two})
    assert trip.statuses("routes") == {one: "cancelled", two: "planned"}


def test_another_owner_cannot_read_or_change_groups_or_use_their_records() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    a = trip.stay("2054-04-01", "2054-04-04", "Hotel A")
    b = trip.stay("2054-04-01", "2054-04-04", "Hotel B")
    group = trip.group("stay", [a, b], CANARY)
    base = f"{trip.path}/alternative-groups"
    intruder = client_for("owner-2")  # the subject override is global: owner-2 acts until the next client_for
    mine = Trip(intruder)
    mine_a = mine.stay("2054-04-01", "2054-04-04", "Mine A")
    mine_b = mine.stay("2054-04-01", "2054-04-04", "Mine B")
    for method, url, body in (
        ("get", base, None),
        ("get", f"{base}/suggestions", None),
        ("get", f"{base}/{group['id']}", None),
        ("post", base, {"kind": "stay", "member_ids": [a, b]}),
        ("patch", f"{base}/{group['id']}", {"label": "stolen"}),
        ("delete", f"{base}/{group['id']}", None),
        ("post", f"{base}/{group['id']}/choose", {"member_id": a}),
        ("post", f"{base}/{group['id']}/undo-choice", None),
    ):
        response = getattr(intruder, method)(url, **({"json": body} if body is not None else {}))
        assert response.status_code == 404, (method, url, response.text)
        assert CANARY not in response.text
    # The intruder's own trip cannot reach the owner's group or records through its own path.
    assert intruder.get(f"{mine.path}/alternative-groups/{group['id']}").status_code == 404
    assert (
        intruder.post(f"{mine.path}/alternative-groups", json={"kind": "stay", "member_ids": [a, mine_a]}).status_code
        == 404
    )
    assert intruder.get(f"{mine.path}/alternative-groups").json() == []
    assert mine_b
    client_for("owner-1")
    assert trip.statuses("stays") == {a: "idea", b: "idea"}
    assert owner.get(f"{base}/{group['id']}").json()["label"] == CANARY


def test_groups_never_reach_any_visitor_response() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    a = trip.stay("2054-04-01", "2054-04-04", "Hotel A", status="planned")
    b = trip.stay("2054-04-01", "2054-04-04", "Hotel B")
    visit = trip.visit("Lake", "2054-05-01", "2054-05-03", status="planned")
    other = trip.visit("Hills", "2054-05-02", "2054-05-04")
    route = trip.route("2054-05-02", status="planned")
    rival = trip.route("2054-05-02")
    groups = [
        trip.group("stay", [a, b], CANARY),
        trip.group("visit", [visit, other], CANARY),
        trip.group("route", [route, rival], CANARY),
    ]
    for kind, record in (("stay", a), ("visit", visit), ("route", route)):
        assert owner.put(f"{trip.path}/visibility/{kind}/{record}", json={"visibility": "everyone"}).status_code == 200
    published = owner.post(f"{trip.path}/public-projection/publish")
    assert published.status_code == 200, published.text
    link = owner.post(f"{trip.path}/share-links", json={"label": "Family"})
    assert link.status_code == 201, link.text
    owner.post(f"{trip.path}/share-links/{link.json()['id']}/preview")
    activated = owner.post(f"{trip.path}/share-links/{link.json()['id']}/activate", json={"expires_in_days": 30})
    assert activated.status_code == 200, activated.text
    anonymous = TestClient(app)
    shared = anonymous.get(f"/api/shared/{activated.json()['token']}")
    assert shared.status_code == 200 and len(shared.json()["stays"]) == 1
    bodies = [anonymous.get(f"/api/public/trips/{published.json()['slug']}").text, shared.text]
    for body in bodies:
        assert CANARY not in body and "alternative" not in body.lower()
        for group in groups:
            assert group["id"] not in body
    # Choosing one withdraws the rejected, still-shared stay from the audience.
    owner.post(f"{trip.path}/alternative-groups/{groups[0]['id']}/choose", json={"member_id": b})
    public = anonymous.get(f"/api/public/trips/{published.json()['slug']}").json()
    assert [item for item in public["stays"] if "alternative" in json.dumps(item)] == []
    assert len(public["stays"]) == 0  # the planned, shared hotel was rejected and made private


def test_export_lists_groups_explicitly_and_round_trips_membership() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    a = trip.stay("2054-04-01", "2054-04-04", "Hotel A")
    b = trip.stay("2054-04-02", "2054-04-05", "Hotel B")
    visit_a = trip.visit("Lake", "2054-05-01", "2054-05-03")
    visit_b = trip.visit("Hills", "2054-05-02", "2054-05-04")
    stays = trip.group("stay", [a, b], "Where to sleep")
    visits = trip.group("visit", [visit_a, visit_b])
    owner.post(f"{trip.path}/alternative-groups/{stays['id']}/choose", json={"member_id": a})
    document = json.loads(owner.get(f"{trip.path}/export").text)
    assert document["schema_version"] == "travel/trip-export@1"
    exported = {item["id"]: item for item in document["alternative_groups"]}
    assert set(exported) == {stays["id"], visits["id"]}
    assert exported[stays["id"]]["kind"] == "stay" and exported[stays["id"]]["label"] == "Where to sleep"
    key = lambda member: member["record_id"]  # noqa: E731
    assert sorted(exported[stays["id"]]["members"], key=key) == sorted(
        [{"record_id": a, "chosen": True}, {"record_id": b, "chosen": False}], key=key
    )
    assert sorted(member["record_id"] for member in exported[visits["id"]]["members"]) == sorted([visit_a, visit_b])
    # Every member and group is a plain id reference into the exported record lists.
    record_ids = {row["id"] for section in ("stays", "visits", "routes") for row in document[section]}
    assert {member["record_id"] for group in exported.values() for member in group["members"]} <= record_ids
    # The statuses exported with the records agree with the choice.
    assert {row["id"]: row["status"] for row in document["stays"]} == {a: "planned", b: "cancelled"}
    # Another owner's export never lists these groups.
    other = client_for("owner-2")
    assert json.loads(other.get(f"{Trip(other).path}/export").text)["alternative_groups"] == []


def test_deleting_a_group_member_record_through_the_orm_also_removes_its_membership() -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    a = trip.stay("2054-04-01", "2054-04-04", "Hotel A")
    b = trip.stay("2054-04-01", "2054-04-04", "Hotel B")
    visit = trip.visit("Lake", "2054-05-01", "2054-05-03")
    other = trip.visit("Hills", "2054-05-02", "2054-05-04")
    trip.group("stay", [a, b])
    trip.group("visit", [visit, other])
    assert owner.delete(f"{trip.path}/visits/{visit}").status_code == 204
    with TestingSessionLocal() as session:
        assert {row.record_id for row in session.scalars(select(AlternativeGroupMember))} == {a, b, other}
        assert session.get(Stay, a) is not None and session.get(Visit, visit) is None
        assert not [e for e in session.scalars(select(AuditEvent)) if e.kind.value.startswith("alternative")]


@pytest.mark.parametrize("others", ["cancel", "remove"])
def test_choosing_an_unknown_member_changes_nothing(others: str) -> None:
    owner = client_for("owner-1")
    trip = Trip(owner)
    a = trip.stay("2054-04-01", "2054-04-04", "Hotel A")
    b = trip.stay("2054-04-01", "2054-04-04", "Hotel B")
    outside = trip.stay("2054-04-01", "2054-04-04", "Hotel Z")
    group = trip.group("stay", [a, b])
    response = owner.post(
        f"{trip.path}/alternative-groups/{group['id']}/choose", json={"member_id": outside, "others": others}
    )
    assert response.status_code == 404
    assert trip.statuses("stays") == {a: "idea", b: "idea", outside: "idea"}
    assert owner.get(f"{trip.path}/audit-events").json() == []
    assert (
        owner.post(
            f"{trip.path}/alternative-groups/{group['id']}/choose", json={"member_id": a, "others": "maybe"}
        ).status_code
        == 422
    )
