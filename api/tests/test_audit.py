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
    response = client.post("/api/v1/trips", json={"title": title, "summary": "A private trip."})
    assert response.status_code == 201, response.text
    return response.json()


def audit_events(client: TestClient, trip_id: str) -> list[dict]:
    response = client.get(f"/api/v1/trips/{trip_id}/audit-events")
    assert response.status_code == 200, response.text
    return response.json()


def test_public_projection_publish_and_unpublish_are_audited_with_an_owner_reason() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    owner.put(f"/api/v1/trips/{trip['id']}/public-projection", json={"route_stage_ids": [], "moment_ids": []})
    owner.post(f"/api/v1/trips/{trip['id']}/public-projection/publish")
    owner.post(
        f"/api/v1/trips/{trip['id']}/public-projection/unpublish", json={"reason": "Trip is over"}
    )

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
        f"/api/v1/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": {"route_stage_ids": [], "moment_ids": []}},
    )
    link_id = created.json()["id"]
    activated = owner.post(
        f"/api/v1/trips/{trip['id']}/share-links/{link_id}/activate", json={"expires_in_days": 30}
    )
    token = activated.json()["token"]

    rotated = owner.post(f"/api/v1/trips/{trip['id']}/share-links/{link_id}/rotate", json={"expires_in_days": 30})
    new_link_id = rotated.json()["id"]

    revoked = owner.post(f"/api/v1/trips/{trip['id']}/share-links/{new_link_id}/revoke", json={"reason": "Leaked"})
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
        f"/api/v1/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": {"route_stage_ids": [], "moment_ids": []}},
    )
    link_id = created.json()["id"]
    activated = owner.post(
        f"/api/v1/trips/{trip['id']}/share-links/{link_id}/activate", json={"expires_in_days": 1}
    )
    token = activated.json()["token"]

    with TestingSessionLocal() as session:
        row = session.scalar(select(ShareLink).where(ShareLink.id == link_id))
        row.expires_at = datetime.now(UTC) - timedelta(days=1)
        session.commit()

    anonymous = TestClient(app)
    assert anonymous.get(f"/api/v1/shared/{token}").status_code == 404

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
    owner.post(f"/api/v1/trips/{trip['id']}/public-projection/publish")

    stranger = client_for("owner-2")
    response = stranger.get(f"/api/v1/trips/{trip['id']}/audit-events")
    assert response.status_code == 404


def test_purge_expired_audit_events_keeps_recent_and_removes_events_past_the_window() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    owner.post(f"/api/v1/trips/{trip['id']}/public-projection/publish")

    with TestingSessionLocal() as session:
        recent_kept = purge_expired_audit_events(session, older_than=timedelta(days=730))
        assert recent_kept == 0
        assert session.scalar(select(AuditEvent).where(AuditEvent.trip_id == trip["id"])) is not None

    with TestingSessionLocal() as session:
        purged = purge_expired_audit_events(session, older_than=timedelta(seconds=-1))
        assert purged == 1
        assert session.scalar(select(AuditEvent).where(AuditEvent.trip_id == trip["id"])) is None
