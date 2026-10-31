"""Editing what visitors read on a shared location needs an explicit acknowledgement (#32)."""

from fastapi.testclient import TestClient
from test_publication import activate, client_for, create_trip, item, scope, setup_function, share, teardown_function  # noqa: F401

CODE = "visitor_visible_change_needs_acknowledgement"


class Setup:
    def __init__(self, owner: TestClient, visibility: str) -> None:
        self.owner = owner
        self.trip = create_trip(owner)
        self.base = f"/api/trips/{self.trip['id']}"
        self.taipei = owner.post(f"{self.base}/areas", json={"label": "Taipei", "country_code": "TW"}).json()
        self.tainan = owner.post(f"{self.base}/areas", json={"label": "Tainan", "country_code": "TW"}).json()
        self.hotel = owner.post(
            f"{self.base}/locations",
            json={
                "area_id": self.taipei["id"],
                "label": "Hotel Riverside",
                "display_name": "Hotel Riverside, 12 Guangming Road, Taipei",
                "address_line1": "12 Guangming Road",
                "postal_code": "112",
                "locality": "Taipei",
                "country_code": "TW",
                "latitude": 25.0331,
                "longitude": 121.5651,
            },
        ).json()
        self.path = f"{self.base}/locations/{self.hotel['id']}"
        self.visit = owner.post(
            f"{self.base}/visits",
            json={
                "position": 1,
                "title": "Stay",
                "location": {"existing_location_id": self.hotel["id"]},
            },
        ).json()
        self.route = owner.post(
            f"{self.base}/routes",
            json={
                "mode": "train",
                "status": "planned",
                "departure_area_id": self.taipei["id"],
                "arrival_area_id": self.tainan["id"],
                "departure_location": {"existing_location_id": self.hotel["id"]},
            },
        ).json()
        assert self.visit["location"]["id"] == self.hotel["id"], self.visit
        assert self.route["departure_location"]["id"] == self.hotel["id"], self.route
        self.link = None
        if visibility == "everyone":
            share(owner, self.trip["id"], "location", self.hotel["id"], "everyone")
            self.slug = owner.post(f"{self.base}/public-projection/publish").json()["slug"]
        elif visibility == "custom":
            entry = share(owner, self.trip["id"], "location", self.hotel["id"], "custom")
            self.link = owner.post(f"{self.base}/share-links", json={"label": "Family", "scope": scope(entry)}).json()
            activate(owner, self.trip["id"], self.link["id"])

    def events(self) -> list[dict]:
        events = self.owner.get(f"{self.base}/audit-events").json()
        return [event for event in events if event["kind"] == "location.update"]


def changes_of(response) -> dict[str, dict]:
    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["code"] == CODE
    assert response.json()["errors"][0]["code"] == CODE
    return {change["field"]: change for change in detail["changes"]}


def test_label_change_on_an_everyone_location_is_refused_with_before_after_and_audiences() -> None:
    setup = Setup(client_for("owner-1"), "everyone")
    refused = setup.owner.patch(setup.path, json={"label": "Hotel Elsewhere"})
    (change,) = changes_of(refused).values()
    assert change["field"] == "label"
    assert (change["before"], change["after"]) == ("Hotel Riverside", "Hotel Elsewhere")
    assert change["audiences"] == [{"id": "public", "label": None}]
    # Nothing was stored and nothing was audited.
    assert setup.owner.get(setup.path.rsplit("/", 1)[0]).json()[0]["label"] == "Hotel Riverside"
    assert setup.events() == []

    accepted = setup.owner.patch(setup.path, json={"label": "Hotel Elsewhere", "acknowledge_visitor_changes": True})
    assert accepted.status_code == 200 and accepted.json()["label"] == "Hotel Elsewhere"
    assert "acknowledge_visitor_changes" not in accepted.json()
    (event,) = setup.events()
    assert event["target_type"] == "location" and event["target_id"] == setup.hotel["id"]
    assert event["details"] == {"changes": [{"field": "label", "audiences": ["public"]}]}
    # The audit trail names fields and audiences, never the text itself.
    assert "Elsewhere" not in str(event) and "Riverside" not in str(event)


def test_visitor_fields_on_a_custom_location_name_the_link_that_receives_it() -> None:
    setup = Setup(client_for("owner-1"), "custom")
    refused = setup.owner.patch(setup.path, json={"locality": "New Taipei", "country_code": "JP"})
    changed = changes_of(refused)
    assert set(changed) == {"locality", "country_code"}
    expected = [{"id": f"link:{setup.link['id']}", "label": "Family"}]
    assert all(change["audiences"] == expected for change in changed.values())
    assert changed["country_code"]["before"] == "TW" and changed["country_code"]["after"] == "JP"

    ok = setup.owner.patch(
        setup.path, json={"locality": "New Taipei", "country_code": "JP", "acknowledge_visitor_changes": True}
    )
    assert ok.status_code == 200
    (event,) = setup.events()
    assert event["details"]["changes"][0]["audiences"] == [f"link:{setup.link['id']}"]


def test_a_private_location_edits_freely_and_leaves_no_audit_event() -> None:
    setup = Setup(client_for("owner-1"), "private")
    edited = setup.owner.patch(
        setup.path,
        json={"label": "New", "locality": "Elsewhere", "address_line1": "1 Other Road", "area_id": setup.tainan["id"]},
    )
    assert edited.status_code == 200 and edited.json()["area_id"] == setup.tainan["id"]
    assert setup.events() == []


def test_a_custom_location_no_audience_selects_edits_freely() -> None:
    owner = client_for("owner-1")
    setup = Setup(owner, "custom")
    # The only link now lists nothing, so the location reaches nobody.
    owner.patch(f"{setup.base}/share-links/{setup.link['id']}", json={"scope": scope()})
    assert owner.patch(setup.path, json={"label": "Quiet change"}).status_code == 200
    assert setup.events() == []


def test_a_draft_link_and_an_unpublished_page_receive_nothing_so_need_no_acknowledgement() -> None:
    owner = client_for("owner-1")
    setup = Setup(owner, "private")
    entry = share(owner, setup.trip["id"], "location", setup.hotel["id"], "everyone")
    owner.post(f"{setup.base}/share-links", json={"label": "Draft", "scope": scope(entry)})
    assert owner.patch(setup.path, json={"label": "Draft-safe"}).status_code == 200


def test_address_edits_matter_only_while_the_address_is_shared() -> None:
    setup = Setup(client_for("owner-1"), "everyone")
    # Not shared: the address lines are private, so editing them is free.
    free = setup.owner.patch(setup.path, json={"address_line1": "99 Other Road", "postal_code": "999"})
    assert free.status_code == 200

    # Turning sharing on publishes the existing address parts.
    shared = changes_of(setup.owner.patch(setup.path, json={"share_address": True}))
    assert set(shared) == {"address_line1", "postal_code"}
    assert shared["address_line1"]["before"] is None and shared["address_line1"]["after"] == "99 Other Road"
    assert (
        setup.owner.patch(setup.path, json={"share_address": True, "acknowledge_visitor_changes": True}).status_code
        == 200
    )

    # While shared, replacing it is refused; turning it off withdraws it, also visibly.
    replaced = changes_of(setup.owner.patch(setup.path, json={"address_line1": "5 Third Street"}))
    assert (replaced["address_line1"]["before"], replaced["address_line1"]["after"]) == (
        "99 Other Road",
        "5 Third Street",
    )
    withdrawn = changes_of(setup.owner.patch(setup.path, json={"share_address": False}))
    assert withdrawn["address_line1"]["after"] is None


def test_the_private_notes_and_display_name_are_never_visitor_facing() -> None:
    setup = Setup(client_for("owner-1"), "everyone")
    free = setup.owner.patch(setup.path, json={"notes": "Ask for Mei", "display_name": "Somewhere else entirely"})
    assert free.status_code == 200 and setup.events() == []


def test_a_typo_fix_is_possible_and_an_unchanged_value_needs_nothing() -> None:
    setup = Setup(client_for("owner-1"), "everyone")
    assert setup.owner.patch(setup.path, json={"label": "Hotel Riverside"}).status_code == 200
    fixed = setup.owner.patch(setup.path, json={"label": "Hotel Riverside!", "acknowledge_visitor_changes": True})
    assert fixed.status_code == 200 and fixed.json()["label"] == "Hotel Riverside!"
    # Acknowledging a request that changes nothing visitor-facing records nothing extra.
    setup.owner.patch(setup.path, json={"notes": "n", "acknowledge_visitor_changes": True})
    assert len(setup.events()) == 1


def test_an_area_move_that_carries_a_shared_visit_and_route_end_needs_acknowledgement() -> None:
    owner = client_for("owner-1")
    setup = Setup(owner, "private")
    # The location itself stays private; the carried visit and route are what visitors read.
    share(owner, setup.trip["id"], "area", setup.taipei["id"], "everyone")
    share(owner, setup.trip["id"], "area", setup.tainan["id"], "everyone")
    share(owner, setup.trip["id"], "visit", setup.visit["id"], "everyone")
    owner.post(f"{setup.base}/public-projection/publish")
    move = {"area_id": setup.tainan["id"]}
    (change,) = changes_of(owner.patch(setup.path, json=move)).values()
    assert change["field"] == "area_id"
    assert (change["before"], change["after"]) == (setup.taipei["id"], setup.tainan["id"])
    assert (change["before_label"], change["after_label"]) == ("Taipei", "Tainan")
    assert (change["visits"], change["routes"]) == (1, 1)
    assert change["audiences"] == [{"id": "public", "label": None}]
    assert owner.get(f"{setup.base}/visits").json()[0]["area"]["id"] == setup.taipei["id"]

    moved = owner.patch(setup.path, json={**move, "acknowledge_visitor_changes": True})
    assert moved.status_code == 200
    assert owner.get(f"{setup.base}/visits").json()[0]["area"]["id"] == setup.tainan["id"]
    (event,) = setup.events()
    assert event["details"] == {"changes": [{"field": "area_id", "audiences": ["public"], "visits": 1, "routes": 1}]}


def test_an_area_move_that_carries_nothing_visitors_receive_is_free() -> None:
    owner = client_for("owner-1")
    setup = Setup(owner, "private")
    owner.post(f"{setup.base}/public-projection/publish")
    assert owner.patch(setup.path, json={"area_id": setup.tainan["id"]}).status_code == 200
    assert setup.events() == []


def test_an_area_move_on_an_everyone_location_reports_text_unchanged_and_area_only() -> None:
    owner = client_for("owner-1")
    setup = Setup(owner, "everyone")
    share(owner, setup.trip["id"], "visit", setup.visit["id"], "everyone")
    changed = changes_of(owner.patch(setup.path, json={"area_id": setup.tainan["id"]}))
    assert set(changed) == {"area_id"}


def test_changing_the_point_keeps_its_refusal_with_or_without_acknowledgement() -> None:
    setup = Setup(client_for("owner-1"), "everyone")
    moved = {
        "latitude": 1.0,
        "longitude": 2.0,
        "osm_element_type": None,
        "osm_element_id": None,
        "acknowledge_visitor_changes": True,
    }
    refused = setup.owner.patch(setup.path, json=moved)
    assert refused.status_code == 422
    assert (
        refused.json()["errors"][0]["code"]
        == "make_this_location_private_before_changing_its_point_then_share_it_again"
    )


def test_other_owners_cannot_review_or_change_the_location() -> None:
    setup = Setup(client_for("owner-1"), "everyone")
    stranger = client_for("owner-2")
    assert stranger.patch(setup.path, json={"label": "Hijack", "acknowledge_visitor_changes": True}).status_code == 404


def test_the_acknowledgement_cannot_be_null() -> None:
    setup = Setup(client_for("owner-1"), "everyone")
    assert setup.owner.patch(setup.path, json={"acknowledge_visitor_changes": None}).status_code == 422
