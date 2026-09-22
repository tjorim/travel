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
from app.models import ShareLink
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


def add_excerpt(client: TestClient, trip_id: str, title: str) -> dict:
    response = client.post(
        f"/api/v1/trips/{trip_id}/moment-excerpts",
        json={"date_precision": "day", "title": title, "body": f"A safe note about {title}."},
    )
    assert response.status_code == 201, response.text
    return response.json()


def scope(*items: dict, title: bool = True, summary: bool = True) -> dict:
    return {"schema_version": "travel/share-scope@1", "trip": {"title": title, "summary": summary}, "items": list(items)}


def item(kind: str, resource_id: str, *fields: str) -> dict:
    return {"kind": kind, "id": resource_id, "fields": list(fields)}


# --- Public follower view -----------------------------------------------------------


def test_public_projection_exposes_only_selected_items_and_reflects_later_edits_to_them() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    shown = add_excerpt(owner, trip["id"], "Hotel check-in")
    hidden = add_excerpt(owner, trip["id"], "Factory visit")

    assert owner.put(
        f"/api/v1/trips/{trip['id']}/public-projection",
        json=scope(item("moment_excerpt", shown["id"], "title", "body"), summary=False),
    ).status_code == 200

    preview = owner.post(f"/api/v1/trips/{trip['id']}/public-projection/preview")
    assert preview.status_code == 200
    assert preview.headers["cache-control"] == "no-store"
    assert [m["title"] for m in preview.json()["moments"]] == [shown["title"]]
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
    titles = [m["title"] for m in document.json()["moments"]]
    assert titles == [shown["title"]]
    assert hidden["title"] not in titles
    assert "owner_subject" not in document.json()

    owner.patch(f"/api/v1/trips/{trip['id']}/moment-excerpts/{hidden['id']}", json={"title": "Still hidden"})
    unchanged = anonymous.get(f"/api/v1/public/trips/{slug}")
    assert [m["title"] for m in unchanged.json()["moments"]] == [shown["title"]]

    # An edit to an *already-shared* item's content is not gated: a last-
    # minute wording fix reaches the public page immediately, with no
    # re-publish required, because only the scope (which items) is frozen.
    owner.patch(f"/api/v1/trips/{trip['id']}/moment-excerpts/{shown['id']}", json={"title": "Hotel check-in (updated)"})
    refreshed = anonymous.get(f"/api/v1/public/trips/{slug}")
    assert refreshed.json()["moments"][0]["title"] == "Hotel check-in (updated)"


def test_private_moment_media_attachments_never_reach_a_shared_excerpt(tmp_path: Path) -> None:
    """EXIF suggestions feed only the owner edit route, never a projection."""
    owner = client_for("owner-1")
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    trip = create_trip(owner)
    uploaded = owner.post(
        f"/api/v1/trips/{trip['id']}/media/uploads", files={"file": ("private.jpg", b"not-a-real-jpeg", "image/jpeg")}
    )
    assert uploaded.status_code == 201, uploaded.text
    asset_id = uploaded.json()["id"]
    moment = owner.post(
        f"/api/v1/trips/{trip['id']}/moments",
        json={
            "occurred_at": "2054-04-04T10:00:00Z", "title": "Private arrival", "story": "Not for sharing.",
            "media_asset_ids": [asset_id],
        },
    )
    assert moment.status_code == 201, moment.text
    excerpt = add_excerpt(owner, trip["id"], "Safe arrival")
    owner.put(f"/api/v1/trips/{trip['id']}/public-projection", json=scope(item("moment_excerpt", excerpt["id"], "title")))
    slug = owner.post(f"/api/v1/trips/{trip['id']}/public-projection/publish").json()["slug"]

    body = TestClient(app).get(f"/api/v1/public/trips/{slug}").json()
    serialized = json.dumps(body)
    assert asset_id not in serialized
    assert "media_asset_ids" not in serialized


def test_public_projection_scope_changes_after_publish_are_live() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    hotel = add_excerpt(owner, trip["id"], "Hotel")
    factory = add_excerpt(owner, trip["id"], "Factory visit")

    owner.put(
        f"/api/v1/trips/{trip['id']}/public-projection",
        json=scope(item("moment_excerpt", hotel["id"], "title")),
    )
    published = owner.post(f"/api/v1/trips/{trip['id']}/public-projection/publish")
    slug = published.json()["slug"]

    anonymous = TestClient(app)
    before = anonymous.get(f"/api/v1/public/trips/{slug}").json()
    assert [m["title"] for m in before["moments"]] == [hotel["title"]]

    # Widening the scope (adding an item) takes effect immediately: no
    # separate re-publish step is required once the trip is already public.
    widened = owner.put(
        f"/api/v1/trips/{trip['id']}/public-projection",
        json=scope(item("moment_excerpt", hotel["id"], "title"), item("moment_excerpt", factory["id"], "title")),
    )
    assert widened.status_code == 200
    after_widen = anonymous.get(f"/api/v1/public/trips/{slug}").json()
    assert {m["title"] for m in after_widen["moments"]} == {hotel["title"], factory["title"]}

    # Narrowing it back removes an item just as immediately.
    owner.put(
        f"/api/v1/trips/{trip['id']}/public-projection",
        json=scope(item("moment_excerpt", hotel["id"], "title")),
    )
    after_narrow = anonymous.get(f"/api/v1/public/trips/{slug}").json()
    assert [m["title"] for m in after_narrow["moments"]] == [hotel["title"]]


def test_public_projection_unpublish_removes_the_page() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    owner.put(f"/api/v1/trips/{trip['id']}/public-projection", json=scope())
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
    foreign_moment = add_excerpt(owner, trip_b["id"], "Not yours")

    response = owner.put(
        f"/api/v1/trips/{trip_a['id']}/public-projection",
        json=scope(item("moment_excerpt", foreign_moment["id"], "title")),
    )
    assert response.status_code == 422


def test_scope_rejects_disallowed_kinds_and_unknown_fields() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    stage = add_route_stage(owner, trip["id"], 0, "Taipei", "Taipei")

    disallowed = owner.put(
        f"/api/v1/trips/{trip['id']}/public-projection",
        json=scope(item("stay", "not-shareable", "title")),
    )
    assert disallowed.status_code == 422

    unknown_field = owner.put(
        f"/api/v1/trips/{trip['id']}/public-projection",
        json=scope(item("route_stage", stage["id"], "place", "owner_notes")),
    )
    assert unknown_field.status_code == 422


def test_projection_omits_out_of_scope_fields_for_stays_routes_media_and_documents(tmp_path: Path) -> None:
    """One selected safe resource must never bring its peers or private fields."""
    owner = client_for("owner-1")
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    trip = create_trip(owner)
    stage = add_route_stage(owner, trip["id"], 0, "Taipei", "Taipei")
    place_id = stage["place"]["id"]

    selected_card = owner.post(
        f"/api/v1/trips/{trip['id']}/broad-stay-cards",
        json={"broad_place_id": place_id, "title": "Taipei base", "date_precision": "month"},
    ).json()
    hidden_card = owner.post(
        f"/api/v1/trips/{trip['id']}/broad-stay-cards",
        json={"broad_place_id": place_id, "title": "Hidden stay", "date_precision": "day"},
    ).json()
    selected_route = owner.post(
        f"/api/v1/trips/{trip['id']}/broad-routes",
        json={"label": "North coast", "date_precision": "day", "geometry": {"type": "LineString", "coordinates": [[121, 25], [121.1, 25.1]]}},
    ).json()
    hidden_route = owner.post(
        f"/api/v1/trips/{trip['id']}/broad-routes",
        json={"label": "Private raw route", "date_precision": "day", "geometry": {"type": "LineString", "coordinates": [[120, 24], [120.1, 24.1]]}},
    ).json()

    image = Image.new("RGB", (10, 10), (20, 30, 40))
    image_data = io.BytesIO()
    image.save(image_data, format="JPEG")
    media = owner.post(
        f"/api/v1/trips/{trip['id']}/media/uploads", files={"file": ("private.jpg", image_data.getvalue(), "image/jpeg")}
    ).json()
    pending_media = owner.post(
        f"/api/v1/trips/{trip['id']}/media/{media['id']}/derivatives", json={"purpose": "share"}
    ).json()
    assert owner.put(
        f"/api/v1/trips/{trip['id']}/public-projection", json=scope(item("media_derivative", pending_media["id"], "image"))
    ).status_code == 422
    selected_media = owner.post(
        f"/api/v1/trips/{trip['id']}/media/{media['id']}/derivatives/{pending_media['id']}/approve"
    ).json()

    document = owner.post(
        f"/api/v1/trips/{trip['id']}/documents/uploads",
        data={"title": "Safe itinerary", "document_kind": "itinerary"},
        files={"file": ("private.txt", b"private", "text/plain")},
    ).json()
    pending_document = owner.post(
        f"/api/v1/trips/{trip['id']}/documents/{document['id']}/derivatives",
        files={"file": ("safe.txt", b"safe", "text/plain"), "redaction_manifest": ("redactions.json", b"{}", "application/json")},
    ).json()
    assert owner.put(
        f"/api/v1/trips/{trip['id']}/public-projection", json=scope(item("document_derivative", pending_document["id"], "file"))
    ).status_code == 422
    selected_document = owner.post(
        f"/api/v1/trips/{trip['id']}/documents/{document['id']}/derivatives/{pending_document['id']}/approve"
    ).json()

    selected = scope(
        item("broad_stay_card", selected_card["id"], "title"),
        item("route_stage", stage["id"], "label"),
        item("broad_place", place_id, "label"),
        item("broad_route", selected_route["id"], "label"),
        item("media_derivative", selected_media["id"], "image"),
        item("document_derivative", selected_document["id"], "title", "file"),
    )
    assert owner.put(f"/api/v1/trips/{trip['id']}/public-projection", json=selected).status_code == 200
    slug = owner.post(f"/api/v1/trips/{trip['id']}/public-projection/publish").json()["slug"]
    projection = TestClient(app).get(f"/api/v1/public/trips/{slug}").json()

    assert projection["stays"] == [{"id": "broad_stay_card-1", "title": "Taipei base"}]
    assert projection["route_stages"] == [{"id": "route_stage-2", "label": "Taipei"}]
    assert projection["places"] == [{"id": "broad_place-3", "label": "Taipei"}]
    assert projection["route"] == [{"id": "broad_route-4", "label": "North coast"}]
    assert projection["media"] == [{"id": "media_derivative-5", "image": {"id": "media_derivative-5"}}]
    assert projection["documents"] == [{"id": "document_derivative-6", "title": "Safe itinerary", "file": {"id": "document_derivative-6"}}]
    assert hidden_card["title"] not in str(projection)
    assert hidden_route["label"] not in str(projection)
    assert "geometry" not in str(projection["route"])
    assert "date_precision" not in str(projection["stays"])
    assert "media_asset_id" not in str(projection)
    assert "document_asset_id" not in str(projection)


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
    hotel = add_excerpt(owner, trip["id"], "Hotel")
    add_excerpt(owner, trip["id"], "Factory tour")

    created = owner.post(
        f"/api/v1/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": scope(item("moment_excerpt", hotel["id"], "title"))},
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
    assert [m["title"] for m in delivered.json()["moments"]] == [hotel["title"]]
    assert delivered.headers["cache-control"] == "no-store, private"
    assert delivered.headers["x-robots-tag"] == "noindex, noarchive"
    assert delivered.headers["referrer-policy"] == "no-referrer"

    # Only the scope (which moments) is frozen at activation; a wording fix
    # to an already-in-scope moment reaches the link immediately.
    owner.patch(f"/api/v1/trips/{trip['id']}/moment-excerpts/{hotel['id']}", json={"title": "Hotel (updated)"})
    refreshed = anonymous.get(f"/api/v1/shared/{token}")
    assert refreshed.json()["moments"][0]["title"] == "Hotel (updated)"


def test_share_link_scope_changes_while_active_are_live() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    hotel = add_excerpt(owner, trip["id"], "Hotel")
    factory = add_excerpt(owner, trip["id"], "Factory visit")

    created = owner.post(
        f"/api/v1/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": scope(item("moment_excerpt", hotel["id"], "title"))},
    )
    link_id = created.json()["id"]
    token = activate(owner, trip["id"], link_id)["token"]

    anonymous = TestClient(app)
    before = anonymous.get(f"/api/v1/shared/{token}").json()
    assert [m["title"] for m in before["moments"]] == [hotel["title"]]

    # An already-active link's scope is not immutable: the owner can widen or
    # narrow it directly, and the same still-valid token reflects it live.
    widened = owner.patch(
        f"/api/v1/trips/{trip['id']}/share-links/{link_id}",
        json={"scope": scope(item("moment_excerpt", hotel["id"], "title"), item("moment_excerpt", factory["id"], "title"))},
    )
    assert widened.status_code == 200
    assert widened.json()["state"] == "active"
    after_widen = anonymous.get(f"/api/v1/shared/{token}").json()
    assert {m["title"] for m in after_widen["moments"]} == {hotel["title"], factory["title"]}

    owner.patch(
        f"/api/v1/trips/{trip['id']}/share-links/{link_id}",
        json={"scope": scope(item("moment_excerpt", hotel["id"], "title"))},
    )
    after_narrow = anonymous.get(f"/api/v1/shared/{token}").json()
    assert [m["title"] for m in after_narrow["moments"]] == [hotel["title"]]


def test_a_hotel_scoped_link_cannot_reveal_the_owner_only_factory_location() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    hotel = add_excerpt(owner, trip["id"], "Hotel")
    factory = add_excerpt(owner, trip["id"], "Factory visit")

    created = owner.post(
        f"/api/v1/trips/{trip['id']}/share-links",
        json={"label": "Hotel only", "scope": scope(item("moment_excerpt", hotel["id"], "title"))},
    )
    link_id = created.json()["id"]
    token = activate(owner, trip["id"], link_id)["token"]

    anonymous = TestClient(app)
    delivered = anonymous.get(f"/api/v1/shared/{token}").json()
    assert factory["title"] not in [m["title"] for m in delivered["moments"]]
    assert "Factory" not in str(delivered)


def test_share_link_responses_never_include_the_raw_token_or_its_verifier() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    created = owner.post(
        f"/api/v1/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": scope()},
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
        json={"label": "Family", "scope": scope()},
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
    hotel = add_excerpt(owner, trip["id"], "Hotel")
    created = owner.post(
        f"/api/v1/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": scope(item("moment_excerpt", hotel["id"], "title"))},
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
    assert [m["title"] for m in fresh.json()["moments"]] == [hotel["title"]]


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
        json={"label": "Family", "scope": scope()},
    )
    link_id = created.json()["id"]
    token = activate(owner, trip["id"], link_id, expires_in_days=1)["token"]

    with TestingSessionLocal() as session:
        row = session.scalar(select(ShareLink).where(ShareLink.id == link_id))
        row.expires_at = datetime.now(UTC) - timedelta(days=1)
        session.commit()

    response = TestClient(app).get(f"/api/v1/shared/{token}")
    assert response.status_code == 404
