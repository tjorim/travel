"""A hidden link or collection member starts from the public baseline and can exclude records from it (#237).

The world below has two areas, a hotel and a station, visits, stays, routes, updates with photos and a cover, all
set to ``everyone``. Every delivery surface (document, files, navigation, collection member page, owner preview)
reads the same filtered set, so each test asserts on the visitor responses, not on the owner's stored scope."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_publication import (  # noqa: F401
    _photo_copy,
    activate,
    client_for,
    create_trip,
    engine,
    setup_function,
    teardown_function,
)

from app.database import get_session  # noqa: F401
from app.main import app
from app.models import (
    Area,
    AuditEvent,
    AuditEventKind,
    CollectionAuditEvent,
    Location,
    MediaDerivative,
    Route,
    Stay,
    TravelUpdate,
    Visit,
)
from app.projection import local_id
from app.storage import LocalObjectStorage, get_storage

MODELS = {
    "area": Area,
    "location": Location,
    "visit": Visit,
    "stay": Stay,
    "route": Route,
    "travel_update": TravelUpdate,
    "media_derivative": MediaDerivative,
}


def ref(kind: str, record_id: str) -> dict:
    return {"kind": kind, "id": record_id}


def link_scope(*, exclude: list[dict] | None = None, items: list[dict] | None = None, **extra) -> dict:
    body: dict = {
        "schema_version": "travel/share-scope@1",
        "trip": {"title": True, "summary": True},
        "defaults": None,
        "items": items or [],
        **extra,
    }
    if exclude is not None:
        body["exclude"] = exclude
    return body


def lid(kind: str, record_id: str) -> str:
    """The projection-local id visitors see for a canonical record."""
    with Session(engine) as session:
        return local_id(kind, session.get(MODELS[kind], record_id))


def shared(owner: TestClient, trip_id: str, kind: str, record_id: str, visibility: str = "everyone") -> None:
    response = owner.put(f"/api/trips/{trip_id}/visibility/{kind}/{record_id}", json={"visibility": visibility})
    assert response.status_code == 200, response.text


def seen(document: dict) -> dict:
    """What a delivered document holds, by a name that identifies each record."""
    media = {item["id"]: item["caption"] for item in document["media"]}
    return {
        "places": {item["label"] for item in document["places"]},
        "visits": {item["title"] for item in document["visits"]},
        "stays": {item["starts_on"] for item in document["stays"]},
        "routes": {item["label"] for item in document["routes"]},
        "updates": {item["title"] for item in document["updates"]},
        "media": set(media.values()),
        "cover": media.get(document["cover"]),
    }


class World:
    """One trip with every kind of record set to everyone. ``ids`` maps a short name to (kind, canonical id)."""

    def __init__(self, owner: TestClient, tmp_path: Path):
        app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
        self.owner = owner
        self.trip = create_trip(owner)
        self.id = self.trip["id"]
        self.base = f"/api/trips/{self.id}"
        self.ids: dict[str, tuple[str, str]] = {}
        post = self._post
        alpha = post(
            "area", "A", "areas", {"label": "Alpha Town", "country_code": "TW", "latitude": 25.0, "longitude": 121.5}
        )
        beta = post(
            "area", "B", "areas", {"label": "Beta City", "country_code": "TW", "latitude": 23.0, "longitude": 120.2}
        )
        hotel = post(
            "location",
            "H",
            "locations",
            {"area_id": alpha["id"], "label": "Alpha Hotel", "latitude": 25.04, "longitude": 121.51},
        )
        station = post(
            "location",
            "S",
            "locations",
            {"area_id": beta["id"], "label": "Beta Station", "latitude": 23.01, "longitude": 120.21},
        )
        existing = lambda record: {"existing_location_id": record["id"]}  # noqa: E731
        post("visit", "V1", "visits", {"area_id": alpha["id"], "title": "Visit A", "starts_on": "2054-04-02"})
        post("visit", "V2", "visits", {"area_id": beta["id"], "title": "Visit B", "starts_on": "2054-04-12"})
        post("visit", "V3", "visits", {"location": existing(hotel), "title": "Visit Hotel", "starts_on": "2054-04-03"})
        post(
            "visit",
            "V4",
            "visits",
            {"location": existing(station), "title": "Visit Station", "starts_on": "2054-04-13"},
        )
        post(
            "stay",
            "ST1",
            "stays",
            {"location": existing(hotel), "check_in_date": "2054-04-01", "check_out_date": "2054-04-05"},
        )
        post(
            "stay",
            "ST2",
            "stays",
            {"area_id": beta["id"], "check_in_date": "2054-05-10", "check_out_date": "2054-05-15"},
        )
        post(
            "route",
            "R1",
            "routes",
            {"mode": "train", "label": "Rail A-B", "departure_area_id": alpha["id"], "arrival_area_id": beta["id"]},
        )
        post(
            "route",
            "R2",
            "routes",
            {
                "mode": "bus",
                "label": "Bus hotel-station",
                "departure_location": existing(hotel),
                "arrival_location": existing(station),
            },
        )
        u1 = post("travel_update", "U1", "travel-updates", self._update("Update A", area_id=alpha["id"]))
        u2 = post("travel_update", "U2", "travel-updates", self._update("Update Station", location=existing(station)))
        u3 = post("travel_update", "U3", "travel-updates", self._update("Update Plain"))
        self.photo("P1", "Photo of A", update=u1)
        self.photo("P2", "Photo of station", update=u2)
        self.photo("P3", "Photo of plain", update=u3)
        self.photo("P4", "Cover photo")
        self.photo("P5", "Loose photo")
        owner.patch(self.base, json={"cover_derivative_id": self.ids["P4"][1]})
        for kind, record_id in self.ids.values():
            shared(owner, self.id, kind, record_id)
        self.public_slug = None

    @staticmethod
    def _update(title: str, **place) -> dict:
        return {
            "occurred_at": "2054-04-04T10:00:00Z",
            "share_date_precision": "day",
            "title": title,
            "body": f"A safe note about {title}.",
            "private_notes": f"PRIVATE NOTE for {title}",
            **place,
        }

    def _post(self, kind: str, name: str, path: str, body: dict) -> dict:
        response = self.owner.post(f"{self.base}/{path}", json=body)
        assert response.status_code == 201, response.text
        record = response.json()
        self.ids[name] = (kind, record["id"])
        return record

    def photo(self, name: str, caption: str, update: dict | None = None) -> None:
        copy = _photo_copy(self.owner, self.id)
        patch = {"caption": caption, **({"travel_update_id": update["id"]} if update else {})}
        assert self.owner.patch(f"{copy['path']}/presentation", json=patch).status_code == 200
        self.ids[name] = ("media_derivative", copy["derivative"]["id"])

    def ref(self, *names: str) -> list[dict]:
        return [ref(*self.ids[name]) for name in names]

    def publish(self) -> str:
        assert self.owner.put(f"{self.base}/public-projection", json=link_scope()).status_code == 200
        self.public_slug = self.owner.post(f"{self.base}/public-projection/publish").json()["slug"]
        return self.public_slug

    def link(self, label: str = "Friends", **scope_fields) -> dict:
        response = self.owner.post(
            f"{self.base}/share-links", json={"label": label, "scope": link_scope(**scope_fields)}
        )
        assert response.status_code == 201, response.text
        return response.json()

    def active_link(self, **scope_fields) -> tuple[dict, str]:
        link = self.link(**scope_fields)
        return link, activate(self.owner, self.id, link["id"])["token"]


EVERYTHING = {
    "places": {"Alpha Town", "Beta City", "Alpha Hotel", "Beta Station"},
    "visits": {"Visit A", "Visit B", "Visit Hotel", "Visit Station"},
    "stays": {"2054-04", "2054-05"},  # told apart by month (the default precision)
    "routes": {"Rail A-B", "Bus hotel-station"},
    "updates": {"Update A", "Update Station", "Update Plain"},
    "media": {"Photo of A", "Photo of station", "Photo of plain", "Cover photo", "Loose photo"},
    "cover": "Cover photo",
}


@pytest.fixture
def world(tmp_path: Path) -> World:
    return World(client_for("owner-1"), tmp_path)


def minus(**removed: set[str]) -> dict:
    """EVERYTHING without the named members; ``cover=None`` removes the cover."""
    result = {key: (set(value) if isinstance(value, set) else value) for key, value in EVERYTHING.items()}
    for key, value in removed.items():
        if key == "cover":
            result["cover"] = value
        else:
            result[key] -= value
    return result


# --- the baseline, and the unchanged default ---------------------------------------


def test_a_link_without_exclusions_delivers_the_whole_baseline_exactly_like_the_public_view(world: World) -> None:
    slug = world.publish()
    link, token = world.active_link()
    anonymous = TestClient(app)
    public = anonymous.get(f"/api/public/trips/{slug}").json()
    hidden = anonymous.get(f"/api/shared/{token}").json()
    assert "exclude" not in link["scope"]
    assert link["exclusions"] == {"excluded": [], "also_hidden": {}, "stale": 0}
    assert {key: value for key, value in hidden.items() if key != "schema_version"} == {
        key: value for key, value in public.items() if key != "schema_version"
    }
    assert len(hidden["places"]) == 4 and len(hidden["visits"]) == 4 and len(hidden["media"]) == 5


# --- cascade rules: one expectation per rule ---------------------------------------


CASCADES = {
    # An area hides the locations in it and every visit, route, update and stay that uses it, and their photos.
    "area A": (
        ["A"],
        {
            "places": {"Alpha Town", "Alpha Hotel"},
            "visits": {"Visit A", "Visit Hotel"},
            "stays": {"2054-04"},
            "routes": {"Rail A-B", "Bus hotel-station"},
            "updates": {"Update A"},
            "media": {"Photo of A"},
        },
        {"area": 1, "location": 1, "visit": 2, "stay": 1, "route": 2, "travel_update": 1, "media_derivative": 1},
    ),
    "area B": (
        ["B"],
        {
            "places": {"Beta City", "Beta Station"},
            "visits": {"Visit B", "Visit Station"},
            "stays": {"2054-05"},
            "routes": {"Rail A-B", "Bus hotel-station"},
            "updates": {"Update Station"},
            "media": {"Photo of station"},
        },
        {"area": 1, "location": 1, "visit": 2, "stay": 1, "route": 2, "travel_update": 1, "media_derivative": 1},
    ),
    # A location hides what uses it, never its area.
    "location H": (
        ["H"],
        {"places": {"Alpha Hotel"}, "visits": {"Visit Hotel"}, "stays": {"2054-04"}, "routes": {"Bus hotel-station"}},
        {"location": 1, "visit": 1, "stay": 1, "route": 1},
    ),
    "location S": (
        ["S"],
        {
            "places": {"Beta Station"},
            "visits": {"Visit Station"},
            "routes": {"Bus hotel-station"},
            "updates": {"Update Station"},
            "media": {"Photo of station"},
        },
        {"location": 1, "visit": 1, "route": 1, "travel_update": 1, "media_derivative": 1},
    ),
    # An update hides its photos; a photo hides only itself.
    "update U1": (
        ["U1"],
        {"updates": {"Update A"}, "media": {"Photo of A"}},
        {"travel_update": 1, "media_derivative": 1},
    ),
    "photo P1": (["P1"], {"media": {"Photo of A"}}, {"media_derivative": 1}),
    "loose photo P5": (["P5"], {"media": {"Loose photo"}}, {"media_derivative": 1}),
    # Excluding the cover photo leaves the audience without a cover.
    "cover P4": (["P4"], {"media": {"Cover photo"}, "cover": None}, {"media_derivative": 1}),
    "visit V1": (["V1"], {"visits": {"Visit A"}}, {"visit": 1}),
    "route R1": (["R1"], {"routes": {"Rail A-B"}}, {"route": 1}),
    "several": (
        ["V1", "R1", "P5"],
        {"visits": {"Visit A"}, "routes": {"Rail A-B"}, "media": {"Loose photo"}},
        {"visit": 1, "route": 1, "media_derivative": 1},
    ),
}


@pytest.mark.parametrize(("names", "removed", "_counts"), CASCADES.values(), ids=CASCADES.keys())
def test_each_cascade_rule_hides_exactly_what_depends_on_the_excluded_record(
    world: World, names: list[str], removed: dict, _counts: dict
) -> None:
    world.publish()
    _, token = world.active_link(exclude=world.ref(*names))
    got = TestClient(app).get(f"/api/shared/{token}").json()
    visible = seen(got)
    expected = minus(**removed)
    for key in ("places", "visits", "stays", "routes", "updates", "media", "cover"):
        assert visible[key] == expected[key], key
    # No dangling reference: every update a photo names, and every place a record names, is delivered.
    update_ids = {item["id"] for item in got["updates"]}
    assert all(item["update"] in update_ids for item in got["media"] if "update" in item)
    place_labels = {item["label"] for item in got["places"]}
    for record in (*got["visits"], *got["stays"], *got["updates"]):
        if record.get("location"):
            assert record["location"]["label"] in place_labels
    # The public view is the baseline and still has everything.
    public = TestClient(app).get(f"/api/public/trips/{world.public_slug}").json()
    assert seen(public) == EVERYTHING


def test_the_review_names_what_each_exclusion_also_hides(world: World) -> None:
    for label, (names, _removed, counts) in CASCADES.items():
        if len(names) != 1:
            continue
        review = world.owner.post(
            f"{world.base}/share-scope/exclusion-review", json={"exclude": world.ref(*names)}
        ).json()
        [only] = review["excluded"]
        kind, record_id = world.ids[names[0]]
        assert (only["kind"], only["id"]) == (kind, record_id), label
        # `hides` counts the dependents; the excluded record itself is not one of them.
        assert only["hides"] == {
            key: value - (1 if key == kind else 0) for key, value in counts.items() if value - (1 if key == kind else 0)
        }, label
        assert review["also_hidden"] == only["hides"], label
        assert {item["kind"] for item in only["also_hides"]} == set(only["hides"]), label
        assert review["stale"] == 0


def test_the_review_lists_the_baseline_an_audience_may_exclude(world: World) -> None:
    review = world.owner.post(f"{world.base}/share-scope/exclusion-review", json={}).json()
    baseline = {(item["kind"], item["id"]) for item in review["baseline"]}
    assert baseline == set(world.ids.values()) | {
        (kind, record_id)
        for kind, record_id in baseline
        if kind == "location"  # the city-level location the second stay created
    }
    assert review["excluded"] == [] and review["also_hidden"] == {}
    # A record the baseline does not reach is not offered.
    private = world.owner.post(
        f"{world.base}/visits", json={"area_id": world.ids["A"][1], "title": "Private visit"}
    ).json()
    again = world.owner.post(f"{world.base}/share-scope/exclusion-review", json={}).json()
    assert ("visit", private["id"]) not in {(item["kind"], item["id"]) for item in again["baseline"]}


# --- every delivery surface --------------------------------------------------------


def test_an_excluded_record_is_absent_from_every_delivery_surface_of_the_link_but_not_of_others(
    world: World,
) -> None:
    slug = world.publish()
    excluded = world.ref("A", "U1", "P4")
    link, token = world.active_link(exclude=excluded)
    other, other_token = world.active_link()
    anonymous = TestClient(app)

    area_id, photo_id = lid("area", world.ids["A"][1]), lid("media_derivative", world.ids["P4"][1])
    attached_id = lid("media_derivative", world.ids["P1"][1])
    hotel_id = lid("location", world.ids["H"][1])
    update_id = lid("travel_update", world.ids["U1"][1])

    # Document and cover.
    document = anonymous.get(f"/api/shared/{token}")
    assert document.json()["cover"] is None
    for secret in (area_id, photo_id, attached_id, hotel_id, update_id, "Alpha Town", "Alpha Hotel", "Update A"):
        assert secret not in document.text, secret
    # Files: the cover, the attached photo and a delivered one.
    assert anonymous.get(f"/api/shared/{token}/files/{photo_id}").status_code == 404
    assert anonymous.get(f"/api/shared/{token}/files/{attached_id}").status_code == 404
    loose = lid("media_derivative", world.ids["P5"][1])
    assert anonymous.get(f"/api/shared/{token}/files/{loose}").status_code == 200
    # Navigation: the area and the location in it have none for this link.
    for place in (area_id, hotel_id):
        assert anonymous.get(f"/api/shared/{token}/navigation/{place}", follow_redirects=False).status_code == 404
    beta = lid("area", world.ids["B"][1])
    assert anonymous.get(f"/api/shared/{token}/navigation/{beta}", follow_redirects=False).status_code == 302
    # The owner's preview of this link is the same document, files and navigation.
    preview = world.owner.post(f"{world.base}/share-links/{link['id']}/preview")
    assert preview.json() == document.json()
    assert world.owner.get(f"{world.base}/share-links/{link['id']}/preview/files/{photo_id}").status_code == 404
    assert world.owner.get(f"{world.base}/share-links/{link['id']}/preview/files/{loose}").status_code == 200
    assert world.owner.get(f"{world.base}/share-links/{link['id']}/preview/navigation/{area_id}").status_code == 404
    candidate = world.owner.post(f"{world.base}/share-links/{other['id']}/preview", json=link_scope(exclude=excluded))
    assert candidate.json() == document.json()

    # The public view and the other link still deliver all of it.
    assert anonymous.get(f"/api/public/trips/{slug}/files/{photo_id}").status_code == 200
    assert anonymous.get(f"/api/shared/{other_token}/files/{photo_id}").status_code == 200
    assert anonymous.get(f"/api/shared/{other_token}/navigation/{area_id}", follow_redirects=False).status_code == 302
    assert anonymous.get(f"/api/public/trips/{slug}/navigation/{area_id}", follow_redirects=False).status_code == 302
    assert "Alpha Town" in anonymous.get(f"/api/shared/{other_token}").text
    assert world.owner.post(f"{world.base}/public-projection/preview").json()["cover"] == photo_id


def test_a_collection_member_excludes_records_through_the_same_scope(world: World) -> None:
    world.publish()
    owner = world.owner
    collection = owner.post("/api/collections", json={"label": "Family"}).json()
    added = owner.post(
        f"/api/collections/{collection['id']}/members",
        json={"trip_id": world.id, "scope": link_scope(exclude=world.ref("A", "P4"))},
    )
    assert added.status_code == 201, added.text
    member = added.json()["members"][0]
    assert member["exclusions"]["excluded"][0]["hides"]["visit"] == 2
    token = owner.post(f"/api/collections/{collection['id']}/activate", json={"expires_in_days": 30}).json()["token"]
    anonymous = TestClient(app)

    index = anonymous.get(f"/api/shared/{token}").json()
    assert index["trips"][0]["cover"] is None  # the entry list uses the filtered set too
    page = anonymous.get(f"/api/shared/{token}/trips/{index['trips'][0]['id']}")
    assert seen(page.json())["visits"] == {"Visit B", "Visit Station"}
    assert "Alpha" not in page.text and lid("area", world.ids["A"][1]) not in page.text
    photo_id = lid("media_derivative", world.ids["P4"][1])
    assert anonymous.get(f"/api/shared/{token}/trips/{index['trips'][0]['id']}/files/{photo_id}").status_code == 404
    area_id = lid("area", world.ids["A"][1])
    navigation = anonymous.get(f"/api/shared/{token}/trips/{index['trips'][0]['id']}/navigation/{area_id}")
    assert navigation.status_code == 404
    preview = owner.post(f"/api/collections/{collection['id']}/members/{member['id']}/preview")
    assert preview.json() == page.json()
    assert (
        member["delivered_records"]
        > owner.get(f"/api/collections/{collection['id']}").json()["members"][0]["delivered_records"] - 1
    )


def test_no_surface_of_a_link_carries_an_excluded_records_id_or_text(world: World) -> None:
    """The property: whatever is excluded or hidden with it never appears in the JSON a visitor can fetch."""
    world.publish()
    anonymous = TestClient(app)
    for names in (["A"], ["B"], ["H"], ["S"], ["U1"], ["P4"], ["A", "S", "P5"], ["V1", "R2", "ST2"]):
        link, token = world.active_link(label="-".join(names), exclude=world.ref(*names))
        review = world.owner.post(
            f"{world.base}/share-scope/exclusion-review", json={"exclude": world.ref(*names)}
        ).json()
        hidden = {(item["kind"], item["id"]) for item in review["excluded"]}
        for entry in review["excluded"]:
            hidden |= {(item["kind"], item["id"]) for item in entry["also_hides"]}
        assert len(hidden) >= len(names)
        surfaces = [anonymous.get(f"/api/shared/{token}").text]
        for kind, record_id in sorted(hidden):
            local = lid(kind, record_id)
            for path in ("files", "navigation"):
                response = anonymous.get(f"/api/shared/{token}/{path}/{local}", follow_redirects=False)
                assert response.status_code == 404, (names, kind, path)
            surfaces.append(local)
        body = surfaces[0]
        for kind, record_id in sorted(hidden):
            assert record_id not in body, (names, kind, "canonical id")
            assert lid(kind, record_id) not in body, (names, kind, "local id")
            if kind == "media_derivative":
                assert lid(kind, record_id) + "-poster" not in body
        owner_text = json.dumps(world.owner.post(f"{world.base}/share-links/{link['id']}/preview").json())
        assert owner_text == body.replace("\n", "") or json.loads(owner_text) == json.loads(body)
        world.owner.post(f"{world.base}/share-links/{link['id']}/revoke")


# --- writing the scope -------------------------------------------------------------


def test_write_validation_rejects_unknown_kinds_ids_duplicates_and_the_public_view(world: World) -> None:
    owner = world.owner
    bad_kind = owner.post(
        f"{world.base}/share-links", json={"label": "x", "scope": link_scope(exclude=[ref("document", "a")])}
    )
    assert bad_kind.status_code == 422
    unknown = owner.post(
        f"{world.base}/share-links", json={"label": "x", "scope": link_scope(exclude=[ref("visit", "0" * 32)])}
    )
    assert unknown.status_code == 422 and unknown.json()["errors"][0]["code"] == "scope_unavailable"
    foreign = create_trip(owner, "Other trip")
    other_visit = owner.post(
        f"/api/trips/{foreign['id']}/visits",
        json={"area_id": owner.post(f"/api/trips/{foreign['id']}/areas", json={"label": "Elsewhere"}).json()["id"]},
    ).json()
    cross = owner.post(
        f"{world.base}/share-links", json={"label": "x", "scope": link_scope(exclude=[ref("visit", other_visit["id"])])}
    )
    assert cross.status_code == 422 and cross.json()["errors"][0]["code"] == "scope_unavailable"
    twice = owner.post(
        f"{world.base}/share-links", json={"label": "x", "scope": link_scope(exclude=world.ref("V1", "V1"))}
    )
    assert twice.status_code == 422 and twice.json()["errors"][0]["code"] == "scope_duplicate"
    extra = owner.post(
        f"{world.base}/share-links",
        json={"label": "x", "scope": link_scope(exclude=[{**world.ref("V1")[0], "reason": "private"}])},
    )
    assert extra.status_code == 422
    assert owner.get(f"{world.base}/share-links").json() == []

    # The public view is the baseline: it cannot exclude anything, saved or previewed.
    refused = owner.put(f"{world.base}/public-projection", json=link_scope(exclude=world.ref("V1")))
    assert refused.status_code == 422 and refused.json()["errors"][0]["code"] == "scope_exclusion_not_allowed"
    preview = owner.post(f"{world.base}/public-projection/preview", json=link_scope(exclude=world.ref("V1")))
    assert preview.status_code == 422
    assert owner.put(f"{world.base}/public-projection", json=link_scope(exclude=[])).status_code == 200
    assert "exclude" not in owner.get(f"{world.base}/public-projection").json()["scope"]


def test_a_record_not_set_to_everyone_is_dropped_by_the_write_and_a_stale_entry_is_ignored(world: World) -> None:
    owner = world.owner
    private = owner.post(f"{world.base}/visits", json={"area_id": world.ids["A"][1], "title": "Private visit"}).json()
    link = world.link(exclude=world.ref("V1") + [ref("visit", private["id"])])
    assert link["scope"]["exclude"] == [world.ref("V1")[0]]
    assert link["exclusions"]["stale"] == 0

    # V1 stops being everyone: the stored entry no longer applies, is reported stale, and a write prunes it.
    shared(owner, world.id, "visit", world.ids["V1"][1], "private")
    stale = owner.get(f"{world.base}/share-links/{link['id']}").json()
    assert stale["scope"]["exclude"] == [world.ref("V1")[0]]
    assert stale["exclusions"] == {"excluded": [], "also_hidden": {}, "stale": 1}
    # ...and it applies again if the owner shares V1 again before any write (the conservative direction).
    shared(owner, world.id, "visit", world.ids["V1"][1], "everyone")
    assert owner.get(f"{world.base}/share-links/{link['id']}").json()["exclusions"]["stale"] == 0
    shared(owner, world.id, "visit", world.ids["V1"][1], "private")
    saved = owner.patch(
        f"{world.base}/share-links/{link['id']}",
        json={"scope": link_scope(exclude=world.ref("V1", "R1"))},
        headers={"If-Match": f'"{stale["revision"]}"'},
    ).json()
    assert saved["scope"]["exclude"] == [world.ref("R1")[0]]

    # A deleted record's id is ignored on read; resending it (as an unchanged client would) is not an error.
    assert owner.delete(f"{world.base}/routes/{world.ids['R1'][1]}").status_code == 204
    gone = owner.get(f"{world.base}/share-links/{link['id']}").json()
    assert gone["exclusions"]["stale"] == 1
    again = owner.patch(
        f"{world.base}/share-links/{link['id']}",
        json={"scope": link_scope(exclude=gone["scope"]["exclude"] + world.ref("V2"))},
    )
    assert again.status_code == 200, again.text
    assert again.json()["scope"]["exclude"] == [world.ref("V2")[0]]


def test_the_stored_exclusions_are_sorted_so_the_same_set_has_one_fingerprint(world: World) -> None:
    first = world.link(label="One", exclude=world.ref("V2", "V1", "A"))
    second = world.link(label="Two", exclude=world.ref("A", "V1", "V2"))
    assert first["scope"]["exclude"] == second["scope"]["exclude"]
    assert first["scope"]["exclude"] == sorted(first["scope"]["exclude"], key=lambda item: (item["kind"], item["id"]))


def test_a_client_that_leaves_exclude_out_keeps_the_stored_exclusions(world: World) -> None:
    link = world.link(exclude=world.ref("V1"))
    older_client = link_scope()  # no `exclude` key at all
    kept = world.owner.patch(f"{world.base}/share-links/{link['id']}", json={"scope": older_client}).json()
    assert kept["scope"]["exclude"] == world.ref("V1")
    cleared = world.owner.patch(f"{world.base}/share-links/{link['id']}", json={"scope": link_scope(exclude=[])}).json()
    assert "exclude" not in cleared["scope"]
    # Label-only edits never touch the scope.
    again = world.link(exclude=world.ref("V1"))
    renamed = world.owner.patch(f"{world.base}/share-links/{again['id']}", json={"label": "Renamed"}).json()
    assert renamed["scope"]["exclude"] == world.ref("V1")


def test_custom_additions_and_exclusions_combine_and_an_exclusion_wins_over_what_depends_on_it(world: World) -> None:
    owner = world.owner
    custom_update = owner.post(
        f"{world.base}/travel-updates", json=World._update("Custom update", area_id=world.ids["A"][1])
    ).json()
    shared(owner, world.id, "travel_update", custom_update["id"], "custom")
    private_visit = owner.post(
        f"{world.base}/visits", json={"area_id": world.ids["B"][1], "title": "Custom visit"}
    ).json()
    shared(owner, world.id, "visit", private_visit["id"], "custom")
    world.publish()
    items = [ref("travel_update", custom_update["id"]), ref("visit", private_visit["id"])]

    _, wide = world.active_link(items=items)
    got = seen(TestClient(app).get(f"/api/shared/{wide}").json())
    assert {"Custom update", "Update A"} <= got["updates"] and "Custom visit" in got["visits"]

    # Excluding area A removes the custom update that names it as well, but not the custom visit in B.
    _, narrow = world.active_link(label="Narrow", items=items, exclude=world.ref("A"))
    got = seen(TestClient(app).get(f"/api/shared/{narrow}").json())
    assert "Custom update" not in got["updates"] and "Update A" not in got["updates"]
    assert "Custom visit" in got["visits"] and "Visit A" not in got["visits"]
    # The public view lists neither custom record.
    public = TestClient(app).get(f"/api/public/trips/{world.public_slug}").json()
    assert "Custom update" not in seen(public)["updates"]

    # A custom record cannot also be excluded: exclusions name baseline (everyone) records only.
    clash = owner.post(
        f"{world.base}/share-links",
        json={"label": "x", "scope": link_scope(items=items, exclude=[ref("visit", private_visit["id"])])},
    ).json()
    assert "exclude" not in clash["scope"] and len(clash["scope"]["items"]) == 2


def test_a_record_that_cannot_be_shared_right_now_keeps_its_exclusion_for_when_it_can_again(world: World) -> None:
    world.publish()

    def set_body(text: str) -> None:
        with Session(engine) as session:
            session.get(TravelUpdate, world.ids["U3"][1]).body = text
            session.commit()

    # Without text for visitors an update is not delivered, though the owner still has it set to everyone.
    set_body("")
    link, token = world.active_link(exclude=world.ref("U3"))
    assert "Update Plain" not in seen(TestClient(app).get(f"/api/shared/{token}").json())["updates"]
    assert link["exclusions"]["excluded"][0]["received"] is False
    assert link["exclusions"]["stale"] == 0
    set_body("Text again.")
    assert "Update Plain" not in seen(TestClient(app).get(f"/api/shared/{token}").json())["updates"]
    public = TestClient(app).get(f"/api/public/trips/{world.public_slug}").json()
    assert "Update Plain" in seen(public)["updates"]


# --- narrowing, widening, revisions and audit ---------------------------------------


def patch(world: World, link: dict, scope: dict, *, confirm: bool | None = None, revision: int | None = None):
    body: dict = {"scope": scope}
    if confirm is not None:
        body["confirm_widening"] = confirm
    headers = {"If-Match": f'"{revision}"'} if revision is not None else {}
    return world.owner.patch(f"{world.base}/share-links/{link['id']}", json=body, headers=headers)


def audit_events(kind: AuditEventKind) -> list[AuditEvent]:
    with Session(engine) as session:
        return list(session.scalars(select(AuditEvent).where(AuditEvent.kind == kind).order_by(AuditEvent.occurred_at)))


def test_adding_an_exclusion_narrows_a_live_link_without_a_confirmation_and_is_audited(world: World) -> None:
    link, token = world.active_link()
    saved = patch(world, link, link_scope(exclude=world.ref("A", "P4")), revision=link["revision"])
    assert saved.status_code == 200, saved.text
    assert "Alpha Town" not in TestClient(app).get(f"/api/shared/{token}").text
    [event] = audit_events(AuditEventKind.SHARE_LINK_SCOPE_CHANGE)
    assert event.details["exclusions"] == {
        "added": sorted(world.ref("A", "P4"), key=lambda i: (i["kind"], i["id"])),
        "removed": [],
        "widened": {},
    }
    assert set(event.details) == {"scope_version_before", "scope_version_after", "exclusions"}
    # Ids and counts only: no label, title or other owner text from the trip.
    text = json.dumps(event.details)
    for owner_text in ("Alpha", "Cover photo", "Friends", "Visit"):
        assert owner_text not in text


def test_removing_an_exclusion_from_a_live_link_needs_the_widening_confirmation(world: World) -> None:
    link, token = world.active_link(exclude=world.ref("A", "P4"))
    revision = link["revision"]
    refused = patch(world, link, link_scope(exclude=world.ref("P4")), revision=revision)
    assert refused.status_code == 409
    detail = refused.json()["detail"]
    assert detail["code"] == "exclusion_widening_needs_acknowledgement"
    revealed = {(item["kind"], item["id"]) for item in detail["revealed"]}
    assert {world.ids[name] for name in ("A", "H", "V1", "V3", "ST1", "R1", "R2", "U1", "P1")} == revealed
    assert detail["counts"] == {
        "area": 1,
        "location": 1,
        "visit": 2,
        "stay": 1,
        "route": 2,
        "travel_update": 1,
        "media_derivative": 1,
    }
    # Nothing changed: not the delivery, the revision, the audit trail.
    assert "Alpha Town" not in TestClient(app).get(f"/api/shared/{token}").text
    assert world.owner.get(f"{world.base}/share-links/{link['id']}").json()["revision"] == revision
    assert audit_events(AuditEventKind.SHARE_LINK_SCOPE_CHANGE) == []

    accepted = patch(world, link, link_scope(exclude=world.ref("P4")), confirm=True, revision=revision)
    assert accepted.status_code == 200, accepted.text
    assert "Alpha Town" in TestClient(app).get(f"/api/shared/{token}").text
    [event] = audit_events(AuditEventKind.SHARE_LINK_SCOPE_CHANGE)
    assert event.details["exclusions"]["removed"] == world.ref("A")
    assert event.details["exclusions"]["widened"] == detail["counts"]
    assert "Alpha" not in json.dumps(event.details)

    # Clearing them all is the same widening; narrowing again is not.
    assert (
        patch(world, accepted.json(), link_scope(exclude=[]), revision=accepted.json()["revision"]).status_code == 409
    )
    assert (
        patch(
            world, accepted.json(), link_scope(exclude=world.ref("P4", "V2")), revision=accepted.json()["revision"]
        ).status_code
        == 200
    )


def test_a_draft_needs_no_widening_confirmation_and_records_nothing(world: World) -> None:
    link = world.link(exclude=world.ref("A"))
    assert patch(world, link, link_scope(exclude=[]), revision=link["revision"]).status_code == 200
    assert audit_events(AuditEventKind.SHARE_LINK_SCOPE_CHANGE) == []


def test_a_stale_revision_wins_over_nothing_changing_and_a_refused_widening_is_retried_after_it(world: World) -> None:
    link, _ = world.active_link(exclude=world.ref("A"))
    patch(world, link, link_scope(exclude=world.ref("A", "V2")), revision=link["revision"])
    stale = patch(world, link, link_scope(exclude=[]), confirm=True, revision=link["revision"])
    assert stale.status_code == 412
    assert stale.json()["detail"]["code"] == "scope_revision_conflict"
    assert stale.json()["detail"]["current"]["scope"]["exclude"] == sorted(
        world.ref("A", "V2"), key=lambda item: (item["kind"], item["id"])
    )


def test_removing_a_collection_members_exclusion_needs_the_confirmation_too(world: World) -> None:
    owner = world.owner
    collection = owner.post("/api/collections", json={"label": "Family"}).json()
    member = owner.post(
        f"/api/collections/{collection['id']}/members",
        json={"trip_id": world.id, "scope": link_scope(exclude=world.ref("A"))},
    ).json()["members"][0]
    owner.post(f"/api/collections/{collection['id']}/activate", json={"expires_in_days": 30})
    path = f"/api/collections/{collection['id']}/members/{member['id']}"
    refused = owner.put(path, json=link_scope(exclude=[]))
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "exclusion_widening_needs_acknowledgement"
    assert owner.put(f"{path}?confirm_widening=true", json=link_scope(exclude=[])).status_code == 200
    with Session(engine) as session:
        [event] = session.scalars(
            select(CollectionAuditEvent).where(CollectionAuditEvent.kind == "collection.member_scope_change")
        )
    assert event.details["exclusions"]["removed"] == world.ref("A")
    assert "Alpha" not in json.dumps(event.details)


# --- Sharing check (overview) and owner visibility audit -----------------------------


def test_the_sharing_check_states_how_many_records_each_link_excludes_and_what_that_also_hides(world: World) -> None:
    world.publish()
    link, _ = world.active_link(exclude=world.ref("A", "P5"))
    overview = world.owner.get(f"{world.base}/overview").json()
    public, row = overview["audiences"]
    assert (public["excluded"], public["excluded_also_hides"]) == (0, {})
    assert row["excluded"] == 2
    assert row["excluded_also_hides"] == {
        "location": 1,
        "visit": 2,
        "stay": 1,
        "route": 2,
        "travel_update": 1,
        "media_derivative": 1,
    }
    assert row["delivered"]["visits"] == public["delivered"]["visits"] - 2
    assert row["delivered"]["media"] == public["delivered"]["media"] - 2


def test_an_owner_visibility_change_does_not_report_an_audience_that_excludes_the_record(world: World) -> None:
    world.publish()
    world.active_link(exclude=world.ref("V2"))
    shared(world.owner, world.id, "visit", world.ids["V2"][1], "private")
    shared(world.owner, world.id, "visit", world.ids["V2"][1], "everyone")
    changes = [event.details for event in audit_events(AuditEventKind.VISIBILITY_CHANGE)]
    reached = [details for details in changes if details["to"] == "everyone"][-1]
    # Only the public page newly reaches it again; the link excludes it.
    assert reached["newly_reached"] == ["public"]
    left = [details for details in changes if details["to"] == "private"][-1]
    assert left["no_longer_reached"] == ["public"]


def test_exclusion_review_is_owner_only(world: World) -> None:
    other = client_for("owner-2")
    assert other.post(f"{world.base}/share-scope/exclusion-review", json={}).status_code == 404


def test_the_sharing_check_does_not_warn_about_a_cover_a_link_leaves_out_on_purpose(world: World) -> None:
    world.publish()
    world.active_link(label="Without cover", exclude=world.ref("P4"))
    warnings = world.owner.get(f"{world.base}/overview").json()["warnings"]
    assert "cover_not_received" not in {item["code"] for item in warnings}
    # A cover that is simply not shared still warns every audience (the exclusion no longer applies to it).
    shared(world.owner, world.id, "media_derivative", world.ids["P4"][1], "private")
    warnings = world.owner.get(f"{world.base}/overview").json()["warnings"]
    assert {item["audience"] for item in warnings if item["code"] == "cover_not_received"} == {
        "public",
        "Without cover",
    }
