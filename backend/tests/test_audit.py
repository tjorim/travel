import json
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
            "share_date_precision": "day",
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


def test_purge_bounds_both_audit_tables_at_the_same_exact_cutoff(monkeypatch) -> None:
    from app import audit
    from app.models import OwnerActivityEvent

    now = datetime(2054, 6, 1, tzinfo=UTC)

    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now

    monkeypatch.setattr(audit, "datetime", FrozenDatetime)
    cutoff = now - audit.RETENTION_WINDOW
    owner = client_for("owner-1")
    trip = create_trip(owner)
    owner.post(f"/api/trips/{trip['id']}/public-projection/publish")
    with TestingSessionLocal() as session:
        session.scalar(select(AuditEvent)).occurred_at = cutoff - timedelta(microseconds=1)
        for subject in ("owner-1", "owner-2"):
            for offset in (-1, 0, 1):
                session.add(
                    OwnerActivityEvent(
                        owner_subject=subject,
                        transport="mcp",
                        action="trip.read",
                        resource_type="trip",
                        trip_id="deleted-synthetic-trip",
                        result="succeeded",
                        occurred_at=cutoff + timedelta(microseconds=offset),
                        details={},
                    )
                )
        session.commit()
        assert purge_expired_audit_events(session) == 3
        assert session.scalar(select(AuditEvent)) is None
        retained = list(session.scalars(select(OwnerActivityEvent)))
        assert len(retained) == 4
        assert {row.owner_subject for row in retained} == {"owner-1", "owner-2"}
        assert all(row.occurred_at.replace(tzinfo=UTC) >= cutoff for row in retained)
        assert all(row.details == {} for row in retained)


def test_audit_purge_failure_can_roll_back_both_histories(monkeypatch) -> None:
    import pytest
    from sqlalchemy import event

    from app.models import OwnerActivityEvent

    owner = client_for("owner-1")
    trip = create_trip(owner)
    owner.post(f"/api/trips/{trip['id']}/public-projection/publish")
    with TestingSessionLocal() as session:
        session.add(
            OwnerActivityEvent(
                owner_subject="owner-1",
                transport="mcp",
                action="trip.read",
                resource_type="trip",
                result="succeeded",
                details={},
            )
        )
        session.commit()

        def reject_mcp_delete(state):
            if state.is_delete and state.statement.table.name == "owner_activity_events":
                raise RuntimeError("synthetic database outage")

        event.listen(session, "do_orm_execute", reject_mcp_delete)
        with pytest.raises(RuntimeError, match="synthetic database outage"):
            purge_expired_audit_events(session, older_than=timedelta(seconds=-1))
        session.rollback()
        assert len(list(session.scalars(select(AuditEvent)))) == 1
        assert len(list(session.scalars(select(OwnerActivityEvent)))) == 1


def test_sharing_audit_events_survive_trip_deletion_and_hold_only_ids() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner, title="Secret Exampleland Title")
    owner.post(f"/api/trips/{trip['id']}/public-projection/publish")
    link = owner.post(f"/api/trips/{trip['id']}/share-links", json={"label": "Secret Family Label", "scope": SCOPE})
    assert link.status_code == 201, link.text
    activate = f"/api/trips/{trip['id']}/share-links/{link.json()['id']}/activate"
    assert owner.post(activate, json={"expires_in_days": 30}).status_code == 200
    owner.post(f"/api/trips/{trip['id']}/share-links/{link.json()['id']}/revoke", json={"reason": "Done"})
    assert owner.delete(f"/api/trips/{trip['id']}").status_code == 204

    # The owner no longer reads the trip's history; the rows stay until their 24-month expiry.
    assert owner.get(f"/api/trips/{trip['id']}/audit-events").status_code == 404
    with TestingSessionLocal() as session:
        rows = list(session.scalars(select(AuditEvent).where(AuditEvent.trip_id == trip["id"])))
        assert {row.kind for row in rows} >= {"public_projection.publish", "share_link.create", "share_link.revoke"}
        stored = json.dumps([[row.kind, row.target_id, row.details] for row in rows])
        assert "Secret Exampleland Title" not in stored and "Secret Family Label" not in stored
        assert not AuditEvent.__table__.c.trip_id.foreign_keys
        count = len(rows)
    with TestingSessionLocal() as session:
        assert purge_expired_audit_events(session, older_than=timedelta(seconds=-1)) == count


def test_the_audit_tables_validate_their_kinds_when_a_row_is_written() -> None:
    import pytest

    from app.models import ActivityTransport, AuditEventKind, CollectionAuditEvent, OwnerActivityEvent

    event = AuditEvent(trip_id="t", actor_subject="o", kind=AuditEventKind.SHARE_LINK_CREATE, target_type="share_link")
    assert event.kind == "share_link.create" and type(event.kind) is str
    with pytest.raises(ValueError, match="AuditEventKind"):
        AuditEvent(trip_id="t", actor_subject="o", kind="share_link.unknown", target_type="share_link")
    with pytest.raises(ValueError, match="AuditTargetType"):
        AuditEvent(trip_id="t", actor_subject="o", kind="share_link.create", target_type="trip")
    with pytest.raises(ValueError, match="CollectionAuditKind"):
        CollectionAuditEvent(owner_subject="o", actor_subject="o", collection_id="c", kind="collection.unknown")
    activity = OwnerActivityEvent(
        owner_subject="o",
        transport=ActivityTransport.HTTP,
        action="trip.export",
        resource_type="trip",
        result="success",
    )
    assert activity.transport == "http" and type(activity.transport) is str
    with pytest.raises(ValueError, match="ActivityTransport"):
        OwnerActivityEvent(owner_subject="o", transport="smtp", action="trip.export", resource_type="trip")
    with pytest.raises(ValueError, match="action"):
        OwnerActivityEvent(owner_subject="o", transport="mcp", action="Trip Export!", resource_type="trip")


def test_purge_removes_all_three_audit_tables_in_one_transaction_including_deleted_trips_and_collections() -> None:
    from app.models import CollectionAuditEvent, OwnerActivityEvent

    owner = client_for("owner-1")
    trip = create_trip(owner)
    owner.post(f"/api/trips/{trip['id']}/public-projection/publish")
    collection = owner.post("/api/collections", json={"label": "Family"})
    assert collection.status_code == 201, collection.text
    owner.delete(f"/api/trips/{trip['id']}")
    owner.delete(f"/api/collections/{collection.json()['id']}")
    with TestingSessionLocal() as session:
        session.add(
            OwnerActivityEvent(
                owner_subject="owner-1",
                transport="http",
                action="trip.export",
                resource_type="trip",
                trip_id=trip["id"],
                result="success",
            )
        )
        session.commit()
        assert session.scalar(select(AuditEvent)) is not None
        assert session.scalar(select(CollectionAuditEvent)) is not None
        assert purge_expired_audit_events(session, older_than=timedelta(days=730)) == 0

        commits = []
        original_commit = session.commit
        session.commit = lambda: (commits.append(1), original_commit())[1]  # type: ignore[method-assign]
        purged = purge_expired_audit_events(session, older_than=timedelta(seconds=-1))
        assert purged >= 4 and commits == [1]
        for model in (AuditEvent, CollectionAuditEvent, OwnerActivityEvent):
            assert session.scalar(select(model)) is None
