from collections.abc import Generator
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.database import Base, get_session
from app.main import app
from app.storage import LocalObjectStorage, get_storage

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def override_session() -> Generator[Session]:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def client_for(subject: str, tmp_path: Path) -> TestClient:
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[current_subject] = lambda: subject
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    return TestClient(app)


def setup_function() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def teardown_function() -> None:
    app.dependency_overrides.clear()


def create_trip(client: TestClient) -> dict:
    response = client.post("/api/v1/trips", json={"title": "Exampleland 2054", "summary": "A private trip."})
    assert response.status_code == 201, response.text
    return response.json()


def point_array() -> bytes:
    return b'''{
      "points": [
        {"latitude": 25.033, "longitude": 121.565, "recorded_at": "2054-04-04T10:00:00Z", "speed": 1.2},
        {"latitude": 25.034, "longitude": 121.566, "recorded_at": "2054-04-04T10:15:00Z", "elevation": 12}
      ]
    }'''


def upload_track(client: TestClient, trip_id: str, data: bytes | None = None):
    return client.post(
        f"/api/v1/trips/{trip_id}/recorded-tracks/uploads",
        data={
            "started_at": "2054-04-04T10:00:00Z",
            "ended_at": "2054-04-04T10:15:00Z",
            "kind": "point_array",
        },
        files={"file": ("walk.json", data or point_array(), "application/json")},
    )


def test_owner_can_upload_and_read_a_finished_track_only_as_one_bounded_action(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    uploaded = upload_track(owner, trip["id"])
    assert uploaded.status_code == 201, uploaded.text
    track = uploaded.json()
    assert track["kind"] == "point_array"
    assert track["content_type"] == "application/json"
    assert track["source_file_url"].endswith(f"/recorded-tracks/{track['id']}/source")
    assert owner.get(f"/api/v1/trips/{trip['id']}/recorded-tracks").json() == [track]
    raw = owner.get(track["source_file_url"])
    assert raw.status_code == 200
    assert raw.content == point_array()

    gpx = b"""<?xml version=\"1.0\"?><gpx version=\"1.1\"><trk><trkseg>
      <trkpt lat=\"25.033\" lon=\"121.565\"><time>2054-04-04T10:00:00Z</time></trkpt>
      <trkpt lat=\"25.034\" lon=\"121.566\"><time>2054-04-04T10:15:00Z</time></trkpt>
    </trkseg></trk></gpx>"""
    gpx_upload = owner.post(
        f"/api/v1/trips/{trip['id']}/recorded-tracks/uploads",
        data={
            "started_at": "2054-04-04T10:00:00Z",
            "ended_at": "2054-04-04T10:15:00Z",
            "kind": "gpx",
        },
        files={"file": ("walk.gpx", gpx, "application/gpx+xml; charset=utf-8")},
    )
    assert gpx_upload.status_code == 201, gpx_upload.text
    assert gpx_upload.json()["kind"] == "gpx"

    # A retry is safe and still represents the same completed recording.
    assert upload_track(owner, trip["id"]).status_code == 200

    # No open-ended or partial payload has an endpoint shape that can pass.
    missing_end = owner.post(
        f"/api/v1/trips/{trip['id']}/recorded-tracks/uploads",
        data={"started_at": "2054-04-04T10:00:00Z", "kind": "point_array"},
        files={"file": ("walk.json", point_array(), "application/json")},
    )
    assert missing_end.status_code == 422
    one_point = upload_track(
        owner,
        trip["id"],
        b'[{"latitude":25.033,"longitude":121.565,"recorded_at":"2054-04-04T10:00:00Z"}]',
    )
    assert one_point.status_code == 422


def test_raw_tracks_are_unreachable_to_other_owners_and_all_public_surfaces(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    track = upload_track(owner, trip["id"]).json()
    other = client_for("owner-2", tmp_path)

    assert other.get(f"/api/v1/trips/{trip['id']}/recorded-tracks").status_code == 404
    assert other.get(f"/api/v1/trips/{trip['id']}/recorded-tracks/{track['id']}").status_code == 404
    assert other.get(track["source_file_url"]).status_code == 404

    owner = client_for("owner-1", tmp_path)
    assert owner.put(
        f"/api/v1/trips/{trip['id']}/public-projection", json={"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": []}
    ).status_code == 200
    published = owner.post(f"/api/v1/trips/{trip['id']}/public-projection/publish")
    assert published.status_code == 200, published.text
    delivered = TestClient(app).get(f"/api/v1/public/trips/{published.json()['slug']}")
    assert delivered.status_code == 200, delivered.text
    assert "recorded_tracks" not in delivered.text
    assert "121.565" not in delivered.text
    assert "2054-04-04T10:15:00" not in delivered.text


def test_broad_route_is_the_exact_owner_authored_geometry_not_a_track_derivative(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    upload_track(owner, trip["id"])
    geometry = {"type": "LineString", "coordinates": [[121.0, 25.0], [122.0, 26.0]]}

    created = owner.post(
        f"/api/v1/trips/{trip['id']}/broad-routes",
        json={"label": "Exampleland highlights", "geometry": geometry, "date_precision": "month"},
    )
    assert created.status_code == 201, created.text
    route = created.json()
    assert route["geometry"] == geometry
    assert "recorded_track_id" not in route

    read_again = owner.get(f"/api/v1/trips/{trip['id']}/broad-routes/{route['id']}")
    assert read_again.status_code == 200
    assert read_again.json()["geometry"] == geometry

    edited_geometry = {"type": "LineString", "coordinates": [[120.0, 24.0], [123.0, 27.0]]}
    changed = owner.patch(
        f"/api/v1/trips/{trip['id']}/broad-routes/{route['id']}", json={"geometry": edited_geometry}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["geometry"] == edited_geometry
