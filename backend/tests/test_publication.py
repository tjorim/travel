import io
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


def add_update(client: TestClient, trip_id: str, title: str, visibility: str = "custom") -> dict:
    response = client.post(
        f"/api/trips/{trip_id}/travel-updates",
        json={"occurred_at": "2054-04-04T10:00:00Z", "date_precision": "day", "title": title, "body": f"A safe note about {title}.", "visibility": visibility},
    )
    assert response.status_code == 201, response.text
    return response.json()


def scope(*items: dict, title: bool = True, summary: bool = True) -> dict:
    return {"schema_version": "travel/share-scope@1", "trip": {"title": title, "summary": summary}, "items": list(items)}


def item(kind: str, resource_id: str) -> dict:
    return {"kind": kind, "id": resource_id}


def share(client: TestClient, trip_id: str, kind: str, record_id: str, visibility: str = "custom") -> dict:
    """Set a record's visibility and return the scope item that lists it."""
    response = client.put(f"/api/trips/{trip_id}/visibility/{kind}/{record_id}", json={"visibility": visibility})
    assert response.status_code == 200, response.text
    return item(kind, record_id)


# --- Public follower view -----------------------------------------------------------


def test_map_inputs_use_only_selected_broad_points_and_routes() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    selected = owner.post(
        f"/api/trips/{trip['id']}/places/broad",
        json={"label": "Taipei area", "latitude": 25.0, "longitude": 121.0},
    ).json()
    hidden = owner.post(
        f"/api/trips/{trip['id']}/places/broad",
        json={"label": "Hidden area", "latitude": 12.0, "longitude": 34.0},
    ).json()
    route = owner.post(
        f"/api/trips/{trip['id']}/broad-routes",
        json={"label": "Selected line", "date_precision": "month", "geometry": {"type": "LineString", "coordinates": [[120.0, 24.0], [121.0, 25.0]]}},
    ).json()
    selected_scope = scope(
        share(owner, trip["id"], "place", selected["id"]),
        share(owner, trip["id"], "broad_route", route["id"]),
    )
    assert owner.put(f"/api/trips/{trip['id']}/public-projection", json=selected_scope).status_code == 200
    slug = owner.post(f"/api/trips/{trip['id']}/public-projection/publish").json()["slug"]
    link = owner.post(f"/api/trips/{trip['id']}/share-links", json={"label": "Map", "scope": selected_scope}).json()
    token = activate(owner, trip["id"], link["id"])["token"]

    for path in (f"/api/public/trips/{slug}", f"/api/shared/{token}"):
        delivered = TestClient(app).get(path)
        assert delivered.status_code == 200
        document = delivered.json()
        assert document["places"] == [{
            "id": document["places"][0]["id"], "label": "Taipei area", "country_code": None, "region": None,
            "latitude": 25.0, "longitude": 121.0,
        }]
        assert document["route"] == [{
            "id": document["route"][0]["id"], "label": "Selected line", "geometry": route["geometry"], "date_precision": "month",
        }]
        assert hidden["label"] not in delivered.text
        assert "34.0" not in delivered.text


def test_map_inputs_never_include_owner_only_geometry_or_unselected_coordinates(tmp_path: Path) -> None:
    owner = client_for("owner-1")
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    trip = create_trip(owner)
    exact = owner.post(
        f"/api/trips/{trip['id']}/places",
        json={"display_name": "Private hotel", "latitude": 23.4567, "longitude": 120.9876},
    )
    assert exact.status_code == 201, exact.text
    track = owner.post(
        f"/api/trips/{trip['id']}/recorded-tracks/uploads",
        data={"started_at": "2054-04-04T10:00:00Z", "ended_at": "2054-04-04T10:15:00Z", "kind": "point_array"},
        files={"file": ("walk.json", b'[{"latitude": 22.1111, "longitude": 119.2222, "time": "2054-04-04T10:00:00Z"},'
               b'{"latitude": 22.3333, "longitude": 119.4444, "time": "2054-04-04T10:15:00Z"}]', "application/json")},
    )
    assert track.status_code == 201, track.text
    label_only = owner.post(
        f"/api/trips/{trip['id']}/places/broad",
        json={"label": "Label-only area"},
    ).json()
    shared = scope(share(owner, trip["id"], "place", label_only["id"]))
    assert owner.put(f"/api/trips/{trip['id']}/public-projection", json=shared).status_code == 200
    slug = owner.post(f"/api/trips/{trip['id']}/public-projection/publish").json()["slug"]
    link = owner.post(f"/api/trips/{trip['id']}/share-links", json={"label": "Map", "scope": shared}).json()
    token = activate(owner, trip["id"], link["id"])["token"]

    for path in (f"/api/public/trips/{slug}", f"/api/shared/{token}"):
        delivered = TestClient(app).get(path)
        assert delivered.status_code == 200
        assert [place["label"] for place in delivered.json()["places"]] == ["Label-only area"]
        assert delivered.json()["route"] == []
        for secret in ("Private hotel", "23.4567", "120.9876", "22.1111", "119.2222", "22.3333", "119.4444"):
            assert secret not in delivered.text


def test_public_listing_tracks_live_scope_and_publication_without_owner_data() -> None:
    owner = client_for("owner-1")
    draft = create_trip(owner, "Private draft")
    unlisted = create_trip(owner, "Unlisted only")
    published = create_trip(owner, "Public trip")
    visitor = TestClient(app)
    listing = visitor.get("/api/public/trips")
    assert listing.status_code == 200
    assert listing.json() == []
    assert listing.headers["cache-control"] == "no-store"
    assert visitor.get("/exampleland-2054/").status_code == 404
    assert visitor.get("/api/public/trips/exampleland-2054").status_code == 404

    assert owner.post(f"/api/trips/{unlisted['id']}/share-links", json={"label": "Secret"}).status_code == 201
    assert owner.put(
        f"/api/trips/{published['id']}/public-projection", json=scope(title=True, summary=False)
    ).status_code == 200
    slug = owner.post(f"/api/trips/{published['id']}/public-projection/publish").json()["slug"]
    assert visitor.get("/api/public/trips").json() == [
        {"slug": slug, "title": "Public trip", "summary": None, "dates": None}
    ]

    owner.put(f"/api/trips/{published['id']}/public-projection", json=scope(title=False, summary=True))
    cards = visitor.get("/api/public/trips").json()
    assert cards == [{"slug": slug, "title": None, "summary": "A private trip.", "dates": None}]
    assert not {"id", "trip_id", "owner_subject", "scope", "token"} & cards[0].keys()
    assert draft["id"] not in str(cards) and unlisted["id"] not in str(cards)

    owner.post(f"/api/trips/{published['id']}/public-projection/unpublish")
    assert visitor.get("/api/public/trips").json() == []
    assert visitor.get(f"/api/public/trips/{slug}").status_code == 404


def test_public_projection_exposes_only_selected_items_and_reflects_later_edits_to_them() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    shown = add_update(owner, trip["id"], "Hotel check-in")
    hidden = add_update(owner, trip["id"], "Factory visit")

    assert owner.put(
        f"/api/trips/{trip['id']}/public-projection",
        json=scope(item("travel_update", shown["id"]), summary=False),
    ).status_code == 200

    preview = owner.post(f"/api/trips/{trip['id']}/public-projection/preview")
    assert preview.status_code == 200
    assert preview.headers["cache-control"] == "no-store"
    assert [m["title"] for m in preview.json()["updates"]] == [shown["title"]]
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
    titles = [m["title"] for m in document.json()["updates"]]
    assert titles == [shown["title"]]
    assert hidden["title"] not in titles
    assert "owner_subject" not in document.json()

    owner.patch(f"/api/trips/{trip['id']}/travel-updates/{hidden['id']}", json={"title": "Still hidden"})
    unchanged = anonymous.get(f"/api/public/trips/{slug}")
    assert [m["title"] for m in unchanged.json()["updates"]] == [shown["title"]]

    # A wording fix to a shared item reaches the public page immediately.
    owner.patch(f"/api/trips/{trip['id']}/travel-updates/{shown['id']}", json={"title": "Hotel check-in (updated)"})
    refreshed = anonymous.get(f"/api/public/trips/{slug}")
    assert refreshed.json()["updates"][0]["title"] == "Hotel check-in (updated)"


def test_live_story_order_stable_fragments_and_scoped_media_association(tmp_path: Path) -> None:
    owner = client_for("owner-1")
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    trip = create_trip(owner)
    late = add_update(owner, trip["id"], "Late")
    early = add_update(owner, trip["id"], "Early")
    hidden = add_update(owner, trip["id"], "Private")
    for excerpt, date in ((late, "2054-05-20"), (early, "2054-04-02"), (hidden, "2054-03-01")):
        assert owner.patch(f"/api/trips/{trip['id']}/travel-updates/{excerpt['id']}", json={"occurred_at": f"{date}T10:00:00Z"}).status_code == 200
    image_data = io.BytesIO()
    Image.new("RGB", (40, 30), (20, 30, 40)).save(image_data, format="JPEG")
    asset = owner.post(f"/api/trips/{trip['id']}/media/uploads", files={"file": ("private.jpg", image_data.getvalue(), "image/jpeg")}).json()
    derivative = owner.post(f"/api/trips/{trip['id']}/media/{asset['id']}/derivatives", json={"purpose": "share"}).json()
    owner.post(f"/api/trips/{trip['id']}/media/{asset['id']}/derivatives/{derivative['id']}/approve")
    presentation_url = f"/api/trips/{trip['id']}/media/{asset['id']}/derivatives/{derivative['id']}/presentation"
    assert owner.patch(presentation_url, json={"travel_update_id": early["id"], "caption": "Shared caption", "alt_text": "Train", "focal_x": 25, "focal_y": 60}).status_code == 200
    selected = scope(item("travel_update", late["id"]), item("travel_update", early["id"]))
    assert owner.put(f"/api/trips/{trip['id']}/public-projection", json=selected).status_code == 200
    slug = owner.post(f"/api/trips/{trip['id']}/public-projection/publish").json()["slug"]
    visitor = TestClient(app)
    document = visitor.get(f"/api/public/trips/{slug}").json()
    assert [moment["title"] for moment in document["updates"]] == ["Early", "Late"]
    assert [moment["story_date"] for moment in document["updates"]] == ["2054-04-02", "2054-05-20"]
    # The photo is attached to "Early", so it travels with that update; nothing else selects it.
    assert document["media"][0]["update"] == document["updates"][0]["id"]
    assert document["media"][0]["caption"] == "Shared caption"
    assert document["media"][0]["focal_x"] == 25
    assert asset["id"] not in str(document) and hidden["title"] not in str(document)
    link = owner.post(f"/api/trips/{trip['id']}/share-links", json={"label": "Family", "scope": selected}).json()
    token = activate(owner, trip["id"], link["id"])["token"]
    unlisted = visitor.get(f"/api/shared/{token}").json()
    assert unlisted["updates"] == document["updates"]
    assert unlisted["media"] == document["media"]
    stable_id = document["updates"][0]["id"]
    assert owner.put(f"/api/trips/{trip['id']}/public-projection", json=scope(item("travel_update", early["id"]))).status_code == 200
    narrowed = visitor.get(f"/api/public/trips/{slug}").json()
    assert narrowed["updates"][0]["id"] == stable_id
    assert narrowed["media"][0]["update"] == stable_id
    # Without its update the photo is no longer delivered: its own choice is private.
    assert owner.put(f"/api/trips/{trip['id']}/public-projection", json=scope(item("travel_update", late["id"]))).status_code == 200
    assert visitor.get(f"/api/public/trips/{slug}").json()["media"] == []
    assert visitor.get(f"/api/shared/{token}").json()["media"][0]["update"] == stable_id

    assert owner.patch(f"/api/trips/{trip['id']}/travel-updates/{early['id']}", json={"date_precision": "month"}).status_code == 200
    reduced = visitor.get(f"/api/shared/{token}").json()
    assert reduced["updates"][0]["story_date"] == "2054-04"
    assert "2054-04-02" not in str(reduced)

    other = create_trip(owner, "Other")
    foreign = add_update(owner, other["id"], "Foreign")
    assert owner.patch(presentation_url, json={"travel_update_id": foreign["id"]}).status_code == 422

def test_the_private_part_of_an_update_never_reaches_visitors(tmp_path: Path) -> None:
    """Notes, the exact place, attached originals and the exact time stay private even when the update is shared."""
    owner = client_for("owner-1")
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    trip = create_trip(owner)
    uploaded = owner.post(
        f"/api/trips/{trip['id']}/media/uploads", files={"file": ("private.jpg", b"not-a-real-jpeg", "image/jpeg")}
    )
    assert uploaded.status_code == 201, uploaded.text
    asset_id = uploaded.json()["id"]
    created = owner.post(
        f"/api/trips/{trip['id']}/travel-updates",
        json={
            "occurred_at": "2054-04-04T10:37:12Z", "title": "Arrival", "body": "We landed in Taipei.",
            "private_notes": "Not for sharing.", "media_asset_ids": [asset_id],
            "place": {"label": "Cafe", "display_name": "Secret cafe, 9 Hidden Lane", "latitude": 25.0331, "longitude": 121.5651},
        },
    )
    assert created.status_code == 201, created.text
    assert owner.put(
        f"/api/trips/{trip['id']}/visibility/travel_update/{created.json()['id']}", json={"visibility": "everyone"}
    ).status_code == 200
    slug = owner.post(f"/api/trips/{trip['id']}/public-projection/publish").json()["slug"]

    delivered = TestClient(app).get(f"/api/public/trips/{slug}")
    (update,) = delivered.json()["updates"]
    assert update == {
        "id": update["id"], "title": "Arrival", "body": "We landed in Taipei.", "date_precision": "day",
            "story_date": "2054-04-04", "place": {"label": "Unassigned", "country_code": None, "region": None, "latitude": None, "longitude": None},
    }
    for private in ("Not for sharing", "Secret cafe", "Hidden Lane", "25.0331", "121.5651", asset_id, "10:37", "media_asset_ids", "private_notes"):
        assert private not in delivered.text


def test_public_projection_scope_changes_after_publish_are_live() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    hotel = add_update(owner, trip["id"], "Hotel")
    factory = add_update(owner, trip["id"], "Factory visit")

    owner.put(
        f"/api/trips/{trip['id']}/public-projection",
        json=scope(item("travel_update", hotel["id"])),
    )
    published = owner.post(f"/api/trips/{trip['id']}/public-projection/publish")
    slug = published.json()["slug"]

    anonymous = TestClient(app)
    before = anonymous.get(f"/api/public/trips/{slug}").json()
    assert [m["title"] for m in before["updates"]] == [hotel["title"]]

    # Widening the scope (adding an item) takes effect immediately: no
    # separate re-publish step is required once the trip is already public.
    widened = owner.put(
        f"/api/trips/{trip['id']}/public-projection",
        json=scope(item("travel_update", hotel["id"]), item("travel_update", factory["id"])),
    )
    assert widened.status_code == 200
    after_widen = anonymous.get(f"/api/public/trips/{slug}").json()
    assert {m["title"] for m in after_widen["updates"]} == {hotel["title"], factory["title"]}

    # Narrowing it back removes an item just as immediately.
    owner.put(
        f"/api/trips/{trip['id']}/public-projection",
        json=scope(item("travel_update", hotel["id"])),
    )
    after_narrow = anonymous.get(f"/api/public/trips/{slug}").json()
    assert [m["title"] for m in after_narrow["updates"]] == [hotel["title"]]


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
    foreign_moment = add_update(owner, trip_b["id"], "Not yours")

    response = owner.put(
        f"/api/trips/{trip_a['id']}/public-projection",
        json=scope(item("travel_update", foreign_moment["id"])),
    )
    assert response.status_code == 422


def test_scope_rejects_retired_kinds_field_choices_and_records_that_are_not_custom() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    stage = add_route_stage(owner, trip["id"], 0, "Taipei", "Taipei")
    path = f"/api/trips/{trip['id']}/public-projection"

    # The old twin kinds no longer exist.
    assert owner.put(path, json=scope(item("broad_stay_card", "x"))).status_code == 422
    assert owner.put(path, json=scope(item("exact_place", "x"))).status_code == 422
    # A scope names records, never fields.
    with_fields = {"kind": "route_stage", "id": stage["id"], "fields": ["place", "owner_notes"]}
    assert owner.put(path, json=scope(with_fields)).status_code == 422
    # A record must be custom before an audience can list it.
    assert owner.put(path, json=scope(item("route_stage", stage["id"]))).status_code == 422
    share(owner, trip["id"], "route_stage", stage["id"])
    assert owner.put(path, json=scope(item("route_stage", stage["id"]))).status_code == 200


def test_projection_delivers_only_chosen_records_with_fixed_fields_and_their_files(tmp_path: Path) -> None:
    """One chosen record must never bring its peers or private fields."""
    owner = client_for("owner-1")
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    stage = add_route_stage(owner, trip["id"], 0, "Taipei", "Taipei")
    place_id = stage["place"]["id"]

    def stay(name: str) -> dict:
        return owner.post(f"{trips_path}/stays", json={
            "broad_place_id": place_id, "check_in_date": "2054-04-01", "check_out_date": "2054-04-05", "property_name": name,
        }).json()

    selected_stay, hidden_stay = stay("Taipei base"), stay("Hidden stay")
    selected_route = owner.post(
        f"{trips_path}/broad-routes",
        json={"label": "North coast", "date_precision": "day", "geometry": {"type": "LineString", "coordinates": [[121, 25], [121.1, 25.1]]}},
    ).json()
    hidden_route = owner.post(
        f"{trips_path}/broad-routes",
        json={"label": "Private raw route", "date_precision": "day", "geometry": {"type": "LineString", "coordinates": [[120, 24], [120.1, 24.1]]}},
    ).json()

    image_data = io.BytesIO()
    Image.new("RGB", (10, 10), (20, 30, 40)).save(image_data, format="JPEG")
    media = owner.post(f"{trips_path}/media/uploads", files={"file": ("private.jpg", image_data.getvalue(), "image/jpeg")}).json()
    pending_media = owner.post(f"{trips_path}/media/{media['id']}/derivatives", json={"purpose": "share"}).json()
    unapproved = owner.put(f"{trips_path}/visibility/media_derivative/{pending_media['id']}", json={"visibility": "custom"})
    assert unapproved.status_code == 422 and "Approve" in unapproved.json()["detail"]
    selected_media = owner.post(f"{trips_path}/media/{media['id']}/derivatives/{pending_media['id']}/approve").json()

    document = owner.post(
        f"{trips_path}/documents/uploads",
        data={"title": "Safe itinerary", "document_kind": "itinerary"},
        files={"file": ("private.txt", b"private", "text/plain")},
    ).json()
    pending_document = owner.post(
        f"{trips_path}/documents/{document['id']}/derivatives",
        files={"file": ("safe.txt", b"safe", "text/plain"), "redaction_manifest": ("redactions.json", b"{}", "application/json")},
    ).json()
    assert owner.put(f"{trips_path}/visibility/document_derivative/{pending_document['id']}", json={"visibility": "custom"}).status_code == 422
    selected_document = owner.post(f"{trips_path}/documents/{document['id']}/derivatives/{pending_document['id']}/approve").json()

    selected = scope(
        share(owner, trip["id"], "stay", selected_stay["id"]),
        share(owner, trip["id"], "route_stage", stage["id"]),
        share(owner, trip["id"], "place", place_id),
        share(owner, trip["id"], "broad_route", selected_route["id"]),
        share(owner, trip["id"], "media_derivative", selected_media["id"]),
        share(owner, trip["id"], "document_derivative", selected_document["id"]),
    )
    assert owner.put(f"{trips_path}/public-projection", json=selected).status_code == 200
    preview = owner.post(f"{trips_path}/public-projection/preview")
    assert preview.status_code == 200
    ids = {key: preview.json()[key][0]["id"] for key in ("stays", "route_stages", "places", "route", "media", "documents")}
    preview_file_base = f"{trips_path}/public-projection/preview/files"
    assert owner.get(f"{preview_file_base}/{ids['documents']}").content == b"safe"
    assert owner.get(f"{preview_file_base}/{ids['media']}").status_code == 200
    assert owner.get(f"{preview_file_base}/document_derivative-unknown").status_code == 404
    assert client_for("other-owner").get(f"{preview_file_base}/{ids['documents']}").status_code == 404
    owner = client_for("owner-1")
    slug = owner.post(f"{trips_path}/public-projection/publish").json()["slug"]
    projection = TestClient(app).get(f"/api/public/trips/{slug}").json()

    assert projection == {**preview.json()}
    assert [stay["title"] for stay in projection["stays"]] == ["Taipei"]
    assert projection["route_stages"][0]["label"] == "Taipei"
    assert [place["label"] for place in projection["places"]] == ["Taipei"]
    assert [route["label"] for route in projection["route"]] == ["North coast"]
    assert projection["media"][0]["image"] == {"id": ids["media"]}
    assert projection["documents"] == [{"id": ids["documents"], "title": "Safe itinerary", "file": {"id": ids["documents"]}}]
    for private in ("Taipei base", "Hidden stay", hidden_route["label"], "Private raw route"):
        assert private not in str(projection)
    assert hidden_stay["id"] not in str(projection)
    assert "media_asset_id" not in str(projection)
    assert "document_asset_id" not in str(projection)

    media_url = f"/api/public/trips/{slug}/files/{ids['media']}"
    document_url = f"/api/public/trips/{slug}/files/{ids['documents']}"
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
    assert visitor.get(f"/api/public/trips/{slug}/files/{ids['stays']}").status_code == 404

    link = owner.post(f"{trips_path}/share-links", json={"label": "Visitor", "scope": selected}).json()
    shared = activate(owner, trip["id"], link["id"])
    shared_url = f"/api/shared/{shared['token']}/files/{ids['documents']}"
    share_preview_file = f"{trips_path}/share-links/{link['id']}/preview/files/{ids['documents']}"
    assert owner.get(share_preview_file).content == b"safe"
    assert visitor.get(shared_url).content == b"safe"
    assert visitor.get(shared_url).headers["cache-control"] == "no-store, private"

    # Taking a record out of every audience stops its file at once.
    without_files = scope(*(entry for entry in selected["items"] if entry["kind"] not in {"media_derivative", "document_derivative"}))
    assert owner.put(f"{trips_path}/public-projection", json=without_files).status_code == 200
    assert visitor.get(media_url).status_code == 404
    assert visitor.get(document_url).status_code == 404
    assert owner.get(f"{preview_file_base}/{ids['documents']}").status_code == 404
    assert owner.patch(f"{trips_path}/share-links/{link['id']}", json={"scope": without_files}).status_code == 200
    assert visitor.get(shared_url).status_code == 404
    assert owner.get(share_preview_file).status_code == 404
    assert owner.post(f"{trips_path}/share-links/{link['id']}/revoke").status_code == 200
    assert owner.get(share_preview_file).status_code == 404
    assert visitor.get(shared_url).status_code == 404


# --- Named unlisted share links ------------------------------------------------------


def activate(owner: TestClient, trip_id: str, link_id: str, expires_in_days: int | None = 30) -> dict:
    owner.post(f"/api/trips/{trip_id}/share-links/{link_id}/preview")
    response = owner.post(
        f"/api/trips/{trip_id}/share-links/{link_id}/activate", json={"expires_in_days": expires_in_days}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_share_link_lifecycle_keeps_its_owner_url_and_serves_only_its_scope() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    hotel = add_update(owner, trip["id"], "Hotel")
    add_update(owner, trip["id"], "Factory tour")

    created = owner.post(
        f"/api/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": scope(item("travel_update", hotel["id"]))},
    )
    assert created.status_code == 201, created.text
    link_id = created.json()["id"]
    assert created.json()["token"] is None

    activated = activate(owner, trip["id"], link_id)
    token = activated["token"]
    assert activated["state"] == "active"
    assert len(token) >= 32
    assert owner.get(f"/api/trips/{trip['id']}/share-links/{link_id}").json()["token"] == token

    anonymous = TestClient(app)
    delivered = anonymous.get(f"/api/shared/{token}")
    assert delivered.status_code == 200
    assert [m["title"] for m in delivered.json()["updates"]] == [hotel["title"]]
    assert delivered.headers["cache-control"] == "no-store, private"
    assert delivered.headers["x-robots-tag"] == "noindex, noarchive"
    assert delivered.headers["referrer-policy"] == "no-referrer"

    # Only the scope (which moments) is frozen at activation; a wording fix
    # to an already-in-scope moment reaches the link immediately.
    owner.patch(f"/api/trips/{trip['id']}/travel-updates/{hotel['id']}", json={"title": "Hotel (updated)"})
    refreshed = anonymous.get(f"/api/shared/{token}")
    assert refreshed.json()["updates"][0]["title"] == "Hotel (updated)"


def test_share_link_scope_changes_while_active_are_live() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    hotel = add_update(owner, trip["id"], "Hotel")
    factory = add_update(owner, trip["id"], "Factory visit")

    created = owner.post(
        f"/api/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": scope(item("travel_update", hotel["id"]))},
    )
    link_id = created.json()["id"]
    token = activate(owner, trip["id"], link_id)["token"]

    anonymous = TestClient(app)
    before = anonymous.get(f"/api/shared/{token}").json()
    assert [m["title"] for m in before["updates"]] == [hotel["title"]]

    # An already-active link's scope is not immutable: the owner can widen or
    # narrow it directly, and the same still-valid token reflects it live.
    widened = owner.patch(
        f"/api/trips/{trip['id']}/share-links/{link_id}",
        json={"scope": scope(item("travel_update", hotel["id"]), item("travel_update", factory["id"]))},
    )
    assert widened.status_code == 200
    assert widened.json()["state"] == "active"
    after_widen = anonymous.get(f"/api/shared/{token}").json()
    assert {m["title"] for m in after_widen["updates"]} == {hotel["title"], factory["title"]}

    owner.patch(
        f"/api/trips/{trip['id']}/share-links/{link_id}",
        json={"scope": scope(item("travel_update", hotel["id"]))},
    )
    after_narrow = anonymous.get(f"/api/shared/{token}").json()
    assert [m["title"] for m in after_narrow["updates"]] == [hotel["title"]]


def test_a_hotel_scoped_link_cannot_reveal_the_owner_only_factory_location() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    hotel = add_update(owner, trip["id"], "Hotel")
    factory = add_update(owner, trip["id"], "Factory visit")

    created = owner.post(
        f"/api/trips/{trip['id']}/share-links",
        json={"label": "Hotel only", "scope": scope(item("travel_update", hotel["id"]))},
    )
    link_id = created.json()["id"]
    token = activate(owner, trip["id"], link_id)["token"]

    anonymous = TestClient(app)
    delivered = anonymous.get(f"/api/shared/{token}").json()
    assert factory["title"] not in [m["title"] for m in delivered["updates"]]
    assert "Factory" not in str(delivered)


def test_share_link_responses_return_the_owner_managed_url_but_never_its_verifier() -> None:
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
    assert body[0]["token"] == token
    assert "token_verifier" not in body[0]

    with TestingSessionLocal() as session:
        row = session.scalar(select(ShareLink).where(ShareLink.id == link_id))
        assert row.token_verifier is not None
        assert row.token_verifier != token
        assert row.token == token


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
    hotel = add_update(owner, trip["id"], "Hotel")
    created = owner.post(
        f"/api/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": scope(item("travel_update", hotel["id"]))},
    )
    link_id = created.json()["id"]
    old_token = activate(owner, trip["id"], link_id)["token"]

    rotated = owner.post(f"/api/trips/{trip['id']}/share-links/{link_id}/rotate", json={"expires_in_days": 30})
    assert rotated.status_code == 200
    new_token = rotated.json()["token"]
    assert new_token != old_token
    assert rotated.json()["series_id"] == link_id

    listed = owner.get(f"/api/trips/{trip['id']}/share-links").json()
    assert {link["series_id"] for link in listed} == {link_id}

    anonymous = TestClient(app)
    assert anonymous.get(f"/api/shared/{old_token}").status_code == 404
    fresh = anonymous.get(f"/api/shared/{new_token}")
    assert fresh.status_code == 200
    assert [m["title"] for m in fresh.json()["updates"]] == [hotel["title"]]


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


def test_share_link_can_remain_active_until_its_owner_revokes_it() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    created = owner.post(
        f"/api/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": scope()},
    )
    link_id = created.json()["id"]

    activated = activate(owner, trip["id"], link_id, expires_in_days=None)
    token = activated["token"]
    assert activated["expires_at"] is None

    anonymous = TestClient(app)
    assert anonymous.get(f"/api/shared/{token}").status_code == 200

    rotated = owner.post(
        f"/api/trips/{trip['id']}/share-links/{link_id}/rotate", json={"expires_in_days": None}
    )
    assert rotated.status_code == 200
    assert rotated.json()["expires_at"] is None
    assert anonymous.get(f"/api/shared/{token}").status_code == 404
    assert anonymous.get(f"/api/shared/{rotated.json()['token']}").status_code == 200


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
    excerpt = add_update(owner, trip["id"], "Visible excerpt")
    selected = scope(item("travel_update", excerpt["id"]))
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
        assert [moment["title"] for moment in document["updates"]] == ["Visible excerpt"]
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
    area = owner.post(f"/api/trips/{trip['id']}/places/broad", json={"label": "Taipei", "country_code": "TW"}).json()
    selected = scope(share(owner, trip["id"], "place", area["id"]))
    assert owner.put(f"/api/trips/{trip['id']}/public-projection", json=selected).status_code == 200
    marker = owner.post(f"/api/trips/{trip['id']}/public-projection/preview").json()["navigation"][0]["id"]
    public_path = f"/api/trips/{trip['id']}/public-projection/preview/navigation/{marker}"
    assert owner.get(public_path).json()["url"].startswith("https://www.google.com/maps/dir/?")
    assert owner.get(public_path.replace(marker, "place-unknown")).status_code == 404
    assert client_for("other-owner").get(public_path).status_code == 404
    owner = client_for("owner-1")
    link = owner.post(f"/api/trips/{trip['id']}/share-links", json={"label": "Family", "scope": selected}).json()
    link_path = f"/api/trips/{trip['id']}/share-links/{link['id']}/preview/navigation/{marker}"
    token = activate(owner, trip["id"], link["id"])["token"]
    assert owner.post(f"/api/trips/{trip['id']}/share-links/{link['id']}/revoke").status_code == 200
    assert TestClient(app).get(f"/api/shared/{token}").status_code == 404
    assert owner.get(link_path).status_code == 200
    assert owner.get(link_path.replace(marker, "place-unknown")).status_code == 404
    assert owner.patch(f"/api/trips/{trip['id']}/share-links/{link['id']}", json={"scope": scope()}).status_code == 409


def test_stage_summaries_and_trip_dates_appear_only_when_chosen() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    assert owner.patch(
        f"/api/trips/{trip['id']}", json={"starts_on": "2054-11-16", "ends_on": "2054-12-06"}
    ).status_code == 200
    stage = owner.post(
        f"/api/trips/{trip['id']}/route-stages",
        json={"position": 0, "label": "Taipei", "summary": "City, food and a first weekend.",
              "place": {"label": "Taipei", "country_code": "TW"}},
    ).json()

    # A private stage and unshared dates reach nobody.
    slug = owner.post(f"/api/trips/{trip['id']}/public-projection/publish").json()["slug"]
    document = TestClient(app).get(f"/api/public/trips/{slug}").json()
    assert document["dates"] is None and document["route_stages"] == []
    assert "highlights" not in document
    assert "First weekend" not in str(document) and "2054-11" not in str(document)

    # Sharing the stage needs no scope entry; the dates are a separate, trip-level choice.
    share(owner, trip["id"], "route_stage", stage["id"], "everyone")
    selected = scope()
    selected["trip"]["dates"] = "month"
    assert owner.put(f"/api/trips/{trip['id']}/public-projection", json=selected).status_code == 200
    delivered = TestClient(app).get(f"/api/public/trips/{slug}")
    document = delivered.json()
    assert document["dates"] == {"starts_on": "2054-11", "ends_on": "2054-12", "date_precision": "month"}
    assert document["route_stages"][0]["summary"] == "City, food and a first weekend."
    assert "2054-11-16" not in delivered.text
    assert TestClient(app).get("/api/public/trips").json()[0]["dates"] == document["dates"]


def test_trip_dates_are_ordered() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    assert owner.patch(
        f"/api/trips/{trip['id']}", json={"starts_on": "2054-12-06", "ends_on": "2054-11-16"}
    ).status_code == 422
    assert owner.post(
        "/api/trips", json={"title": "Backwards", "starts_on": "2054-12-06", "ends_on": "2054-11-16"}
    ).status_code == 422


def test_an_update_reaches_visitors_according_to_its_own_visibility() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    private = add_update(owner, trip["id"], "Private diary", "private")
    everyone = add_update(owner, trip["id"], "Arrival", "everyone")
    chosen = add_update(owner, trip["id"], "Family only", "custom")
    unchosen = add_update(owner, trip["id"], "Left out", "custom")
    trips_path = f"/api/trips/{trip['id']}"

    # A new update is private unless the owner says otherwise.
    default = owner.post(f"{trips_path}/travel-updates", json={"occurred_at": "2054-04-04T10:00:00Z", "date_precision": "day", "title": "Default", "body": "Text."}).json()
    assert default["visibility"] == "private"

    # Only a custom update can be chosen for an audience; the others are decided by their visibility.
    for update in (private, everyone, default):
        assert owner.put(f"{trips_path}/public-projection", json=scope(item("travel_update", update["id"]))).status_code == 422
    assert owner.put(f"{trips_path}/public-projection", json=scope({**item("travel_update", chosen["id"]), "fields": ["title"]})).status_code == 422

    # Public view: every everyone update plus the custom update it selects.
    assert owner.put(f"{trips_path}/public-projection", json=scope(item("travel_update", chosen["id"]))).status_code == 200
    slug = owner.post(f"{trips_path}/public-projection/publish").json()["slug"]
    # A named link that selects nothing still gets the everyone update, and not the public view's custom one.
    link = owner.post(f"{trips_path}/share-links", json={"label": "Nothing chosen", "scope": scope()}).json()
    token = activate(owner, trip["id"], link["id"])["token"]

    public = TestClient(app).get(f"/api/public/trips/{slug}")
    assert {update["title"] for update in public.json()["updates"]} == {"Arrival", "Family only"}
    unlisted = TestClient(app).get(f"/api/shared/{token}")
    assert [update["title"] for update in unlisted.json()["updates"]] == ["Arrival"]
    for delivered in (public, unlisted):
        assert "Private diary" not in delivered.text and "Left out" not in delivered.text and "Default" not in delivered.text

    # The update's own choice is the source of truth, immediately.
    assert owner.patch(f"{trips_path}/travel-updates/{everyone['id']}", json={"visibility": "private"}).status_code == 200
    assert owner.patch(f"{trips_path}/travel-updates/{unchosen['id']}", json={"visibility": "everyone"}).status_code == 200
    assert [update["title"] for update in TestClient(app).get(f"/api/shared/{token}").json()["updates"]] == ["Left out"]
    assert {update["title"] for update in TestClient(app).get(f"/api/public/trips/{slug}").json()["updates"]} == {"Left out", "Family only"}


def test_leaving_custom_or_deleting_an_update_withdraws_it_from_every_scope() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    update = add_update(owner, trip["id"], "Family only")
    doomed = add_update(owner, trip["id"], "Doomed")
    selected = scope(item("travel_update", update["id"]), item("travel_update", doomed["id"]))
    owner.put(f"{trips_path}/public-projection", json=selected)
    link = owner.post(f"{trips_path}/share-links", json={"label": "Family", "scope": selected}).json()

    assert owner.patch(f"{trips_path}/travel-updates/{update['id']}", json={"visibility": "private"}).status_code == 200
    assert owner.delete(f"{trips_path}/travel-updates/{doomed['id']}").status_code == 204
    assert owner.get(f"{trips_path}/public-projection").json()["scope"]["items"] == []
    assert owner.get(f"{trips_path}/share-links/{link['id']}").json()["scope"]["items"] == []

    # Even if the owner flips it back, it is not chosen again until they choose it.
    owner.patch(f"{trips_path}/travel-updates/{update['id']}", json={"visibility": "custom"})
    assert owner.post(f"{trips_path}/public-projection/preview").json()["updates"] == []


def test_delivery_ignores_a_stale_scope_entry_for_a_private_or_missing_update() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    private = add_update(owner, trip["id"], "Private diary", "private")
    stale = scope(item("travel_update", private["id"]), item("travel_update", "gone"))
    with TestingSessionLocal() as session:
        link = ShareLink(trip_id=trip["id"], label="Stale", series_id="stale", scope=stale, state="draft")
        session.add(link)
        session.commit()
        link_id = link.id

    preview = owner.post(f"/api/trips/{trip['id']}/share-links/{link_id}/preview")
    assert preview.status_code == 200
    assert preview.json()["updates"] == []
    assert "Private diary" not in preview.text


def test_a_photo_travels_with_its_update_and_only_while_the_update_is_delivered(tmp_path: Path) -> None:
    owner = client_for("owner-1")
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    update = add_update(owner, trip["id"], "Arrival", "everyone")
    image_data = io.BytesIO()
    Image.new("RGB", (40, 30), (20, 30, 40)).save(image_data, format="JPEG")
    media = owner.post(f"{trips_path}/media/uploads", files={"file": ("a.jpg", image_data.getvalue(), "image/jpeg")}).json()
    derivative = owner.post(f"{trips_path}/media/{media['id']}/derivatives", json={"purpose": "share"}).json()
    derivative_path = f"{trips_path}/media/{media['id']}/derivatives/{derivative['id']}"
    owner.post(f"{derivative_path}/approve")
    assert owner.patch(f"{derivative_path}/presentation", json={"travel_update_id": update["id"]}).status_code == 200

    # The photo is private itself; it is delivered because it is attached to a delivered update.
    document = owner.post(f"{trips_path}/public-projection/preview").json()
    assert document["media"][0]["update"] == document["updates"][0]["id"]

    owner.patch(f"{trips_path}/travel-updates/{update['id']}", json={"visibility": "private"})
    withdrawn = owner.post(f"{trips_path}/public-projection/preview").json()
    assert withdrawn["updates"] == [] and withdrawn["media"] == []


def test_visibility_is_the_same_owner_only_choice_for_every_kind() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    stage = add_route_stage(owner, trip["id"], 0, "Taipei", "Taipei")
    assert stage["visibility"] == "private"
    path = f"/api/trips/{trip['id']}/visibility/route_stage/{stage['id']}"

    assert owner.put(path, json={"visibility": "everyone"}).json() == {"visibility": "everyone"}
    assert owner.put(path, json={"visibility": "sometimes"}).status_code == 422
    other = client_for("owner-2")
    assert other.put(path, json={"visibility": "private"}).status_code == 404
    other_trip = create_trip(other, "Other")
    assert other.put(
        f"/api/trips/{other_trip['id']}/visibility/route_stage/{stage['id']}", json={"visibility": "everyone"}
    ).status_code == 404
    owner = client_for("owner-1")
    assert owner.put(f"/api/trips/{trip['id']}/visibility/route_stage/unknown", json={"visibility": "everyone"}).status_code == 404
    assert owner.put(f"/api/trips/{trip['id']}/visibility/exact_place/x", json={"visibility": "everyone"}).status_code == 422


def test_leaving_custom_withdraws_any_kind_from_every_live_scope() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    stage = add_route_stage(owner, trip["id"], 0, "Taipei", "Taipei")
    selected = scope(share(owner, trip["id"], "route_stage", stage["id"]))
    owner.put(f"{trips_path}/public-projection", json=selected)
    link = owner.post(f"{trips_path}/share-links", json={"label": "Family", "scope": selected}).json()
    assert owner.post(f"{trips_path}/public-projection/preview").json()["route_stages"][0]["label"] == "Taipei"

    share(owner, trip["id"], "route_stage", stage["id"], "everyone")
    assert owner.get(f"{trips_path}/public-projection").json()["scope"]["items"] == []
    assert owner.get(f"{trips_path}/share-links/{link['id']}").json()["scope"]["items"] == []
    assert owner.post(f"{trips_path}/public-projection/preview").json()["route_stages"][0]["label"] == "Taipei"

    share(owner, trip["id"], "route_stage", stage["id"], "private")
    assert owner.post(f"{trips_path}/public-projection/preview").json()["route_stages"] == []
    # Choosing custom again does not restore an old listing.
    share(owner, trip["id"], "route_stage", stage["id"])
    assert owner.post(f"{trips_path}/public-projection/preview").json()["route_stages"] == []
