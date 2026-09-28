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
