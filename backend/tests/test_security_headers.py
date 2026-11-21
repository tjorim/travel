"""Privacy and security headers, at the two layers that set them: the Caddy edge and the API's own responses.

Travel sets no blanket headers in the API: the edge (``Caddyfile.example``, mirrored by the production Caddy) adds them
for the capability-bearing ``/share/*`` shell, and the API marks each response that depends on live publication state
or carries a capability. These tests pin both so a change to either is a decision, not an accident.
"""

import re
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401  (registers every table on the metadata)
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app

CADDYFILE = Path(__file__).parents[2] / "Caddyfile.example"
SHELL = "<!doctype html><html><head><title>Travel</title></head><body></body></html>"


def edge_headers(matcher: str) -> dict[str, str]:
    """The ``header @matcher Name "value"`` lines of the Caddyfile example."""
    pattern = re.compile(rf'^\s*header @{matcher} (\S+) "([^"]*)"\s*$', re.MULTILINE)
    return dict(pattern.findall(CADDYFILE.read_text(encoding="utf-8")))


def test_the_edge_keeps_the_share_shell_out_of_caches_referrers_and_search_indexes():
    assert edge_headers("share") == {
        "Cache-Control": "no-store, private",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, noarchive",
    }


def test_the_edge_serves_the_share_shell_only_on_the_share_path():
    text = CADDYFILE.read_text(encoding="utf-8")
    assert "@share path /share/*" in text
    assert "handle @share {" in text
    assert "rewrite * /share.html" in text


@pytest.fixture
def client() -> Generator[TestClient]:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)

    def session() -> Generator[Session]:
        with Session(engine) as value:
            yield value

    app.dependency_overrides[get_session] = session
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_session, None)
        engine.dispose()


@pytest.fixture
def shell_dir(tmp_path, monkeypatch):
    (tmp_path / "public.html").write_text(SHELL, encoding="utf-8")
    monkeypatch.setattr(settings, "visitor_shell_dir", str(tmp_path))
    return tmp_path


def test_the_trip_shell_is_never_cacheable_or_sniffable(client, shell_dir):
    response = client.get("/api/public/trip-shell/aaaaaaaa")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_the_unavailable_trip_shell_keeps_its_headers_and_the_error_shape(client, monkeypatch):
    monkeypatch.setattr(settings, "visitor_shell_dir", None)
    response = client.get("/api/public/trip-shell/aaaaaaaa")
    assert response.status_code == 503
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.json()["errors"][0]["code"] == "shell_unavailable"


@pytest.mark.parametrize("path", ["/api/shared/" + "a" * 43, "/api/public/trips/" + "a" * 32])
def test_an_unknown_capability_is_not_cacheable(client, path):
    response = client.get(path)
    assert response.status_code == 404
    assert response.headers["Cache-Control"].startswith("no-store")
