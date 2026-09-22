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
    response = client.post("/api/trips", json={"title": title, "summary": "A private trip."})
    assert response.status_code == 201, response.text
    return response.json()


def add_route_stage(client: TestClient, trip_id: str, position: int, label: str, city: str) -> dict:
    response = client.post(
        f"/api/trips/{trip_id}/route-stages",
        json={"position": position, "label": label, "place": {"label": city, "country_code": "TW"}},
    )
    assert response.status_code == 201, response.text
    return response.json()


def add_moment(client: TestClient, trip_id: str, title: str, city: str) -> dict:
    response = client.post(
        f"/api/trips/{trip_id}/moments",
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
        f"/api/trips/{trip_id}/moment-excerpts",
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
        f"/api/trips/{trip['id']}/public-projection",
        json=scope(item("moment_excerpt", shown["id"], "title", "body"), summary=False),
    ).status_code == 200

    preview = owner.post(f"/api/trips/{trip['id']}/public-projection/preview")
    assert preview.status_code == 200
    assert preview.headers["cache-control"] == "no-store"
    assert [m["title"] for m in preview.json()["moments"]] == [shown["title"]]
    assert preview.json()["summary"] is None
    assert client_for("other-owner").post(f"/api/trips/{trip['id']}/public-projection/preview").status_code == 404
    owner = client_for("owner-1")

    published = owner.post(f"/api/trips/{trip['id']}/public-projection/publish")
    assert published.status_code == 200
    slug = published.json()["slug"]

    # A later edit to the (still owner-only) hidden moment must never appear:
    # the *scope* is frozen, so an out-of-scope item can never surface.
    anonymous = TestClient(app)
    document = anonymous.get(f"/api/public/trips/{slug}")
    assert document.status_code == 200
    assert document.headers["cache-control"] == "no-store"
    assert document.json() == preview.json()
    titles = [m["title"] for m in document.json()["moments"]]
    assert titles == [shown["title"]]
    assert hidden["title"] not in titles
    assert "owner_subject" not in document.json()

    owner.patch(f"/api/trips/{trip['id']}/moment-excerpts/{hidden['id']}", json={"title": "Still hidden"})
    unchanged = anonymous.get(f"/api/public/trips/{slug}")
    assert [m["title"] for m in unchanged.json()["moments"]] == [shown["title"]]

    # A wording fix to a shared item reaches the public page immediately.
    owner.patch(f"/api/trips/{trip['id']}/moment-excerpts/{shown['id']}", json={"title": "Hotel check-in (updated)"})
    refreshed = anonymous.get(f"/api/public/trips/{slug}")
    assert refreshed.json()["moments"][0]["title"] == "Hotel check-in (updated)"


def test_live_story_order_stable_fragments_and_scoped_media_association(tmp_path: Path) -> None:
    owner = client_for("owner-1")
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    trip = create_trip(owner)
    late = add_excerpt(owner, trip["id"], "Late")
    early = add_excerpt(owner, trip["id"], "Early")
    hidden = add_excerpt(owner, trip["id"], "Private")
    for excerpt, date in ((late, "2054-05-20"), (early, "2054-04-02"), (hidden, "2054-03-01")):
        assert owner.patch(f"/api/trips/{trip['id']}/moment-excerpts/{excerpt['id']}", json={"story_date": date}).status_code == 200
    image_data = io.BytesIO()
    Image.new("RGB", (40, 30), (20, 30, 40)).save(image_data, format="JPEG")
    asset = owner.post(f"/api/trips/{trip['id']}/media/uploads", files={"file": ("private.jpg", image_data.getvalue(), "image/jpeg")}).json()
    derivative = owner.post(f"/api/trips/{trip['id']}/media/{asset['id']}/derivatives", json={"purpose": "share"}).json()
    owner.post(f"/api/trips/{trip['id']}/media/{asset['id']}/derivatives/{derivative['id']}/approve")
    presentation_url = f"/api/trips/{trip['id']}/media/{asset['id']}/derivatives/{derivative['id']}/presentation"
    assert owner.patch(presentation_url, json={"moment_excerpt_id": early["id"], "caption": "Shared caption", "alt_text": "Train", "focal_x": 25, "focal_y": 60}).status_code == 200
    selected = scope(
        item("moment_excerpt", late["id"], "title", "story_date", "date_precision"),
        item("media_derivative", derivative["id"], "image", "caption", "alt_text", "width", "height", "focal_x", "focal_y", "moment"),
        item("moment_excerpt", early["id"], "title", "story_date", "date_precision"),
    )
    assert owner.put(f"/api/trips/{trip['id']}/public-projection", json=selected).status_code == 200
    slug = owner.post(f"/api/trips/{trip['id']}/public-projection/publish").json()["slug"]
    visitor = TestClient(app)
    document = visitor.get(f"/api/public/trips/{slug}").json()
    assert [moment["title"] for moment in document["moments"]] == ["Early", "Late"]
    assert [moment["story_date"] for moment in document["moments"]] == ["2054-04-02", "2054-05-20"]
    assert document["media"][0]["moment"] == document["moments"][0]["id"]
    assert document["media"][0]["caption"] == "Shared caption"
    assert document["media"][0]["focal_x"] == 25
    assert asset["id"] not in str(document) and hidden["title"] not in str(document)
    link = owner.post(f"/api/trips/{trip['id']}/share-links", json={"label": "Family", "scope": selected}).json()
    token = activate(owner, trip["id"], link["id"])["token"]
    unlisted = visitor.get(f"/api/shared/{token}").json()
    assert unlisted["moments"] == document["moments"]
    assert unlisted["media"] == document["media"]
    stable_id = document["moments"][0]["id"]
    assert owner.put(f"/api/trips/{trip['id']}/public-projection", json=scope(item("moment_excerpt", early["id"], "title", "story_date"), item("media_derivative", derivative["id"], "image", "moment"))).status_code == 200
    narrowed = visitor.get(f"/api/public/trips/{slug}").json()
    assert narrowed["moments"][0]["id"] == stable_id
    assert narrowed["media"][0]["moment"] == stable_id
    assert "caption" not in narrowed["media"][0] and "focal_x" not in narrowed["media"][0]
    assert owner.put(f"/api/trips/{trip['id']}/public-projection", json=scope(item("media_derivative", derivative["id"], "image", "moment"))).status_code == 200
    assert "moment" not in visitor.get(f"/api/public/trips/{slug}").json()["media"][0]
    assert visitor.get(f"/api/shared/{token}").json()["media"][0]["moment"] == stable_id

    assert owner.patch(f"/api/trips/{trip['id']}/moment-excerpts/{early['id']}", json={"date_precision": "month"}).status_code == 200
    reduced = visitor.get(f"/api/shared/{token}").json()
    assert reduced["moments"][0]["story_date"] == "2054-04"
    assert "2054-04-02" not in str(reduced)

    other = create_trip(owner, "Other")
    foreign = add_excerpt(owner, other["id"], "Foreign")
    assert owner.patch(presentation_url, json={"moment_excerpt_id": foreign["id"]}).status_code == 422

def test_private_moment_media_attachments_never_reach_a_shared_excerpt(tmp_path: Path) -> None:
    """EXIF suggestions feed only the owner edit route, never a projection."""
    owner = client_for("owner-1")
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    trip = create_trip(owner)
    uploaded = owner.post(
        f"/api/trips/{trip['id']}/media/uploads", files={"file": ("private.jpg", b"not-a-real-jpeg", "image/jpeg")}
    )
    assert uploaded.status_code == 201, uploaded.text
    asset_id = uploaded.json()["id"]
    moment = owner.post(
        f"/api/trips/{trip['id']}/moments",
        json={
            "occurred_at": "2054-04-04T10:00:00Z", "title": "Private arrival", "story": "Not for sharing.",
            "media_asset_ids": [asset_id],
        },
    )
    assert moment.status_code == 201, moment.text
    excerpt = add_excerpt(owner, trip["id"], "Safe arrival")
    owner.put(f"/api/trips/{trip['id']}/public-projection", json=scope(item("moment_excerpt", excerpt["id"], "title")))
    slug = owner.post(f"/api/trips/{trip['id']}/public-projection/publish").json()["slug"]

    body = TestClient(app).get(f"/api/public/trips/{slug}").json()
    serialized = json.dumps(body)
    assert asset_id not in serialized
    assert "media_asset_ids" not in serialized


def test_public_projection_scope_changes_after_publish_are_live() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    hotel = add_excerpt(owner, trip["id"], "Hotel")
    factory = add_excerpt(owner, trip["id"], "Factory visit")

    owner.put(
        f"/api/trips/{trip['id']}/public-projection",
        json=scope(item("moment_excerpt", hotel["id"], "title")),
    )
    published = owner.post(f"/api/trips/{trip['id']}/public-projection/publish")
    slug = published.json()["slug"]

    anonymous = TestClient(app)
    before = anonymous.get(f"/api/public/trips/{slug}").json()
    assert [m["title"] for m in before["moments"]] == [hotel["title"]]

    # Widening the scope (adding an item) takes effect immediately: no
    # separate re-publish step is required once the trip is already public.
    widened = owner.put(
        f"/api/trips/{trip['id']}/public-projection",
        json=scope(item("moment_excerpt", hotel["id"], "title"), item("moment_excerpt", factory["id"], "title")),
    )
    assert widened.status_code == 200
    after_widen = anonymous.get(f"/api/public/trips/{slug}").json()
    assert {m["title"] for m in after_widen["moments"]} == {hotel["title"], factory["title"]}

    # Narrowing it back removes an item just as immediately.
    owner.put(
        f"/api/trips/{trip['id']}/public-projection",
        json=scope(item("moment_excerpt", hotel["id"], "title")),
    )
    after_narrow = anonymous.get(f"/api/public/trips/{slug}").json()
    assert [m["title"] for m in after_narrow["moments"]] == [hotel["title"]]


def test_public_projection_unpublish_removes_the_page() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    owner.put(f"/api/trips/{trip['id']}/public-projection", json=scope())
    owner.post(f"/api/trips/{trip['id']}/public-projection/preview")
    published = owner.post(f"/api/trips/{trip['id']}/public-projection/publish")
    slug = published.json()["slug"]

    anonymous = TestClient(app)
    assert anonymous.get(f"/api/public/trips/{slug}").status_code == 200

    assert owner.post(f"/api/trips/{trip['id']}/public-projection/unpublish").status_code == 200
    withdrawn = anonymous.get(f"/api/public/trips/{slug}")
    assert withdrawn.status_code == 404
    assert withdrawn.headers["cache-control"] == "no-store"


def test_scope_rejects_a_resource_from_another_trip() -> None:
    owner = client_for("owner-1")
    trip_a = create_trip(owner, "Trip A")
    trip_b = create_trip(owner, "Trip B")
    foreign_moment = add_excerpt(owner, trip_b["id"], "Not yours")

    response = owner.put(
        f"/api/trips/{trip_a['id']}/public-projection",
        json=scope(item("moment_excerpt", foreign_moment["id"], "title")),
    )
    assert response.status_code == 422


def test_scope_rejects_disallowed_kinds_and_unknown_fields() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    stage = add_route_stage(owner, trip["id"], 0, "Taipei", "Taipei")

    disallowed = owner.put(
        f"/api/trips/{trip['id']}/public-projection",
        json=scope(item("stay", "not-shareable", "title")),
    )
    assert disallowed.status_code == 422

    unknown_field = owner.put(
        f"/api/trips/{trip['id']}/public-projection",
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
        f"/api/trips/{trip['id']}/broad-stay-cards",
        json={"broad_place_id": place_id, "title": "Taipei base", "date_precision": "month"},
    ).json()
    hidden_card = owner.post(
        f"/api/trips/{trip['id']}/broad-stay-cards",
        json={"broad_place_id": place_id, "title": "Hidden stay", "date_precision": "day"},
    ).json()
    selected_route = owner.post(
        f"/api/trips/{trip['id']}/broad-routes",
        json={"label": "North coast", "date_precision": "day", "geometry": {"type": "LineString", "coordinates": [[121, 25], [121.1, 25.1]]}},
    ).json()
    hidden_route = owner.post(
        f"/api/trips/{trip['id']}/broad-routes",
        json={"label": "Private raw route", "date_precision": "day", "geometry": {"type": "LineString", "coordinates": [[120, 24], [120.1, 24.1]]}},
    ).json()

    image = Image.new("RGB", (10, 10), (20, 30, 40))
    image_data = io.BytesIO()
    image.save(image_data, format="JPEG")
    media = owner.post(
        f"/api/trips/{trip['id']}/media/uploads", files={"file": ("private.jpg", image_data.getvalue(), "image/jpeg")}
    ).json()
    pending_media = owner.post(
        f"/api/trips/{trip['id']}/media/{media['id']}/derivatives", json={"purpose": "share"}
    ).json()
    assert owner.put(
        f"/api/trips/{trip['id']}/public-projection", json=scope(item("media_derivative", pending_media["id"], "image"))
    ).status_code == 422
    selected_media = owner.post(
        f"/api/trips/{trip['id']}/media/{media['id']}/derivatives/{pending_media['id']}/approve"
    ).json()

    document = owner.post(
        f"/api/trips/{trip['id']}/documents/uploads",
        data={"title": "Safe itinerary", "document_kind": "itinerary"},
        files={"file": ("private.txt", b"private", "text/plain")},
    ).json()
    pending_document = owner.post(
        f"/api/trips/{trip['id']}/documents/{document['id']}/derivatives",
        files={"file": ("safe.txt", b"safe", "text/plain"), "redaction_manifest": ("redactions.json", b"{}", "application/json")},
    ).json()
    assert owner.put(
        f"/api/trips/{trip['id']}/public-projection", json=scope(item("document_derivative", pending_document["id"], "file"))
    ).status_code == 422
    selected_document = owner.post(
        f"/api/trips/{trip['id']}/documents/{document['id']}/derivatives/{pending_document['id']}/approve"
    ).json()

    selected = scope(
        item("broad_stay_card", selected_card["id"], "title"),
        item("route_stage", stage["id"], "label"),
        item("broad_place", place_id, "label"),
        item("broad_route", selected_route["id"], "label"),
        item("media_derivative", selected_media["id"], "image"),
        item("document_derivative", selected_document["id"], "title", "file"),
    )
    assert owner.put(f"/api/trips/{trip['id']}/public-projection", json=selected).status_code == 200
    preview_file_base = f"/api/trips/{trip['id']}/public-projection/preview/files"
    assert owner.post(f"/api/trips/{trip['id']}/public-projection/preview").status_code == 200
    assert owner.get(f"{preview_file_base}/document_derivative-6").content == b"safe"
    assert owner.get(f"{preview_file_base}/media_derivative-5").status_code == 200
    assert owner.get(f"{preview_file_base}/document_derivative-7").status_code == 404
    assert client_for("other-owner").get(f"{preview_file_base}/document_derivative-6").status_code == 404
    owner = client_for("owner-1")
    slug = owner.post(f"/api/trips/{trip['id']}/public-projection/publish").json()["slug"]
    projection = TestClient(app).get(f"/api/public/trips/{slug}").json()

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

    media_url = f"/api/public/trips/{slug}/files/media_derivative-5"
    document_url = f"/api/public/trips/{slug}/files/document_derivative-6"
    visitor = TestClient(app)
    media_file = visitor.get(media_url)
    assert media_file.status_code == 200
    assert media_file.content == owner.get(selected_media["file_url"]).content
    assert media_file.headers["content-disposition"] == "inline"
    assert media_file.headers["cache-control"] == "no-store"
    document_file = visitor.get(document_url)
    assert document_file.status_code == 200
    assert document_file.content == b"safe"
    assert document_file.headers["content-disposition"] == "attachment"
    assert visitor.get(f"/api/public/trips/{slug}/files/media_derivative-4").status_code == 404
    assert visitor.get(f"/api/public/trips/{slug}/files/document_derivative-7").status_code == 404

    link = owner.post(f"/api/trips/{trip['id']}/share-links", json={"label": "Visitor", "scope": selected}).json()
    shared = activate(owner, trip["id"], link["id"])
    shared_url = f"/api/shared/{shared['token']}/files/document_derivative-6"
    share_preview_file = f"/api/trips/{trip['id']}/share-links/{link['id']}/preview/files/document_derivative-6"
    assert owner.get(share_preview_file).content == b"safe"
    assert visitor.get(shared_url).content == b"safe"
    assert visitor.get(shared_url).headers["cache-control"] == "no-store, private"

    without_files = json.loads(json.dumps(selected))
    without_files["items"][4]["fields"] = []
    without_files["items"][5]["fields"] = ["title"]
    assert owner.put(f"/api/trips/{trip['id']}/public-projection", json=without_files).status_code == 200
    assert visitor.get(media_url).status_code == 404
    assert visitor.get(document_url).status_code == 404
    assert owner.get(f"{preview_file_base}/document_derivative-6").status_code == 404
    assert owner.patch(f"/api/trips/{trip['id']}/share-links/{link['id']}", json={"scope": without_files}).status_code == 200
    assert visitor.get(shared_url).status_code == 404
    assert owner.get(share_preview_file).status_code == 404
    assert owner.post(f"/api/trips/{trip['id']}/share-links/{link['id']}/revoke").status_code == 200
    assert owner.get(share_preview_file).status_code == 404
    assert visitor.get(shared_url).status_code == 404


# --- Named unlisted share links ------------------------------------------------------


def activate(owner: TestClient, trip_id: str, link_id: str, expires_in_days: int = 30) -> dict:
    owner.post(f"/api/trips/{trip_id}/share-links/{link_id}/preview")
    response = owner.post(
        f"/api/trips/{trip_id}/share-links/{link_id}/activate", json={"expires_in_days": expires_in_days}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_share_link_lifecycle_issues_a_token_once_and_serves_only_its_scope() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    hotel = add_excerpt(owner, trip["id"], "Hotel")
    add_excerpt(owner, trip["id"], "Factory tour")

    created = owner.post(
        f"/api/trips/{trip['id']}/share-links",
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
    delivered = anonymous.get(f"/api/shared/{token}")
    assert delivered.status_code == 200
    assert [m["title"] for m in delivered.json()["moments"]] == [hotel["title"]]
    assert delivered.headers["cache-control"] == "no-store, private"
    assert delivered.headers["x-robots-tag"] == "noindex, noarchive"
    assert delivered.headers["referrer-policy"] == "no-referrer"

    # Only the scope (which moments) is frozen at activation; a wording fix
    # to an already-in-scope moment reaches the link immediately.
    owner.patch(f"/api/trips/{trip['id']}/moment-excerpts/{hotel['id']}", json={"title": "Hotel (updated)"})
    refreshed = anonymous.get(f"/api/shared/{token}")
    assert refreshed.json()["moments"][0]["title"] == "Hotel (updated)"


def test_share_link_scope_changes_while_active_are_live() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    hotel = add_excerpt(owner, trip["id"], "Hotel")
    factory = add_excerpt(owner, trip["id"], "Factory visit")

    created = owner.post(
        f"/api/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": scope(item("moment_excerpt", hotel["id"], "title"))},
    )
    link_id = created.json()["id"]
    token = activate(owner, trip["id"], link_id)["token"]

    anonymous = TestClient(app)
    before = anonymous.get(f"/api/shared/{token}").json()
    assert [m["title"] for m in before["moments"]] == [hotel["title"]]

    # An already-active link's scope is not immutable: the owner can widen or
    # narrow it directly, and the same still-valid token reflects it live.
    widened = owner.patch(
        f"/api/trips/{trip['id']}/share-links/{link_id}",
        json={"scope": scope(item("moment_excerpt", hotel["id"], "title"), item("moment_excerpt", factory["id"], "title"))},
    )
    assert widened.status_code == 200
    assert widened.json()["state"] == "active"
    after_widen = anonymous.get(f"/api/shared/{token}").json()
    assert {m["title"] for m in after_widen["moments"]} == {hotel["title"], factory["title"]}

    owner.patch(
        f"/api/trips/{trip['id']}/share-links/{link_id}",
        json={"scope": scope(item("moment_excerpt", hotel["id"], "title"))},
    )
    after_narrow = anonymous.get(f"/api/shared/{token}").json()
    assert [m["title"] for m in after_narrow["moments"]] == [hotel["title"]]


def test_a_hotel_scoped_link_cannot_reveal_the_owner_only_factory_location() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    hotel = add_excerpt(owner, trip["id"], "Hotel")
    factory = add_excerpt(owner, trip["id"], "Factory visit")

    created = owner.post(
        f"/api/trips/{trip['id']}/share-links",
        json={"label": "Hotel only", "scope": scope(item("moment_excerpt", hotel["id"], "title"))},
    )
    link_id = created.json()["id"]
    token = activate(owner, trip["id"], link_id)["token"]

    anonymous = TestClient(app)
    delivered = anonymous.get(f"/api/shared/{token}").json()
    assert factory["title"] not in [m["title"] for m in delivered["moments"]]
    assert "Factory" not in str(delivered)


def test_share_link_responses_never_include_the_raw_token_or_its_verifier() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    created = owner.post(
        f"/api/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": scope()},
    )
    link_id = created.json()["id"]
    activated = activate(owner, trip["id"], link_id)
    token = activated["token"]

    listed = owner.get(f"/api/trips/{trip['id']}/share-links")
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
        f"/api/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": scope()},
    )
    link_id = created.json()["id"]
    token = activate(owner, trip["id"], link_id)["token"]

    anonymous = TestClient(app)
    assert anonymous.get(f"/api/shared/{token}").status_code == 200

    revoked = owner.post(f"/api/trips/{trip['id']}/share-links/{link_id}/revoke")
    assert revoked.status_code == 200
    assert revoked.json()["state"] == "revoked"

    assert anonymous.get(f"/api/shared/{token}").status_code == 404


def test_rotating_a_share_link_invalidates_the_old_token_and_issues_a_working_new_one() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    hotel = add_excerpt(owner, trip["id"], "Hotel")
    created = owner.post(
        f"/api/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": scope(item("moment_excerpt", hotel["id"], "title"))},
    )
    link_id = created.json()["id"]
    old_token = activate(owner, trip["id"], link_id)["token"]

    rotated = owner.post(f"/api/trips/{trip['id']}/share-links/{link_id}/rotate", json={"expires_in_days": 30})
    assert rotated.status_code == 200
    new_token = rotated.json()["token"]
    assert new_token != old_token

    anonymous = TestClient(app)
    assert anonymous.get(f"/api/shared/{old_token}").status_code == 404
    fresh = anonymous.get(f"/api/shared/{new_token}")
    assert fresh.status_code == 200
    assert [m["title"] for m in fresh.json()["moments"]] == [hotel["title"]]


def test_shared_delivery_rejects_an_unknown_token_without_leaking_a_reason() -> None:
    app.dependency_overrides[get_session] = override_session
    response = TestClient(app).get("/api/shared/not-a-real-token")
    assert response.status_code == 404
    assert response.headers["cache-control"] == "no-store, private"
    assert response.headers["x-robots-tag"] == "noindex, noarchive"


def test_expired_share_link_token_is_rejected() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    created = owner.post(
        f"/api/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": scope()},
    )
    link_id = created.json()["id"]
    token = activate(owner, trip["id"], link_id, expires_in_days=1)["token"]

    with TestingSessionLocal() as session:
        row = session.scalar(select(ShareLink).where(ShareLink.id == link_id))
        row.expires_at = datetime.now(UTC) - timedelta(days=1)
        session.commit()

    response = TestClient(app).get(f"/api/shared/{token}")
    assert response.status_code == 404


def test_unavailable_capabilities_have_one_visitor_response_contract() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    tokens = []
    for label in ("Revoked", "Expired"):
        created = owner.post(
            f"/api/trips/{trip['id']}/share-links",
            json={"label": label, "scope": scope()},
        )
        link_id = created.json()["id"]
        token = activate(owner, trip["id"], link_id)["token"]
        tokens.append(token)
        if label == "Revoked":
            assert owner.post(f"/api/trips/{trip['id']}/share-links/{link_id}/revoke").status_code == 200
        else:
            with TestingSessionLocal() as session:
                row = session.scalar(select(ShareLink).where(ShareLink.id == link_id))
                row.expires_at = datetime.now(UTC) - timedelta(days=1)
                session.commit()

    anonymous = TestClient(app)
    headers = ("cache-control", "x-robots-tag", "referrer-policy")
    responses = [anonymous.get(f"/api/shared/{token}") for token in ("unknown-token", *tokens)]
    assert all(response.status_code == 404 for response in responses)
    assert len({response.text for response in responses}) == 1
    assert len({tuple(response.headers[name] for name in headers) for response in responses}) == 1
    assert tuple(responses[0].headers[name] for name in headers) == (
        "no-store, private", "noindex, noarchive", "no-referrer"
    )


def test_anonymous_delivery_routes_return_only_projection_documents() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    excerpt = add_excerpt(owner, trip["id"], "Visible excerpt")
    selected = scope(item("moment_excerpt", excerpt["id"], "title"))
    assert owner.put(f"/api/trips/{trip['id']}/public-projection", json=selected).status_code == 200
    slug = owner.post(f"/api/trips/{trip['id']}/public-projection/publish").json()["slug"]
    link = owner.post(
        f"/api/trips/{trip['id']}/share-links", json={"label": "Visitor", "scope": selected}
    ).json()
    token = activate(owner, trip["id"], link["id"])["token"]
    link_preview = owner.post(f"/api/trips/{trip['id']}/share-links/{link['id']}/preview")

    anonymous = TestClient(app)
    for path, version in (
        (f"/api/public/trips/{slug}", "travel/public-trip@1"),
        (f"/api/shared/{token}", "travel/unlisted-trip@1"),
    ):
        response = anonymous.get(path)
        assert response.status_code == 200
        document = response.json()
        assert document["schema_version"] == version
        assert [moment["title"] for moment in document["moments"]] == ["Visible excerpt"]
        assert not {"owner_subject", "scope", "token", "link_id", "trip_id"} & document.keys()
        assert response.headers["cache-control"].startswith("no-store")
        if version == "travel/unlisted-trip@1":
            assert document == link_preview.json()

    public_preview = owner.post(f"/api/trips/{trip['id']}/public-projection/preview").json()
    assert owner.post(f"/api/trips/{trip['id']}/public-projection/unpublish").status_code == 200
    assert anonymous.get(f"/api/public/trips/{slug}").status_code == 404
    assert owner.post(f"/api/trips/{trip['id']}/public-projection/preview").json() == public_preview


def test_preview_navigation_is_owner_authenticated_and_scope_checked_after_withdrawal() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    stage = add_route_stage(owner, trip["id"], 1, "Taipei", "Taipei")
    selected = scope(item("route_stage", stage["id"], "label", "navigation"))
    assert owner.put(f"/api/trips/{trip['id']}/public-projection", json=selected).status_code == 200
    public_path = f"/api/trips/{trip['id']}/public-projection/preview/navigation/route_stage-1"
    assert owner.get(public_path).json()["url"].startswith("https://www.google.com/maps/dir/?")
    assert owner.get(public_path.replace("route_stage-1", "route_stage-2")).status_code == 404
    assert client_for("other-owner").get(public_path).status_code == 404
    owner = client_for("owner-1")
    link = owner.post(f"/api/trips/{trip['id']}/share-links", json={"label": "Family", "scope": selected}).json()
    link_path = f"/api/trips/{trip['id']}/share-links/{link['id']}/preview/navigation/route_stage-1"
    token = activate(owner, trip["id"], link["id"])["token"]
    assert owner.post(f"/api/trips/{trip['id']}/share-links/{link['id']}/revoke").status_code == 200
    assert TestClient(app).get(f"/api/shared/{token}").status_code == 404
    assert owner.get(link_path).status_code == 200
    assert owner.get(link_path.replace("route_stage-1", "route_stage-2")).status_code == 404
    assert owner.patch(f"/api/trips/{trip['id']}/share-links/{link['id']}", json={"scope": scope()}).status_code == 409
