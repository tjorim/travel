"""Anonymous delivery rejects malformed paths before touching SQL or hashing tokens."""

import os
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.database import get_session
from app.main import app
from app.routers.publication import UNLISTED_HEADERS


@pytest.fixture(params=["sqlite", "postgres"])
def delivery_client(request) -> Generator[TestClient]:
    url = "sqlite://"
    if request.param == "postgres":
        url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
        if not url:
            pytest.skip("local PostgreSQL test URL not configured")
    engine = create_engine(url)
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT 1").scalar_one() == 1

    def reject_query(*_args):
        pytest.fail("Malformed delivery path reached the database")

    event.listen(engine, "before_cursor_execute", reject_query)

    def session():
        with Session(engine) as value:
            yield value

    app.dependency_overrides[get_session] = session
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


PATHS = [
    "/public/trips/{bad}",
    "/public/trips/{bad}/files/document-123456789abc",
    "/public/trips/{bad}/navigation/location-123456789abc",
    "/public/trips/" + "a" * 32 + "/files/{bad}",
    "/public/trips/" + "a" * 32 + "/navigation/{bad}",
    "/shared/{bad}",
    "/shared/{bad}/files/document-123456789abc",
    "/shared/{bad}/navigation/location-123456789abc",
    "/shared/" + "a" * 43 + "/files/{bad}",
    "/shared/" + "a" * 43 + "/navigation/{bad}",
]


@pytest.mark.parametrize("path", PATHS)
@pytest.mark.parametrize("bad", ["probe%00value", "x" * 1000, "probe%FFvalue", "probe%C3%28value", "probe%20value"])
def test_malformed_delivery_paths(delivery_client, path, bad, caplog):
    response = delivery_client.get("/api" + path.format(bad=bad), follow_redirects=False)
    assert response.status_code == 404
    assert response.json()["errors"] == [{"code": "not_found", "params": {}, "path": []}]
    # Shared routes keep their existing indistinguishable not-found text.
    allowed = {"Link not found", "File not found"} if path.startswith("/shared/") else {"Not found"}
    assert response.json()["detail"] in allowed
    headers = UNLISTED_HEADERS if path.startswith("/shared/") else {"Cache-Control": "no-store"}
    for name, value in headers.items():
        assert response.headers[name] == value
    # The HTTP client's own request log necessarily contains the URL; application
    # diagnostics must not echo a rejected path or produce a database traceback.
    assert not [record for record in caplog.records if record.name.startswith("app")]


@pytest.mark.parametrize("path", PATHS)
def test_delivery_path_length_bounds(delivery_client, path):
    # The bound depends on which placeholder is under test, not the route family.
    limit = 80 if path.endswith(("/files/{bad}", "/navigation/{bad}")) else 43 if path.startswith("/shared/") else 32
    response = delivery_client.get("/api" + path.format(bad="a" * (limit + 1)))
    assert response.status_code == 404
    assert response.headers["Cache-Control"].startswith("no-store")
