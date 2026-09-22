from collections.abc import Generator
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.database import Base, get_session
from app.main import app
from app.models import ShareLink

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


def add_route_stage(client: TestClient, trip_id: str, position: int, label: str, city: str) -> dict:
    response = client.post(
        f"/api/v1/trips/{trip_id}/route-stages",
        json={"position": position, "label": label, "place": {"label": city, "country_code": "TW"}},
    )
    assert response.status_code == 201, response.text
    return response.json()


def add_moment(client: TestClient, trip_id: str, title: str, city: str) -> dict:
    response = client.post(
        f"/api/v1/trips/{trip_id}/moments",
        json={
            "occurred_at": "2054-04-04T10:00:00Z",
            "title": title,
            "story": f"A note about {title}.",
            "place": {"locality": city, "country_code": "TW"},
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


# --- Public follower view -----------------------------------------------------------


def test_public_projection_exposes_only_selected_items_and_reflects_later_edits_to_them() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    shown = add_moment(owner, trip["id"], "Hotel check-in", "Taipei")
    hidden = add_moment(owner, trip["id"], "Factory visit", "Hsinchu")

    scope = {
        "include_title": True,
        "include_summary": False,
        "route_stage_ids": [],
        "moment_ids": [shown["id"]],
    }
    assert owner.put(f"/api/v1/trips/{trip['id']}/public-projection", json=scope).status_code == 200

    preview = owner.post(f"/api/v1/trips/{trip['id']}/public-projection/preview")
    assert preview.status_code == 200
    assert preview.headers["cache-control"] == "no-store"
    assert [m["id"] for m in preview.json()["moments"]] == [shown["id"]]
    assert preview.json()["summary"] is None

    published = owner.post(f"/api/v1/trips/{trip['id']}/public-projection/publish")
    assert published.status_code == 200
    slug = published.json()["slug"]

    # A later edit to the (still owner-only) hidden moment must never appear:
    # the *scope* is frozen, so an out-of-scope item can never surface.
    anonymous = TestClient(app)
    document = anonymous.get(f"/api/v1/public/trips/{slug}")
    assert document.status_code == 200
    assert document.headers["cache-control"] == "public, max-age=60"
    ids = [m["id"] for m in document.json()["moments"]]
    assert ids == [shown["id"]]
    assert hidden["id"] not in ids
    assert "owner_subject" not in document.json()

    owner.patch(f"/api/v1/trips/{trip['id']}/moments/{hidden['id']}", json={"title": "Still hidden"})
    unchanged = anonymous.get(f"/api/v1/public/trips/{slug}")
    assert [m["id"] for m in unchanged.json()["moments"]] == [shown["id"]]

    # An edit to an *already-shared* item's content is not gated: a last-
    # minute wording fix reaches the public page immediately, with no
    # re-publish required, because only the scope (which items) is frozen.
    owner.patch(f"/api/v1/trips/{trip['id']}/moments/{shown['id']}", json={"title": "Hotel check-in (updated)"})
    refreshed = anonymous.get(f"/api/v1/public/trips/{slug}")
    assert refreshed.json()["moments"][0]["title"] == "Hotel check-in (updated)"


def test_public_projection_scope_changes_after_publish_are_live() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    hotel = add_moment(owner, trip["id"], "Hotel", "Taipei")
    factory = add_moment(owner, trip["id"], "Factory visit", "Hsinchu")

    owner.put(
        f"/api/v1/trips/{trip['id']}/public-projection",
        json={"route_stage_ids": [], "moment_ids": [hotel["id"]]},
    )
    published = owner.post(f"/api/v1/trips/{trip['id']}/public-projection/publish")
    slug = published.json()["slug"]

    anonymous = TestClient(app)
    before = anonymous.get(f"/api/v1/public/trips/{slug}").json()
    assert [m["id"] for m in before["moments"]] == [hotel["id"]]

    # Widening the scope (adding an item) takes effect immediately: no
    # separate re-publish step is required once the trip is already public.
    widened = owner.put(
        f"/api/v1/trips/{trip['id']}/public-projection",
        json={"route_stage_ids": [], "moment_ids": [hotel["id"], factory["id"]]},
    )
    assert widened.status_code == 200
    after_widen = anonymous.get(f"/api/v1/public/trips/{slug}").json()
    assert {m["id"] for m in after_widen["moments"]} == {hotel["id"], factory["id"]}

    # Narrowing it back removes an item just as immediately.
    owner.put(
        f"/api/v1/trips/{trip['id']}/public-projection",
        json={"route_stage_ids": [], "moment_ids": [hotel["id"]]},
    )
    after_narrow = anonymous.get(f"/api/v1/public/trips/{slug}").json()
    assert [m["id"] for m in after_narrow["moments"]] == [hotel["id"]]


def test_public_projection_unpublish_removes_the_page() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    owner.put(f"/api/v1/trips/{trip['id']}/public-projection", json={"route_stage_ids": [], "moment_ids": []})
    owner.post(f"/api/v1/trips/{trip['id']}/public-projection/preview")
    published = owner.post(f"/api/v1/trips/{trip['id']}/public-projection/publish")
    slug = published.json()["slug"]

    anonymous = TestClient(app)
    assert anonymous.get(f"/api/v1/public/trips/{slug}").status_code == 200

    assert owner.post(f"/api/v1/trips/{trip['id']}/public-projection/unpublish").status_code == 200
    assert anonymous.get(f"/api/v1/public/trips/{slug}").status_code == 404


def test_scope_rejects_a_resource_from_another_trip() -> None:
    owner = client_for("owner-1")
    trip_a = create_trip(owner, "Trip A")
    trip_b = create_trip(owner, "Trip B")
    foreign_moment = add_moment(owner, trip_b["id"], "Not yours", "Elsewhere")

    response = owner.put(
        f"/api/v1/trips/{trip_a['id']}/public-projection",
        json={"route_stage_ids": [], "moment_ids": [foreign_moment["id"]]},
    )
    assert response.status_code == 422


# --- Named unlisted share links ------------------------------------------------------


def activate(owner: TestClient, trip_id: str, link_id: str, expires_in_days: int = 30) -> dict:
    owner.post(f"/api/v1/trips/{trip_id}/share-links/{link_id}/preview")
    response = owner.post(
        f"/api/v1/trips/{trip_id}/share-links/{link_id}/activate", json={"expires_in_days": expires_in_days}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_share_link_lifecycle_issues_a_token_once_and_serves_only_its_scope() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    hotel = add_moment(owner, trip["id"], "Hotel", "Taipei")
    add_moment(owner, trip["id"], "Factory tour", "Hsinchu")

    created = owner.post(
        f"/api/v1/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": {"route_stage_ids": [], "moment_ids": [hotel["id"]]}},
    )
    assert created.status_code == 201, created.text
    link_id = created.json()["id"]
    assert "token" not in created.json()

    activated = activate(owner, trip["id"], link_id)
    token = activated.pop("token")
    assert activated["state"] == "active"
    assert len(token) >= 32

    anonymous = TestClient(app)
    delivered = anonymous.get(f"/api/v1/shared/{token}")
    assert delivered.status_code == 200
    ids = [m["id"] for m in delivered.json()["moments"]]
    assert ids == [hotel["id"]]
    assert delivered.headers["cache-control"] == "no-store, private"
    assert delivered.headers["x-robots-tag"] == "noindex, noarchive"
    assert delivered.headers["referrer-policy"] == "no-referrer"

    # Only the scope (which moments) is frozen at activation; a wording fix
    # to an already-in-scope moment reaches the link immediately.
    owner.patch(f"/api/v1/trips/{trip['id']}/moments/{hotel['id']}", json={"title": "Hotel (updated)"})
    refreshed = anonymous.get(f"/api/v1/shared/{token}")
    assert refreshed.json()["moments"][0]["title"] == "Hotel (updated)"


def test_share_link_scope_changes_while_active_are_live() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    hotel = add_moment(owner, trip["id"], "Hotel", "Taipei")
    factory = add_moment(owner, trip["id"], "Factory visit", "Hsinchu")

    created = owner.post(
        f"/api/v1/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": {"route_stage_ids": [], "moment_ids": [hotel["id"]]}},
    )
    link_id = created.json()["id"]
    token = activate(owner, trip["id"], link_id)["token"]

    anonymous = TestClient(app)
    before = anonymous.get(f"/api/v1/shared/{token}").json()
    assert [m["id"] for m in before["moments"]] == [hotel["id"]]

    # An already-active link's scope is not immutable: the owner can widen or
    # narrow it directly, and the same still-valid token reflects it live.
    widened = owner.patch(
        f"/api/v1/trips/{trip['id']}/share-links/{link_id}",
        json={"scope": {"route_stage_ids": [], "moment_ids": [hotel["id"], factory["id"]]}},
    )
    assert widened.status_code == 200
    assert widened.json()["state"] == "active"
    after_widen = anonymous.get(f"/api/v1/shared/{token}").json()
    assert {m["id"] for m in after_widen["moments"]} == {hotel["id"], factory["id"]}

    owner.patch(
        f"/api/v1/trips/{trip['id']}/share-links/{link_id}",
        json={"scope": {"route_stage_ids": [], "moment_ids": [hotel["id"]]}},
    )
    after_narrow = anonymous.get(f"/api/v1/shared/{token}").json()
    assert [m["id"] for m in after_narrow["moments"]] == [hotel["id"]]


def test_a_hotel_scoped_link_cannot_reveal_the_owner_only_factory_location() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    hotel = add_moment(owner, trip["id"], "Hotel", "Taipei")
    factory = add_moment(owner, trip["id"], "Factory visit", "Hsinchu")

    created = owner.post(
        f"/api/v1/trips/{trip['id']}/share-links",
        json={"label": "Hotel only", "scope": {"route_stage_ids": [], "moment_ids": [hotel["id"]]}},
    )
    link_id = created.json()["id"]
    token = activate(owner, trip["id"], link_id)["token"]

    anonymous = TestClient(app)
    delivered = anonymous.get(f"/api/v1/shared/{token}").json()
    revealed_ids = [m["id"] for m in delivered["moments"]]
    assert factory["id"] not in revealed_ids
    assert "Factory" not in str(delivered)


def test_share_link_responses_never_include_the_raw_token_or_its_verifier() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    created = owner.post(
        f"/api/v1/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": {"route_stage_ids": [], "moment_ids": []}},
    )
    link_id = created.json()["id"]
    activated = activate(owner, trip["id"], link_id)
    token = activated["token"]

    listed = owner.get(f"/api/v1/trips/{trip['id']}/share-links")
    assert listed.status_code == 200
    body = listed.json()
    assert token not in str(body)
    assert "token_verifier" not in body[0]
    assert "token" not in body[0]

    with TestingSessionLocal() as session:
        row = session.scalar(select(ShareLink).where(ShareLink.id == link_id))
        assert row.token_verifier is not None
        assert row.token_verifier != token


def test_revoking_a_share_link_immediately_invalidates_its_token() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    created = owner.post(
        f"/api/v1/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": {"route_stage_ids": [], "moment_ids": []}},
    )
    link_id = created.json()["id"]
    token = activate(owner, trip["id"], link_id)["token"]

    anonymous = TestClient(app)
    assert anonymous.get(f"/api/v1/shared/{token}").status_code == 200

    revoked = owner.post(f"/api/v1/trips/{trip['id']}/share-links/{link_id}/revoke")
    assert revoked.status_code == 200
    assert revoked.json()["state"] == "revoked"

    assert anonymous.get(f"/api/v1/shared/{token}").status_code == 404


def test_rotating_a_share_link_invalidates_the_old_token_and_issues_a_working_new_one() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    hotel = add_moment(owner, trip["id"], "Hotel", "Taipei")
    created = owner.post(
        f"/api/v1/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": {"route_stage_ids": [], "moment_ids": [hotel["id"]]}},
    )
    link_id = created.json()["id"]
    old_token = activate(owner, trip["id"], link_id)["token"]

    rotated = owner.post(f"/api/v1/trips/{trip['id']}/share-links/{link_id}/rotate", json={"expires_in_days": 30})
    assert rotated.status_code == 200
    new_token = rotated.json()["token"]
    assert new_token != old_token

    anonymous = TestClient(app)
    assert anonymous.get(f"/api/v1/shared/{old_token}").status_code == 404
    fresh = anonymous.get(f"/api/v1/shared/{new_token}")
    assert fresh.status_code == 200
    assert [m["id"] for m in fresh.json()["moments"]] == [hotel["id"]]


def test_shared_delivery_rejects_an_unknown_token_without_leaking_a_reason() -> None:
    app.dependency_overrides[get_session] = override_session
    response = TestClient(app).get("/api/v1/shared/not-a-real-token")
    assert response.status_code == 404
    assert response.headers["cache-control"] == "no-store, private"
    assert response.headers["x-robots-tag"] == "noindex, noarchive"


def test_expired_share_link_token_is_rejected() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    created = owner.post(
        f"/api/v1/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": {"route_stage_ids": [], "moment_ids": []}},
    )
    link_id = created.json()["id"]
    token = activate(owner, trip["id"], link_id, expires_in_days=1)["token"]

    with TestingSessionLocal() as session:
        row = session.scalar(select(ShareLink).where(ShareLink.id == link_id))
        row.expires_at = datetime.now(UTC) - timedelta(days=1)
        session.commit()

    response = TestClient(app).get(f"/api/v1/shared/{token}")
    assert response.status_code == 404
