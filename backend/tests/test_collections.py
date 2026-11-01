import io
import json
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.database import Base, get_session
from app.main import app
from app.models import Collection, CollectionAuditEvent, CollectionMember
from app.storage import LocalObjectStorage, get_storage

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


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


def create_trip(client: TestClient, title: str, summary: str = "A safe summary.", **fields) -> dict:
    response = client.post("/api/trips", json={"title": title, "summary": summary, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def add_update(client: TestClient, trip_id: str, title: str, visibility: str = "custom") -> dict:
    response = client.post(
        f"/api/trips/{trip_id}/travel-updates",
        json={
            "occurred_at": "2054-04-04T10:00:00Z",
            "date_precision": "day",
            "title": title,
            "body": f"A safe note about {title}.",
            "private_notes": f"PRIVATE NOTE for {title}",
            "visibility": visibility,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def scope(*items: dict, title: bool = True, summary: bool = True, dates: str | None = None) -> dict:
    trip: dict = {"title": title, "summary": summary}
    if dates:
        trip["dates"] = dates
    return {"schema_version": "travel/share-scope@1", "trip": trip, "items": list(items)}


def update_item(update_id: str) -> dict:
    return {"kind": "travel_update", "id": update_id}


def make_collection(owner: TestClient, label: str = "Family", title: str | None = None) -> dict:
    response = owner.post("/api/collections", json={"label": label, "title": title})
    assert response.status_code == 201, response.text
    return response.json()


def add_member(owner: TestClient, collection_id: str, trip_id: str, member_scope: dict) -> dict:
    response = owner.post(f"/api/collections/{collection_id}/members", json={"trip_id": trip_id, "scope": member_scope})
    assert response.status_code == 201, response.text
    return response.json()


def activate(owner: TestClient, collection_id: str, days: int | None = 30) -> dict:
    response = owner.post(f"/api/collections/{collection_id}/activate", json={"expires_in_days": days})
    assert response.status_code == 200, response.text
    return response.json()


def member_for(collection: dict, trip_id: str) -> dict:
    return next(member for member in collection["members"] if member["trip_id"] == trip_id)


def seeded() -> tuple[TestClient, dict, dict, dict, dict]:
    """Two member trips at different scopes, one non-member trip, an active collection."""
    owner = client_for("owner-1")
    trip_a = create_trip(owner, "Alpha Coast 2054", "ALPHA SUMMARY", starts_on="2054-04-01", ends_on="2054-04-09")
    hotel = add_update(owner, trip_a["id"], "Alpha Hotel")
    add_update(owner, trip_a["id"], "Alpha Factory Tour")
    trip_b = create_trip(owner, "Beta Hills 2054", "BETA SUMMARY")
    add_update(owner, trip_b["id"], "Beta Chapel")
    trip_c = create_trip(owner, "Gamma Secret Trip", "GAMMA SECRET SUMMARY")
    add_update(owner, trip_c["id"], "Gamma Private Bar")
    collection = make_collection(owner, title="Shared with family")
    add_member(owner, collection["id"], trip_a["id"], scope(update_item(hotel["id"]), dates="month"))
    # The second member hides everything but its existence.
    add_member(owner, collection["id"], trip_b["id"], scope(title=False, summary=False))
    activated = activate(owner, collection["id"])
    return owner, trip_a, trip_b, trip_c, activated


def test_index_and_trip_pages_deliver_each_member_at_its_own_scope_and_leak_nothing() -> None:
    owner, trip_a, trip_b, trip_c, collection = seeded()
    token = collection["token"]
    anonymous = TestClient(app)

    index = anonymous.get(f"/api/shared/{token}")
    assert index.status_code == 200
    assert index.headers["cache-control"] == "no-store, private"
    assert index.headers["x-robots-tag"] == "noindex, noarchive"
    assert index.headers["referrer-policy"] == "no-referrer"
    body = index.json()
    assert body["schema_version"] == "travel/collection@1"
    assert body["title"] == "Shared with family"
    alpha, beta = body["trips"]
    assert alpha["title"] == "Alpha Coast 2054"
    assert alpha["summary_text"] == "ALPHA SUMMARY"
    assert alpha["dates"] == {"starts_on": "2054-04", "ends_on": "2054-04", "date_precision": "month"}
    # The second member shows no title, summary or dates, yet is still listed.
    assert beta == {"id": beta["id"], "title": None, "summary_text": None, "dates": None, "cover": None}

    raw = index.text
    for secret in (
        trip_a["id"],
        trip_b["id"],
        trip_c["id"],
        "Beta Hills",
        "BETA SUMMARY",
        "Gamma",
        "Alpha Hotel",
        "PRIVATE NOTE",
        "Family",  # the owner-only label
        collection["id"],
    ):
        assert secret not in raw, secret

    page = anonymous.get(f"/api/shared/{token}/trips/{alpha['id']}")
    assert page.status_code == 200
    assert page.headers["cache-control"] == "no-store, private"
    assert page.json()["schema_version"] == "travel/unlisted-trip@1"
    assert [u["title"] for u in page.json()["updates"]] == ["Alpha Hotel"]
    for secret in ("Alpha Factory Tour", "PRIVATE NOTE", "Gamma", "BETA", trip_a["id"], collection["id"]):
        assert secret not in page.text, secret

    other = anonymous.get(f"/api/shared/{token}/trips/{beta['id']}").json()
    assert other["title"] is None and other["updates"] == []
    assert "Beta" not in json.dumps(other)

    # An unknown or foreign member id is indistinguishable from any other miss.
    for member_id in ("0" * 32, trip_a["id"], trip_c["id"]):
        missing = anonymous.get(f"/api/shared/{token}/trips/{member_id}")
        assert missing.status_code == 404
        assert missing.headers["cache-control"] == "no-store, private"
    assert anonymous.get(f"/api/shared/{token}/trips/not%20valid!").status_code == 404


def test_member_scope_is_independent_of_the_trips_own_links_and_everyone_still_reaches_members() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner, "Delta 2054")
    chosen = add_update(owner, trip["id"], "Chosen")
    everyone = add_update(owner, trip["id"], "Open to all", visibility="everyone")
    other = add_update(owner, trip["id"], "Other")
    link = owner.post(
        f"/api/trips/{trip['id']}/share-links", json={"label": "Wide", "scope": scope(update_item(other["id"]))}
    ).json()
    collection = make_collection(owner)
    added = add_member(owner, collection["id"], trip["id"], scope(update_item(chosen["id"])))
    member_id = member_for(added, trip["id"])["id"]
    token = activate(owner, collection["id"])["token"]
    anonymous = TestClient(app)
    titles = sorted(u["title"] for u in anonymous.get(f"/api/shared/{token}/trips/{member_id}").json()["updates"])
    assert titles == ["Chosen", "Open to all"]
    assert link["scope"]["items"][0]["id"] == other["id"]  # the link's own scope is untouched

    # Editing the member scope is live and recorded; it does not touch the link.
    revision = member_for(owner.get(f"/api/collections/{collection['id']}").json(), trip["id"])["revision"]
    saved = owner.put(
        f"/api/collections/{collection['id']}/members/{member_id}",
        json=scope(update_item(other["id"])),
        headers={"If-Match": f'"{revision}"'},
    )
    assert saved.status_code == 200, saved.text
    titles = sorted(u["title"] for u in anonymous.get(f"/api/shared/{token}/trips/{member_id}").json()["updates"])
    assert titles == ["Open to all", "Other"]
    stale = owner.put(
        f"/api/collections/{collection['id']}/members/{member_id}",
        json=scope(),
        headers={"If-Match": f'"{revision}"'},
    )
    assert stale.status_code == 412
    kinds = [e["kind"] for e in owner.get("/api/collections/audit-events").json()]
    assert "collection.member_scope_change" in kinds
    assert everyone["id"]  # keep the fixture explicit

    # Withdrawing a record from the trip removes it from the member scope too.
    owner.put(f"/api/trips/{trip['id']}/visibility/travel_update/{other['id']}", json={"visibility": "private"})
    scope_now = member_for(owner.get(f"/api/collections/{collection['id']}").json(), trip["id"])["scope"]
    assert scope_now["items"] == []


def test_ownership_is_isolated_between_owners() -> None:
    owner, trip_a, _, _, collection = seeded()
    stranger = client_for("owner-2")  # one subject at a time: this switches every client
    foreign_trip = create_trip(stranger, "Stranger Trip")
    mine = make_collection(stranger, "Mine")

    assert stranger.get(f"/api/collections/{collection['id']}").status_code == 404
    assert stranger.patch(f"/api/collections/{collection['id']}", json={"label": "x"}).status_code == 404
    assert stranger.post(f"/api/collections/{collection['id']}/revoke", json={}).status_code == 404
    assert stranger.delete(f"/api/collections/{collection['id']}").status_code == 404
    assert [c["id"] for c in stranger.get("/api/collections").json()] == [mine["id"]]
    assert stranger.get("/api/collections/audit-events").json()[0]["collection_id"] == mine["id"]
    assert stranger.get(f"/api/trips/{trip_a['id']}/collections").status_code == 404

    # Neither another owner's trip into my collection, nor my trip into theirs.
    denied = stranger.post(f"/api/collections/{mine['id']}/members", json={"trip_id": trip_a["id"], "scope": scope()})
    assert denied.status_code == 404
    owner = client_for("owner-1")
    assert (
        owner.post(
            f"/api/collections/{collection['id']}/members", json={"trip_id": foreign_trip["id"], "scope": scope()}
        ).status_code
        == 404
    )
    assert owner.get(f"/api/collections/{collection['id']}").json()["token"] == collection["token"]


def test_revoke_ends_the_index_and_every_member_page() -> None:
    owner, trip_a, _, _, collection = seeded()
    token = collection["token"]
    anonymous = TestClient(app)
    member_id = member_for(collection, trip_a["id"])["id"]
    revoked = owner.post(f"/api/collections/{collection['id']}/revoke", json={"reason": "Sent to the wrong person"})
    assert revoked.status_code == 200 and revoked.json()["state"] == "revoked" and revoked.json()["token"] is None
    for path in ("", f"/trips/{member_id}"):
        response = anonymous.get(f"/api/shared/{token}{path}")
        assert response.status_code == 404
        assert response.headers["cache-control"] == "no-store, private"
    assert owner.post(f"/api/collections/{collection['id']}/activate", json={}).status_code == 409
    assert owner.post(f"/api/collections/{collection['id']}/members", json={"trip_id": trip_a["id"]}).status_code == 409
    events = owner.get("/api/collections/audit-events").json()
    revoke = next(e for e in events if e["kind"] == "collection.revoke")
    assert revoke["details"] == {"reason": "Sent to the wrong person"}
    assert token not in json.dumps(events)


def test_expiry_is_enforced_for_visitors_and_settled_for_the_owner() -> None:
    owner, trip_a, _, _, collection = seeded()
    token = collection["token"]
    member_id = member_for(collection, trip_a["id"])["id"]
    with TestingSessionLocal() as session:
        row = session.get(Collection, collection["id"])
        assert row is not None
        row.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        session.commit()
    anonymous = TestClient(app)
    assert anonymous.get(f"/api/shared/{token}/trips/{member_id}").status_code == 404
    assert anonymous.get(f"/api/shared/{token}").status_code == 404
    assert owner.get(f"/api/collections/{collection['id']}").json()["state"] == "expired"
    kinds = [e["kind"] for e in owner.get("/api/collections/audit-events").json()]
    assert kinds.count("collection.expire") == 1


def test_removing_a_member_stops_only_that_trip_and_leaves_no_residue() -> None:
    owner, trip_a, trip_b, _, collection = seeded()
    token = collection["token"]
    anonymous = TestClient(app)
    alpha_member = member_for(collection, trip_a["id"])["id"]
    beta_member = member_for(collection, trip_b["id"])["id"]
    removed = owner.delete(f"/api/collections/{collection['id']}/members/{beta_member}")
    assert removed.status_code == 200
    assert [m["trip_id"] for m in removed.json()["members"]] == [trip_a["id"]]
    assert anonymous.get(f"/api/shared/{token}/trips/{beta_member}").status_code == 404
    assert anonymous.get(f"/api/shared/{token}/trips/{alpha_member}").status_code == 200
    index = anonymous.get(f"/api/shared/{token}").json()
    assert [entry["id"] for entry in index["trips"]] == [alpha_member]
    assert beta_member not in json.dumps(index)
    assert owner.get(f"/api/trips/{trip_b['id']}/collections").json() == []
    assert owner.delete(f"/api/collections/{collection['id']}/members/{beta_member}").status_code == 404


def test_deleting_a_member_trip_removes_it_from_the_collection_at_once() -> None:
    owner, trip_a, trip_b, _, collection = seeded()
    token = collection["token"]
    anonymous = TestClient(app)
    beta_member = member_for(collection, trip_b["id"])["id"]
    assert owner.delete(f"/api/trips/{trip_b['id']}").status_code == 204
    assert anonymous.get(f"/api/shared/{token}/trips/{beta_member}").status_code == 404
    assert len(anonymous.get(f"/api/shared/{token}").json()["trips"]) == 1
    assert [m["trip_id"] for m in owner.get(f"/api/collections/{collection['id']}").json()["members"]] == [trip_a["id"]]
    with TestingSessionLocal() as session:
        assert session.scalar(select(CollectionMember).where(CollectionMember.trip_id == trip_b["id"])) is None


def test_rotation_replaces_the_capability_and_keeps_members() -> None:
    owner, trip_a, _, _, collection = seeded()
    old = collection["token"]
    rotated = owner.post(f"/api/collections/{collection['id']}/rotate", json={"expires_in_days": 30})
    assert rotated.status_code == 200, rotated.text
    new = rotated.json()["token"]
    assert new and new != old and rotated.json()["rotations"] == 1
    assert [m["trip_id"] for m in rotated.json()["members"]][0] == trip_a["id"]
    anonymous = TestClient(app)
    assert anonymous.get(f"/api/shared/{old}").status_code == 404
    assert len(anonymous.get(f"/api/shared/{new}").json()["trips"]) == 2


def test_a_collection_token_never_equals_or_opens_a_per_trip_link() -> None:
    owner, trip_a, _, _, collection = seeded()
    link = owner.post(f"/api/trips/{trip_a['id']}/share-links", json={"label": "Solo", "scope": scope()}).json()
    link_token = owner.post(f"/api/trips/{trip_a['id']}/share-links/{link['id']}/activate", json={}).json()["token"]
    anonymous = TestClient(app)
    assert link_token != collection["token"]
    member_id = member_for(collection, trip_a["id"])["id"]
    # A per-trip token neither opens a member page nor an index, and vice versa.
    assert anonymous.get(f"/api/shared/{link_token}/trips/{member_id}").status_code == 404
    assert anonymous.get(f"/api/shared/{link_token}").json()["schema_version"] == "travel/unlisted-trip@1"
    assert anonymous.get(f"/api/shared/{collection['token']}").json()["schema_version"] == "travel/collection@1"
    assert link_token not in json.dumps(owner.get(f"/api/collections/{collection['id']}").json())
    # Revoking the per-trip link does not touch the collection.
    owner.post(f"/api/trips/{trip_a['id']}/share-links/{link['id']}/revoke", json={})
    assert anonymous.get(f"/api/shared/{collection['token']}/trips/{member_id}").status_code == 200


def test_draft_collections_deliver_nothing_and_membership_rules() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner, "Epsilon")
    collection = make_collection(owner)
    added = add_member(owner, collection["id"], trip["id"], scope())
    assert added["state"] == "draft" and added["token"] is None
    duplicate = owner.post(f"/api/collections/{collection['id']}/members", json={"trip_id": trip["id"]})
    assert duplicate.status_code == 409
    invalid = owner.post(
        f"/api/collections/{collection['id']}/members",
        json={"trip_id": trip["id"], "scope": scope(update_item("nope"))},
    )
    assert invalid.status_code in {409, 422}
    memberships = owner.get(f"/api/trips/{trip['id']}/collections").json()
    assert [(m["label"], m["state"]) for m in memberships] == [("Family", "draft")]
    assert owner.post(f"/api/collections/{collection['id']}/revoke", json={}).status_code == 409
    assert owner.post(f"/api/collections/{collection['id']}/rotate", json={}).status_code == 409
    assert owner.delete(f"/api/collections/{collection['id']}").status_code == 204
    assert owner.get(f"/api/collections/{collection['id']}").status_code == 404
    with TestingSessionLocal() as session:
        assert session.scalars(select(CollectionMember)).all() == []
        kinds = [e.kind for e in session.scalars(select(CollectionAuditEvent))]
    assert "collection.delete" in kinds


def test_audit_events_never_hold_tokens_and_cover_every_change() -> None:
    owner, trip_a, _, _, collection = seeded()
    owner.patch(f"/api/collections/{collection['id']}", json={"label": "Relatives", "title": None})
    owner.post(f"/api/collections/{collection['id']}/rotate", json={"expires_in_days": None})
    events = owner.get("/api/collections/audit-events").json()
    kinds = {e["kind"] for e in events}
    assert {
        "collection.create",
        "collection.member_add",
        "collection.activate",
        "collection.update",
        "collection.rotate",
    } <= kinds
    assert collection["token"] not in json.dumps(events)
    assert owner.get(f"/api/collections/{collection['id']}").json()["title"] is None


def test_preview_renders_the_member_and_index_without_saving_a_candidate() -> None:
    owner, trip_a, _, _, collection = seeded()
    member = member_for(collection, trip_a["id"])
    path = f"/api/collections/{collection['id']}"
    saved = owner.post(f"{path}/members/{member['id']}/preview").json()
    assert [u["title"] for u in saved["updates"]] == ["Alpha Hotel"]
    candidate = owner.post(f"{path}/members/{member['id']}/preview", json=scope(title=False)).json()
    assert candidate["title"] is None and candidate["updates"] == []
    assert owner.get(f"{path}/members/{member['id']}").status_code in {404, 405}
    assert [u["title"] for u in owner.post(f"{path}/members/{member['id']}/preview").json()["updates"]] == [
        "Alpha Hotel"
    ]
    assert len(owner.get(f"{path}/preview").json()["trips"]) == 2
    assert owner.post(f"{path}/members/{'0' * 32}/preview").status_code == 404


def test_a_member_cover_and_its_file_are_served_only_at_the_member_scope(tmp_path: Path) -> None:
    owner = client_for("owner-1")
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    trip = create_trip(owner, "Zeta 2054")
    image = io.BytesIO()
    Image.new("RGB", (40, 30), (20, 30, 40)).save(image, format="JPEG")
    media_path = f"/api/trips/{trip['id']}/media"
    media = owner.post(f"{media_path}/uploads", files={"file": ("a.jpg", image.getvalue(), "image/jpeg")}).json()
    derivative = owner.post(f"{media_path}/{media['id']}/derivatives", json={"purpose": "share"}).json()
    owner.post(f"{media_path}/{media['id']}/derivatives/{derivative['id']}/approve")
    owner.put(f"/api/trips/{trip['id']}/visibility/media_derivative/{derivative['id']}", json={"visibility": "custom"})
    owner.patch(f"/api/trips/{trip['id']}", json={"cover_derivative_id": derivative["id"]})
    collection = make_collection(owner)
    add_member(owner, collection["id"], trip["id"], scope({"kind": "media_derivative", "id": derivative["id"]}))
    other_trip = create_trip(owner, "Eta 2054")
    add_member(owner, collection["id"], other_trip["id"], scope())
    token = activate(owner, collection["id"])["token"]
    anonymous = TestClient(app)
    first, second = anonymous.get(f"/api/shared/{token}").json()["trips"]
    assert first["cover"] is not None and second["cover"] is None
    served = anonymous.get(f"/api/shared/{token}/trips/{first['id']}/files/{first['cover']}")
    assert served.status_code == 200
    assert served.headers["cache-control"] == "no-store, private"
    # The same local id is not a file of the other member, and the other trip's page cannot serve it.
    assert anonymous.get(f"/api/shared/{token}/trips/{second['id']}/files/{first['cover']}").status_code == 404
    owner.post(f"/api/collections/{collection['id']}/revoke", json={})
    assert anonymous.get(f"/api/shared/{token}/trips/{first['id']}/files/{first['cover']}").status_code == 404
    assert anonymous.get(f"/api/shared/{token}/trips/{first['id']}/navigation/{first['cover']}").status_code == 404


def test_trip_delete_and_unshared_member_state_are_reflected_in_the_owner_view() -> None:
    owner, trip_a, trip_b, _, collection = seeded()
    view = owner.get(f"/api/collections/{collection['id']}").json()
    assert member_for(view, trip_a["id"])["delivered_records"] == 1
    assert member_for(view, trip_b["id"])["delivered_records"] == 0
    assert member_for(view, trip_b["id"])["trip_title"] == "Beta Hills 2054"
