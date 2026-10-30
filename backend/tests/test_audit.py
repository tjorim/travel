from collections.abc import Generator
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.audit import purge_expired_audit_events
from app.auth import current_subject
from app.database import Base, get_session
from app.main import app
from app.models import AuditEvent, ShareLink

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


def create_trip(client: TestClient, title: str = "Exampleland 2054") -> dict:
    response = client.post("/api/trips", json={"title": title, "summary": "A private trip."})
    assert response.status_code == 201, response.text
    return response.json()


def audit_events(client: TestClient, trip_id: str) -> list[dict]:
    response = client.get(f"/api/trips/{trip_id}/audit-events")
    assert response.status_code == 200, response.text
    return response.json()


def test_public_projection_publish_and_unpublish_are_audited_with_an_owner_reason() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    owner.put(f"/api/trips/{trip['id']}/public-projection", json={"items": []})
    owner.post(f"/api/trips/{trip['id']}/public-projection/publish")
    owner.post(f"/api/trips/{trip['id']}/public-projection/unpublish", json={"reason": "Trip is over"})

    events = audit_events(owner, trip["id"])
    kinds = [event["kind"] for event in events]
    assert "public_projection.publish" in kinds
    assert "public_projection.unpublish" in kinds
    unpublish = next(event for event in events if event["kind"] == "public_projection.unpublish")
    assert unpublish["target_type"] == "public_surface"
    assert unpublish["target_id"] == trip["id"]
    assert unpublish["details"]["reason"] == "Trip is over"
    assert "scope_version" in unpublish["details"]


def test_share_link_lifecycle_transitions_are_each_audited() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)

    created = owner.post(
        f"/api/trips/{trip['id']}/share-links",
        json={
            "label": "Family",
            "scope": {"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": []},
        },
    )
    link_id = created.json()["id"]
    activated = owner.post(f"/api/trips/{trip['id']}/share-links/{link_id}/activate", json={"expires_in_days": 30})
    token = activated.json()["token"]

    rotated = owner.post(f"/api/trips/{trip['id']}/share-links/{link_id}/rotate", json={"expires_in_days": 30})
    new_link_id = rotated.json()["id"]

    revoked = owner.post(f"/api/trips/{trip['id']}/share-links/{new_link_id}/revoke", json={"reason": "Leaked"})
    assert revoked.status_code == 200

    events = audit_events(owner, trip["id"])
    create_events = [event for event in events if event["kind"] == "share_link.create"]
    assert create_events[0]["target_id"] == link_id

    # The activate and rotate events share a target id lineage: the original
    # link is activated once, then rotate mints a *new* link row.
    activate_events = [event for event in events if event["kind"] == "share_link.activate"]
    assert activate_events[0]["target_id"] == link_id

    rotate_events = [event for event in events if event["kind"] == "share_link.rotate"]
    assert rotate_events[0]["target_id"] == new_link_id
    assert rotate_events[0]["details"]["predecessor_id"] == link_id

    revoke_events = [event for event in events if event["kind"] == "share_link.revoke"]
    assert revoke_events[0]["target_id"] == new_link_id
    assert revoke_events[0]["details"]["reason"] == "Leaked"

    # No raw token, recipient identity, or recipient IP ever appears.
    serialized = str(events)
    assert token not in serialized


def test_a_naturally_expiring_share_link_is_audited_as_a_system_action() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    created = owner.post(
        f"/api/trips/{trip['id']}/share-links",
        json={
            "label": "Family",
            "scope": {"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": []},
        },
    )
    link_id = created.json()["id"]
    activated = owner.post(f"/api/trips/{trip['id']}/share-links/{link_id}/activate", json={"expires_in_days": 1})
    token = activated.json()["token"]

    with TestingSessionLocal() as session:
        row = session.scalar(select(ShareLink).where(ShareLink.id == link_id))
        row.expires_at = datetime.now(UTC) - timedelta(days=1)
        session.commit()

    anonymous = TestClient(app)
    assert anonymous.get(f"/api/shared/{token}").status_code == 404

    events = audit_events(owner, trip["id"])
    expire_events = [event for event in events if event["kind"] == "share_link.expire"]
    assert len(expire_events) == 1
    assert expire_events[0]["target_id"] == link_id

    with TestingSessionLocal() as session:
        row = session.scalar(select(AuditEvent).where(AuditEvent.id == expire_events[0]["id"]))
        assert row.actor_subject == "system"


def test_a_non_owner_cannot_read_another_owners_audit_history() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    owner.post(f"/api/trips/{trip['id']}/public-projection/publish")

    stranger = client_for("owner-2")
    response = stranger.get(f"/api/trips/{trip['id']}/audit-events")
    assert response.status_code == 404


def test_purge_expired_audit_events_keeps_recent_and_removes_events_past_the_window() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    owner.post(f"/api/trips/{trip['id']}/public-projection/publish")

    with TestingSessionLocal() as session:
        recent_kept = purge_expired_audit_events(session, older_than=timedelta(days=730))
        assert recent_kept == 0
        assert session.scalar(select(AuditEvent).where(AuditEvent.trip_id == trip["id"])) is not None

    with TestingSessionLocal() as session:
        purged = purge_expired_audit_events(session, older_than=timedelta(seconds=-1))
        assert purged == 1
        assert session.scalar(select(AuditEvent).where(AuditEvent.trip_id == trip["id"])) is None


SCOPE = {"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": []}


def kinds(client: TestClient, trip_id: str) -> list[str]:
    return [event["kind"] for event in audit_events(client, trip_id)]


def add_update(client: TestClient, trip_id: str, visibility: str = "private") -> dict:
    response = client.post(
        f"/api/trips/{trip_id}/travel-updates",
        json={
            "occurred_at": "2054-04-04T10:00:00Z",
            "date_precision": "day",
            "title": "Secret title",
            "body": "Secret body",
            "visibility": visibility,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_public_scope_change_is_audited_only_while_published_and_when_it_changes() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    path = f"/api/trips/{trip['id']}/public-projection"
    owner.put(path, json=SCOPE)
    assert "public_projection.scope_change" not in kinds(owner, trip["id"])
    owner.post(f"{path}/publish")
    owner.put(path, json=SCOPE)
    assert "public_projection.scope_change" not in kinds(owner, trip["id"])
    owner.put(path, json={**SCOPE, "trip": {"title": False, "summary": True}})
    event = next(e for e in audit_events(owner, trip["id"]) if e["kind"] == "public_projection.scope_change")
    assert set(event["details"]) == {"scope_version_before", "scope_version_after"}
    assert event["details"]["scope_version_before"] != event["details"]["scope_version_after"]


def test_invalid_scope_records_nothing() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    path = f"/api/trips/{trip['id']}/public-projection"
    owner.post(f"{path}/publish")
    bad = {**SCOPE, "items": [{"kind": "travel_update", "id": "missing"}]}
    assert owner.put(path, json=bad).status_code == 422
    assert "public_projection.scope_change" not in kinds(owner, trip["id"])


def test_share_link_scope_change_is_audited_for_active_links_only() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}/share-links"
    link = owner.post(base, json={"label": "Family", "scope": SCOPE}).json()
    narrowed = {**SCOPE, "trip": {"title": False, "summary": True}}
    assert owner.patch(f"{base}/{link['id']}", json={"scope": narrowed}).status_code == 200
    assert "share_link.scope_change" not in kinds(owner, trip["id"])
    assert owner.post(f"{base}/{link['id']}/activate", json={}).status_code == 200
    assert owner.patch(f"{base}/{link['id']}", json={"label": "Renamed"}).status_code == 200
    assert owner.patch(f"{base}/{link['id']}", json={"scope": SCOPE}).status_code == 200
    bad = {**SCOPE, "items": [{"kind": "travel_update", "id": "missing"}]}
    assert owner.patch(f"{base}/{link['id']}", json={"scope": bad}).status_code == 422
    events = [e for e in audit_events(owner, trip["id"]) if e["kind"] == "share_link.scope_change"]
    assert len(events) == 1
    assert events[0]["target_id"] == link["id"]


def test_visibility_changes_name_the_audiences_reached_without_content() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    owner.post(f"/api/trips/{trip['id']}/public-projection/publish")
    update = add_update(owner, trip["id"])
    path = f"/api/trips/{trip['id']}/visibility/travel_update/{update['id']}"
    assert owner.put(path, json={"visibility": "private"}).status_code == 200
    assert "record.visibility_change" not in kinds(owner, trip["id"])
    assert owner.put(path, json={"visibility": "everyone"}).status_code == 200
    assert (
        owner.put(
            "/api/trips/" + trip["id"] + "/visibility/travel_update/missing", json={"visibility": "everyone"}
        ).status_code
        == 404
    )
    assert owner.put(path, json={"visibility": "private"}).status_code == 200
    events = [e for e in audit_events(owner, trip["id"]) if e["kind"] == "record.visibility_change"]
    assert len(events) == 2
    reached = next(e for e in events if e["details"]["to"] == "everyone")
    assert reached["target_type"] == "record"
    assert reached["target_id"] == update["id"]
    assert reached["details"]["record_kind"] == "travel_update"
    assert reached["details"]["newly_reached"] == ["public"]
    withdrawn = next(e for e in events if e["details"]["to"] == "private")
    assert withdrawn["details"]["no_longer_reached"] == ["public"]
    assert "Secret" not in str(events)


def test_travel_update_visibility_through_create_and_patch_is_audited() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    update = add_update(owner, trip["id"], "everyone")
    assert kinds(owner, trip["id"]) == ["record.visibility_change"]
    patch = f"/api/trips/{trip['id']}/travel-updates/{update['id']}"
    assert owner.patch(patch, json={"visibility": "private"}).status_code == 200
    assert kinds(owner, trip["id"]).count("record.visibility_change") == 2
