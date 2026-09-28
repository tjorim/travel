from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import schemas
from app.auth import current_subject
from app.config import settings
from app.database import Base, get_session
from app.main import app
from app.mcp_server import TravelMcpBackend
from app.models import McpAuditEvent

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


@event.listens_for(engine, "connect")
def enable_foreign_keys(connection: object, _: object) -> None:
    connection.execute("PRAGMA foreign_keys=ON")


def override_session() -> Generator[Session]:
    with TestingSessionLocal() as session:
        yield session


def client_for(subject: str) -> TestClient:
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[current_subject] = lambda: subject
    return TestClient(app)


def setup_function() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def teardown_function() -> None:
    app.dependency_overrides.clear()


def test_owner_packing_order_moves_and_deletion() -> None:
    owner = client_for("owner-1")
    trip = owner.post("/api/trips", json={"title": "Exampleland"}).json()
    other = owner.post("/api/trips", json={"title": "Other"}).json()
    root = f"/api/trips/{trip['id']}/packing-lists"
    packing_list = owner.post(root, json={}).json()
    base = f"{root}/{packing_list['id']}"
    bags = [
        owner.post(f"{base}/bags", json={"name": name, "weight_limit_g": 7000}).json()
        for name in ("Cabin", "Checked", "Overnight", "Person")
    ]
    assert [bag["position"] for bag in bags] == [0, 1, 2, 3]
    assert owner.patch(f"{base}/bags/{bags[3]['id']}", json={"position": 0}).json()["position"] == 0
    assert [bag["name"] for bag in owner.get(f"{base}/bags").json()] == ["Person", "Cabin", "Checked", "Overnight"]
    assert owner.get(f"{base}/bags").json()[0]["weight_limit_g"] == 7000

    batch = owner.post(
        f"{base}/items/batch",
        json=[
            {"label": "Passport", "essential": True, "weight_g": 50},
            {"label": "Charger", "quantity": 2, "category": "Electronics", "bag_id": bags[0]["id"]},
            {"label": "Shirt", "bag_id": bags[0]["id"]},
        ],
    )
    assert batch.status_code == 201, batch.text
    passport, charger, shirt = batch.json()
    assert passport["bag_id"] is None
    assert passport["weight_g"] == 50
    assert charger["quantity"] == 2
    assert owner.patch(f"{base}/items/{shirt['id']}", json={"position": 0, "packed": True}).json()["packed"]
    assert [
        (item["label"], item["position"])
        for item in owner.get(f"{base}/items").json()
        if item["bag_id"] == bags[0]["id"]
    ] == [("Shirt", 0), ("Charger", 1)]
    moved = owner.patch(f"{base}/items/{shirt['id']}", json={"bag_id": bags[2]["id"], "position": 0}).json()
    assert moved["bag_id"] == bags[2]["id"]
    assert owner.patch(f"{base}/items/{shirt['id']}", json={"packed": False}).json()["packed"] is False
    assert owner.get(f"{base}/items/{charger['id']}").json()["position"] == 0

    assert owner.post(f"{base}/items", json={"label": "Bad", "quantity": 0}).status_code == 422
    assert owner.post(f"{base}/items", json={"label": "Bad", "bag_id": "missing"}).status_code == 422
    assert (
        owner.post(f"{base}/items", json={"label": "Bad", "cabin_only": True, "checked_only": True}).status_code == 422
    )
    other_list = owner.post(f"/api/trips/{other['id']}/packing-lists", json={}).json()
    foreign_bag = owner.post(
        f"/api/trips/{other['id']}/packing-lists/{other_list['id']}/bags", json={"name": "Foreign"}
    ).json()
    assert owner.patch(f"{base}/items/{charger['id']}", json={"bag_id": foreign_bag["id"]}).status_code == 422
    count_before = len(owner.get(f"{base}/items").json())
    assert (
        owner.post(
            f"{base}/items/batch",
            json=[{"label": "Should roll back"}, {"label": "Wrong list", "bag_id": foreign_bag["id"]}],
        ).status_code
        == 422
    )
    assert len(owner.get(f"{base}/items").json()) == count_before
    assert owner.get(f"/api/trips/{other['id']}/packing-lists/{packing_list['id']}").status_code == 404
    assert (
        owner.get(f"/api/trips/{other['id']}/packing-lists/{packing_list['id']}/items/{shirt['id']}").status_code == 404
    )

    assert owner.delete(f"{base}/bags/{bags[0]['id']}").status_code == 204
    assert owner.get(f"{base}/items/{charger['id']}").json()["bag_id"] is None
    assert owner.get(f"{base}/items/{charger['id']}").json()["position"] == 1
    stranger = client_for("owner-2")
    assert stranger.get(root).status_code == 404
    assert stranger.get(f"{base}/items/{charger['id']}").status_code == 404
    owner = client_for("owner-1")
    assert owner.delete(f"{base}").status_code == 204
    assert owner.get(f"{base}/items").status_code == 404
    assert "packing" not in owner.get(f"/api/trips/{trip['id']}").text.lower()
    assert owner.delete(f"/api/trips/{other['id']}").status_code == 204


def test_packing_never_enters_public_or_unlisted_projection() -> None:
    owner = client_for("owner-1")
    trip = owner.post("/api/trips", json={"title": "Exampleland"}).json()
    root = f"/api/trips/{trip['id']}"
    packing_list = owner.post(f"{root}/packing-lists", json={}).json()
    owner.post(
        f"{root}/packing-lists/{packing_list['id']}/items", json={"label": "Private medicine", "notes": "Never share"}
    )
    scope = {"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": False}, "items": []}
    assert owner.put(f"{root}/public-projection", json=scope).status_code == 200
    published = owner.post(f"{root}/public-projection/publish")
    assert published.status_code == 200, published.text
    link = owner.post(f"{root}/share-links", json={"label": "Family", "scope": scope}).json()
    assert owner.post(f"{root}/share-links/{link['id']}/preview").status_code == 200
    activated = owner.post(f"{root}/share-links/{link['id']}/activate", json={"expires_in_days": 30})
    assert activated.status_code == 200, activated.text
    visitor = TestClient(app)
    for path in (f"/api/public/trips/{published.json()['slug']}", f"/api/shared/{activated.json()['token']}"):
        response = visitor.get(path)
        assert response.status_code == 200
        assert "packing" not in response.text.lower()
        assert "Private medicine" not in response.text
        assert "Never share" not in response.text


def test_mcp_packing_flow_and_payload_free_audit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "mcp_development_subject", "owner-1")
    backend = TravelMcpBackend(TestingSessionLocal)
    trip = backend.create_trip(schemas.TripCreate(title="Exampleland"))
    packing_list = backend.create_packing_list(trip["id"], schemas.PackingListCreate())
    bag = backend.create_packing_bag(
        trip["id"], packing_list["id"], schemas.PackingBagCreate(name="Cabin", weight_limit_g=7000)
    )
    items = backend.batch_create_packing_items(
        trip["id"],
        packing_list["id"],
        [
            schemas.PackingItemCreate(label="Passport", bag_id=bag["id"]),
            schemas.PackingItemCreate(label="Private medicine", notes="Sensitive detail"),
        ],
    )
    assert len(backend.list_packing_items(trip["id"], packing_list["id"])) == 2
    assert backend.get_packing_bag(trip["id"], packing_list["id"], bag["id"])["weight_limit_g"] == 7000
    assert backend.mark_packing_item(trip["id"], packing_list["id"], items[0]["id"], True)["packed"] is True
    assert backend.move_packing_item(trip["id"], packing_list["id"], items[0]["id"], None, 0)["bag_id"] is None
    assert backend.get_packing_item(trip["id"], packing_list["id"], items[0]["id"])["packed"] is True
    with pytest.raises(ValueError, match="confirm=true"):
        backend.delete_packing_list(trip["id"], packing_list["id"])
    assert backend.delete_packing_bag(trip["id"], packing_list["id"], bag["id"], confirm=True) == {"status": "deleted"}
    assert backend.delete_packing_list(trip["id"], packing_list["id"], confirm=True) == {"status": "deleted"}
    with TestingSessionLocal() as session:
        events = list(session.scalars(select(McpAuditEvent).where(McpAuditEvent.action.like("packing_%"))))
        assert events
        assert all("Private medicine" not in str(event.details) for event in events)
        assert all("Sensitive detail" not in str(event.details) for event in events)


def test_copy_and_templates_reset_packed_state_and_keep_owner_isolation() -> None:
    owner = client_for("owner-1")
    source_trip = owner.post("/api/trips", json={"title": "Source"}).json()
    target_trip = owner.post("/api/trips", json={"title": "Target"}).json()
    source_root = f"/api/trips/{source_trip['id']}/packing-lists"
    target_root = f"/api/trips/{target_trip['id']}/packing-lists"
    source = owner.post(source_root, json={"name": "Original"}).json()
    source_path = f"{source_root}/{source['id']}"
    bag = owner.post(f"{source_path}/bags", json={"name": "Cabin", "type": "cabin", "weight_limit_g": 5000}).json()
    owner.post(
        f"{source_path}/items",
        json={
            "label": "Passport",
            "bag_id": bag["id"],
            "packed": True,
            "essential": True,
            "last_minute": True,
            "notes": "Check expiry",
            "category": "Documents",
            "quantity": 2,
        },
    ).json()
    owner.post(f"{source_path}/items", json={"label": "Keys", "last_minute": True, "packed": True}).json()
    template = owner.post(f"{source_path}/templates", json={"name": "Personal"})
    assert template.status_code == 201, template.text
    template_id = template.json()["id"]
    assert len(owner.get("/api/packing-templates").json()) == 1
    assert len(owner.get("/api/packing-list-sources").json()) == 1

    for payload in ({"copy_from_list_id": source["id"]}, {"template_ids": [template_id]}):
        created = owner.post(target_root, json={"name": "Fresh", **payload})
        assert created.status_code == 201, created.text
        copied_path = f"{target_root}/{created.json()['id']}"
        bags = owner.get(f"{copied_path}/bags").json()
        items = owner.get(f"{copied_path}/items").json()
        assert [(row["name"], row["type"], row["weight_limit_g"]) for row in bags] == [("Cabin", "cabin", 5000)]
        assert all(not row["packed"] for row in items)
        passport = next(row for row in items if row["label"] == "Passport")
        assert passport["bag_id"] == bags[0]["id"] != bag["id"]
        assert (passport["essential"], passport["last_minute"], passport["notes"], passport["quantity"]) == (
            True,
            True,
            "Check expiry",
            2,
        )

    stranger = client_for("owner-2")
    stranger_trip = stranger.post("/api/trips", json={"title": "Stranger"}).json()
    stranger_root = f"/api/trips/{stranger_trip['id']}/packing-lists"
    assert stranger.get("/api/packing-templates").json() == []
    assert stranger.get("/api/packing-list-sources").json() == []
    assert stranger.post(stranger_root, json={"copy_from_list_id": source["id"]}).status_code == 404
    assert stranger.post(stranger_root, json={"template_ids": [template_id]}).status_code == 404
    assert stranger.delete(f"/api/packing-templates/{template_id}").status_code == 404

    owner = client_for("owner-1")
    second = owner.post(source_root, json={"name": "Other structure"}).json()
    second_path = f"{source_root}/{second['id']}"
    second_bag = owner.post(f"{second_path}/bags", json={"name": "Day bag"}).json()
    owner.post(f"{second_path}/items", json={"label": "Map", "bag_id": second_bag["id"], "packed": True})
    second_template = owner.post(f"{second_path}/templates", json={"name": "Day"}).json()
    combined = owner.post(target_root, json={"template_ids": [template_id, second_template["id"]]}).json()
    combined_path = f"{target_root}/{combined['id']}"
    assert [row["name"] for row in owner.get(f"{combined_path}/bags").json()] == ["Cabin", "Day bag"]
    assert all(not row["packed"] for row in owner.get(f"{combined_path}/items").json())
    assert owner.post(target_root, json={"template_ids": [template_id, template_id]}).status_code == 422


def test_suggestions_use_only_owner_history_and_require_three_prior_trips() -> None:
    owner = client_for("owner-1")
    target = owner.post("/api/trips", json={"title": "Target"}).json()
    target_list = owner.post(f"/api/trips/{target['id']}/packing-lists", json={}).json()
    target_path = f"/api/trips/{target['id']}/packing-lists/{target_list['id']}"
    for index in range(3):
        trip = owner.post("/api/trips", json={"title": f"Prior {index}"}).json()
        packing_list = owner.post(f"/api/trips/{trip['id']}/packing-lists", json={}).json()
        path = f"/api/trips/{trip['id']}/packing-lists/{packing_list['id']}"
        bag = owner.post(f"{path}/bags", json={"name": "Cabin", "type": "cabin"}).json()
        owner.post(f"{path}/items", json={"label": "Charger", "bag_id": bag["id"], "essential": True})
    stranger = client_for("owner-2")
    trip = stranger.post("/api/trips", json={"title": "Private"}).json()
    packing_list = stranger.post(f"/api/trips/{trip['id']}/packing-lists", json={}).json()
    stranger.post(f"/api/trips/{trip['id']}/packing-lists/{packing_list['id']}/items", json={"label": "Secret"})
    owner = client_for("owner-1")
    suggestions = owner.get(f"{target_path}/suggestions").json()
    assert suggestions == [
        {"label": "Charger", "category": None, "prior_trips": 3, "usually_cabin": True, "usually_essential": True}
    ]
    owner.post(f"{target_path}/items", json={"label": "Charger"})
    assert owner.get(f"{target_path}/suggestions").json() == []
