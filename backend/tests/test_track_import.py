"""Synthetic files only; raw markers must never reach persistence, diagnostics or responses."""

import json

import pytest
from sqlalchemy import select
from test_routes import (  # noqa: F401
    TestingSessionLocal,
    client_for,
    create_route,
    create_trip,
    setup_function,
    teardown_function,
)

from app.models import Route, StoredObject
from app.routers.routes import track_import_limiter
from app.track_import import MAX_BYTES, approximate_line

POINTS = [[4.1234567, 50.1234567], [4.2345678, 50.2345678], [4.3456789, 50.3456789]]
MARKER = "PRIVATE-TIMESTAMP-ACCURACY-ELEVATION"
FILES = [
    json.dumps(
        {
            "_type": "locations",
            "locations": [{"_type": "location", "lon": x, "lat": y, "tst": MARKER, "acc": 7} for x, y in POINTS],
        }
    ),
    json.dumps([{"timelinePath": [{"point": f"{y}°, {x}°", "time": MARKER} for x, y in POINTS]}]),
    '<?xml version="1.0" encoding="UTF-8"?><gpx><trk><trkseg>'
    + "".join(f'<trkpt lon="{x}" lat="{y}"><time>{MARKER}</time><ele>654</ele></trkpt>' for x, y in POINTS)
    + "</trkseg></trk></gpx>",
    json.dumps({"type": "LineString", "coordinates": POINTS}),
    json.dumps({"type": "MultiLineString", "coordinates": [POINTS[:2], POINTS[1:]]}),
    json.dumps([{"longitude": x, "latitude": y, "timestamp": MARKER} for x, y in POINTS]),
    json.dumps(
        {"semanticSegments": [{"timelinePath": [{"point": f"geo:{y},{x}", "time": MARKER} for x, y in POINTS]}]}
    ),
    json.dumps({"locations": [{"longitudeE7": int(x * 1e7), "latitudeE7": int(y * 1e7)} for x, y in POINTS]}),
]


@pytest.fixture(autouse=True)
def reset_limit():
    track_import_limiter.reset()
    yield
    track_import_limiter.reset()


@pytest.mark.parametrize("source", FILES)
def test_formats_only_return_approximate_draft(source, tmp_path, caplog):
    owner = client_for("owner", tmp_path)
    trip = create_trip(owner)
    route = create_route(owner, trip["id"], geometry={"coordinates": [[1, 2], [3, 4]]})
    with TestingSessionLocal() as session:
        before = {table.name: session.execute(select(table)).all() for table in Route.metadata.sorted_tables}
    result = owner.post(
        f"/api/trips/{trip['id']}/route-line-import",
        content=source,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert result.status_code == 200, result.text
    assert result.headers["cache-control"] == "no-store"
    assert result.json() == {"type": "LineString", "coordinates": [[4.12, 50.12], [4.23, 50.23], [4.35, 50.35]]}
    assert MARKER not in result.text + caplog.text
    assert "1234567" not in result.text + caplog.text
    assert owner.get(f"/api/trips/{trip['id']}/routes/{route['id']}").json() == route
    with TestingSessionLocal() as session:
        assert {table.name: session.execute(select(table)).all() for table in Route.metadata.sorted_tables} == before
        assert session.scalars(select(StoredObject)).all() == []
    assert list(tmp_path.rglob("*")) == []


@pytest.mark.parametrize(
    "source",
    [
        MARKER,
        '{"type":"LineString","coordinates":["12","34"]}',
        '<!DOCTYPE gpx [<!ENTITY secret SYSTEM "file:///etc/passwd">]><gpx>&secret;</gpx>',
        '<gpx><trkpt lon="NaN" lat="50"/></gpx>',
        "<gpx><bad>",
        "[" * 1000 + MARKER,
        '{"type":"Point","coordinates":[1,2]}',
        json.dumps({"type": "LineString", "coordinates": [[1, 2], [True, 3]]}),
        json.dumps([{"longitude": 1, "latitude": 2}] * 20_001),
    ],
)
def test_hostile_failure_no_persistence_or_diagnostics(source, tmp_path, caplog):
    owner = client_for("owner", tmp_path)
    trip = create_trip(owner)
    route = create_route(owner, trip["id"], geometry={"coordinates": [[1, 2], [3, 4]]})
    result = owner.post(
        f"/api/trips/{trip['id']}/route-line-import",
        content=source,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert result.status_code == 422
    assert result.json()["errors"][0]["code"] == "track_import_invalid"
    assert MARKER not in result.text + caplog.text
    assert "file:///" not in result.text + caplog.text
    assert list(tmp_path.rglob("*")) == []
    with TestingSessionLocal() as session:
        assert session.get(Route, route["id"]).geometry == {"type": "LineString", "coordinates": [[1, 2], [3, 4]]}
        assert session.scalars(select(StoredObject)).all() == []


def test_body_limit_multipart_ownership_and_rate(tmp_path):
    owner = client_for("owner", tmp_path)
    trip = create_trip(owner)
    path = f"/api/trips/{trip['id']}/route-line-import"
    assert owner.post(path, files={"file": ("track.gpx", FILES[0])}).status_code == 415
    assert (
        owner.post(
            path, content=b"x" * (MAX_BYTES + 1), headers={"Content-Type": "application/octet-stream"}
        ).status_code
        == 413
    )
    for _ in range(4):
        assert owner.post(path, content=b"bad", headers={"Content-Type": "application/octet-stream"}).status_code == 422
    blocked = owner.post(path, content=b"bad", headers={"Content-Type": "application/octet-stream"})
    assert blocked.status_code == 429
    assert blocked.headers["Retry-After"]
    other = client_for("other", tmp_path)
    assert other.post(path, content=FILES[0], headers={"Content-Type": "application/octet-stream"}).status_code == 404


def test_selection_simplification_and_cap():
    points = [[i / 100, 1] for i in range(15_000)]
    data = bytearray(json.dumps({"type": "LineString", "coordinates": points}).encode())
    result = approximate_line(data, 25, 75)
    assert 2 <= len(result.coordinates) <= 500
    assert result.coordinates[0] == (37.49, 1)
    assert result.coordinates[-1] == (112.49, 1)
    for pair in result.coordinates:
        assert all(round(value, 2) == value for value in pair)


def test_admission_before_body_or_multipart_parser(tmp_path, monkeypatch):
    from starlette.requests import Request

    owner = client_for("owner", tmp_path)
    trip = create_trip(owner)
    path = f"/api/trips/{trip['id']}/route-line-import"

    async def forbidden(*args, **kwargs):
        raise AssertionError("Raw body must not be read or spooled")
        yield  # make this an async iterator like stream

    monkeypatch.setattr(Request, "stream", forbidden)
    assert owner.post(path, files={"file": ("secret.gpx", FILES[0])}).status_code == 415
    for _ in range(5):
        # Every rejected multipart attempt counts, without consuming its body.
        assert owner.post(path, files={"file": ("secret.gpx", FILES[0])}).status_code == 415
    assert owner.post(path, content=FILES[0], headers={"Content-Type": "application/octet-stream"}).status_code == 429
    other = client_for("other", tmp_path)
    assert other.post(path, content=FILES[0], headers={"Content-Type": "application/octet-stream"}).status_code == 404


def test_chunked_limit_and_normal_save_export(tmp_path):
    owner = client_for("owner", tmp_path)
    trip = create_trip(owner)
    path = f"/api/trips/{trip['id']}/route-line-import"
    headers = {"Content-Type": "application/octet-stream"}
    result = owner.post(path, content=iter([b"x" * (MAX_BYTES // 2)] * 3), headers=headers)
    assert result.status_code == 413
    draft = owner.post(path, content=FILES[0], headers=headers).json()
    route = create_route(owner, trip["id"], geometry=draft)
    assert route["geometry"] == draft
    exported = owner.get(f"/api/trips/{trip['id']}/export")
    assert exported.status_code == 200
    assert MARKER not in exported.text
    assert "1234567" not in exported.text
    assert exported.json()["routes"][0]["geometry"] == draft
