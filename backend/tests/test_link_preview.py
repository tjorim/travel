"""Trip-specific link-preview metadata on the public shell (#245)."""

import io
import re
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.config import settings
from app.database import Base, get_session
from app.main import app
from app.storage import LocalObjectStorage, get_storage

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

# A stand-in for the built frontend/public.html: the generic, data-free shell.
SHELL = """<!doctype html>
<html lang="nl">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="Privé, bewuste reisverhalen." />
    <meta name="referrer" content="no-referrer" />
    <meta name="robots" content="noindex, noarchive" />
    <meta property="og:site_name" content="Travel" />
    <meta property="og:title" content="Travel · Op reis" />
    <meta property="og:description" content="Privé, bewuste reisverhalen." />
    <meta property="og:image" content="https://travel.example.test/admin/link-preview.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Travel" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Travel · Op reis" />
    <meta name="twitter:description" content="Privé, bewuste reisverhalen." />
    <meta name="twitter:image" content="https://travel.example.test/admin/link-preview.png" />
    <meta name="twitter:image:alt" content="Travel" />
    <title>Reis · Travel</title>
  </head>
  <body><div id="root"></div></body>
</html>
"""
ORIGIN = "https://travel.example.test"
PRIVATE = "Secret-Hotel-Amsterdam-4421"


def override_session() -> Generator[Session]:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Generator[None]:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    (tmp_path / "shell").mkdir()
    (tmp_path / "shell" / "public.html").write_text(SHELL, encoding="utf-8")
    monkeypatch.setattr(settings, "visitor_shell_dir", str(tmp_path / "shell"))
    monkeypatch.setattr(settings, "public_app_url", ORIGIN)
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[current_subject] = lambda: "owner-1"
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path / "media"))
    yield
    app.dependency_overrides.clear()


def scope(*items: dict, title: bool = True, summary: bool = True) -> dict:
    return {
        "schema_version": "travel/share-scope@1",
        "trip": {"title": title, "summary": summary},
        "defaults": None,
        "items": list(items),
    }


def make_trip(owner: TestClient, title: str = "Exampleland 2054", summary: str | None = "A calm week.") -> dict:
    response = owner.post("/api/trips", json={"title": title, "summary": summary})
    assert response.status_code == 201, response.text
    return response.json()


def publish(owner: TestClient, trip_id: str, selected: dict | None = None) -> str:
    base = f"/api/trips/{trip_id}/public-projection"
    assert owner.put(base, json=selected or scope()).status_code == 200
    assert owner.post(f"{base}/publish").status_code == 200
    return owner.get(base).json()["slug"]


def photo(owner: TestClient, trip_id: str, alt_text: str | None = None) -> dict:
    data = io.BytesIO()
    Image.new("RGB", (40, 30), (20, 30, 40)).save(data, format="JPEG")
    path = f"/api/trips/{trip_id}/media"
    media = owner.post(f"{path}/uploads", files={"file": ("a.jpg", data.getvalue(), "image/jpeg")}).json()
    derivative = owner.post(f"{path}/{media['id']}/derivatives", json={"purpose": "share"}).json()
    owner.post(f"{path}/{media['id']}/derivatives/{derivative['id']}/approve")
    if alt_text:
        owner.patch(f"{path}/{media['id']}/derivatives/{derivative['id']}/presentation", json={"alt_text": alt_text})
    return {
        "id": derivative["id"],
        "private": f"{path}/{media['id']}/derivatives/{derivative['id']}",
        "visibility": f"/api/trips/{trip_id}/visibility/media_derivative/{derivative['id']}",
    }


def tags(document: str) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for tag in re.findall(r"<meta\b[^>]*>", document):
        key = re.search(r'(?:name|property)="([^"]+)"', tag)
        content = re.search(r'content="([^"]*)"', tag)
        if key and content:
            found.setdefault(key.group(1), []).append(content.group(1))
    return found


GENERIC = tags(SHELL)


def fetch(slug: str):
    return TestClient(app).get(f"/api/public/trip-shell/{slug}")


def assert_generic(response) -> None:
    assert response.status_code == 200
    assert response.text == SHELL


def test_published_trip_shows_its_shared_title_and_summary() -> None:
    owner = TestClient(app)
    slug = publish(owner, make_trip(owner)["id"])
    response = fetch(slug)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    meta = tags(response.text)
    assert "<title>Exampleland 2054 · Travel</title>" in response.text
    assert meta["og:title"] == ["Exampleland 2054 · Travel"]
    assert meta["twitter:title"] == ["Exampleland 2054 · Travel"]
    for key in ("description", "og:description", "twitter:description"):
        assert meta[key] == ["A calm week."]
    assert meta["og:url"] == [f"{ORIGIN}/trips/{slug}"]
    # No cover is shared, so the generic brand image stays and nothing is duplicated.
    assert meta["og:image"] == GENERIC["og:image"]
    assert meta["twitter:image"] == GENERIC["twitter:image"]
    # Everything else in the shell is untouched, including indexing and referrer policy.
    for key in ("robots", "referrer", "og:site_name", "twitter:card"):
        assert meta[key] == GENERIC[key]
    assert response.text.count("<title>") == 1
    assert all(len(values) == 1 for values in meta.values())


def test_unshared_title_and_summary_keep_the_generic_values() -> None:
    owner = TestClient(app)
    trip = make_trip(owner, title=f"Trip to {PRIVATE}", summary=f"Staying at {PRIVATE}.")
    slug = publish(owner, trip["id"], scope(title=False, summary=False))
    assert_generic_except_url(fetch(slug), slug)

    owner.put(f"/api/trips/{trip['id']}/public-projection", json=scope(title=True, summary=False))
    response = fetch(slug)
    assert f"Trip to {PRIVATE} · Travel" in response.text
    assert PRIVATE not in str(tags(response.text)["og:description"])
    assert tags(response.text)["og:description"] == GENERIC["og:description"]

    owner.put(f"/api/trips/{trip['id']}/public-projection", json=scope(title=False, summary=True))
    response = fetch(slug)
    assert "<title>Reis · Travel</title>" in response.text
    assert tags(response.text)["og:title"] == GENERIC["og:title"]
    assert tags(response.text)["og:description"] == [f"Staying at {PRIVATE}."]


def assert_generic_except_url(response, slug: str) -> None:
    assert response.status_code == 200
    assert response.text.replace(f'<meta property="og:url" content="{ORIGIN}/trips/{slug}" />\n    ', "") == SHELL


def test_a_missing_summary_keeps_the_generic_description() -> None:
    owner = TestClient(app)
    slug = publish(owner, make_trip(owner, summary=None)["id"])
    assert tags(fetch(slug).text)["og:description"] == GENERIC["og:description"]


def test_unknown_malformed_unpublished_and_revoked_slugs_are_generic_and_identical() -> None:
    owner = TestClient(app)
    trip = make_trip(owner, title=f"Trip to {PRIVATE}")
    slug = publish(owner, trip["id"])
    assert PRIVATE in fetch(slug).text
    owner.post(f"/api/trips/{trip['id']}/public-projection/unpublish")
    unpublished = fetch(slug)
    assert_generic(unpublished)

    draft = make_trip(owner, title=f"Draft {PRIVATE}")
    owner.put(f"/api/trips/{draft['id']}/public-projection", json=scope())
    draft_slug = owner.get(f"/api/trips/{draft['id']}/public-projection").json()["slug"]
    responses = [
        unpublished,
        fetch(draft_slug),
        fetch("unknownslug"),
        fetch("bad.slug"),
        fetch("x" * 33),
        fetch("a%00b"),
    ]
    for response in responses:
        assert_generic(response)
        assert response.headers["cache-control"] == unpublished.headers["cache-control"]
        assert response.headers["content-type"] == unpublished.headers["content-type"]
    assert {response.text for response in responses} == {SHELL}


def test_unpublishing_is_visible_on_the_next_request() -> None:
    owner = TestClient(app)
    trip = make_trip(owner)
    slug = publish(owner, trip["id"])
    first = fetch(slug)
    assert "Exampleland 2054" in first.text
    owner.post(f"/api/trips/{trip['id']}/public-projection/unpublish")
    assert_generic(fetch(slug))
    owner.post(f"/api/trips/{trip['id']}/public-projection/publish")
    assert "Exampleland 2054" in fetch(slug).text


def test_responses_are_never_cacheable() -> None:
    owner = TestClient(app)
    slug = publish(owner, make_trip(owner)["id"])
    for response in (fetch(slug), fetch("unknownslug"), fetch("bad.slug")):
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert "etag" not in response.headers
        assert "last-modified" not in response.headers
        assert "set-cookie" not in response.headers


def test_output_is_escaped_and_length_limited() -> None:
    owner = TestClient(app)
    title = '<script>alert(1)</script> "Quotes" & more'
    trip = make_trip(owner, title=title, summary='Say "hi" <b>& bye</b>\n\nsecond\tline')
    slug = publish(owner, trip["id"])
    document = fetch(slug).text
    assert "<script>" not in document
    assert "<b>" not in document
    assert "&lt;script&gt;alert(1)&lt;/script&gt; &quot;Quotes&quot; &amp; more · Travel" in document
    assert '<title>&lt;script&gt;alert(1)&lt;/script&gt; "Quotes" &amp; more · Travel</title>' in document
    # The head still parses as the same set of tags: no attribute was broken out of.
    assert set(tags(document)) >= set(GENERIC)
    description = tags(document)["og:description"][0]
    assert "\n" not in description
    assert "&amp;" in description

    long_trip = make_trip(owner, title="T" * 160, summary="word " * 200)
    long_slug = publish(owner, long_trip["id"])
    long_meta = tags(fetch(long_slug).text)
    assert len(long_meta["og:title"][0]) <= 70 + len(" · Travel")
    assert long_meta["og:title"][0].startswith("T" * 60)
    assert len(long_meta["og:description"][0]) <= 200
    assert long_meta["og:description"][0].endswith("…")


def test_cover_is_the_scoped_public_file_route_only_when_the_public_already_receives_it() -> None:
    owner = TestClient(app)
    trip = make_trip(owner)
    other = photo(owner, trip["id"])
    cover = photo(owner, trip["id"], alt_text="Harbour at dusk")
    owner.patch(f"/api/trips/{trip['id']}", json={"cover_derivative_id": cover["id"]})
    slug = publish(owner, trip["id"])

    # Choosing a cover does not publish it: the photo is still private.
    assert tags(fetch(slug).text)["og:image"] == GENERIC["og:image"]
    assert cover["id"] not in fetch(slug).text

    owner.put(cover["visibility"], json={"visibility": "everyone"})
    public = TestClient(app).get(f"/api/public/trips/{slug}").json()
    expected = f"{ORIGIN}/api/public/trips/{slug}/files/{public['cover']}"
    meta = tags(fetch(slug).text)
    assert meta["og:image"] == [expected]
    assert meta["twitter:image"] == [expected]
    assert meta["og:image:alt"] == meta["twitter:image:alt"] == ["Harbour at dusk"]
    assert meta["og:image:width"] == ["40"]
    assert meta["og:image:height"] == ["30"]
    assert "og:image:type" not in meta
    assert all(len(values) == 1 for values in meta.values())
    # The advertised URL really is a file the public audience can fetch, and it is the projection-local id,
    # never a canonical derivative or media id, an owner route or an object key.
    assert TestClient(app).get(f"/api/public/trips/{slug}/files/{public['cover']}").status_code == 200
    assert cover["id"] not in fetch(slug).text
    assert "/api/trips/" not in fetch(slug).text

    # Moving the cover to a private photo, or withdrawing the shared one, drops the image again.
    owner.patch(f"/api/trips/{trip['id']}", json={"cover_derivative_id": other["id"]})
    assert tags(fetch(slug).text)["og:image"] == GENERIC["og:image"]
    owner.patch(f"/api/trips/{trip['id']}", json={"cover_derivative_id": cover["id"]})
    assert tags(fetch(slug).text)["og:image"] == [expected]
    owner.put(cover["visibility"], json={"visibility": "private"})
    withdrawn = fetch(slug).text
    assert tags(withdrawn)["og:image"] == GENERIC["og:image"]
    assert "og:image:alt" in tags(withdrawn) and tags(withdrawn)["og:image:alt"] == GENERIC["og:image:alt"]
    assert "/files/" not in withdrawn


def test_cover_alt_falls_back_to_the_shared_title_then_the_brand() -> None:
    owner = TestClient(app)
    trip = make_trip(owner)
    cover = photo(owner, trip["id"])
    owner.patch(f"/api/trips/{trip['id']}", json={"cover_derivative_id": cover["id"]})
    owner.put(cover["visibility"], json={"visibility": "everyone"})
    slug = publish(owner, trip["id"])
    assert tags(fetch(slug).text)["og:image:alt"] == ["Exampleland 2054"]
    owner.put(f"/api/trips/{trip['id']}/public-projection", json=scope(title=False))
    assert tags(fetch(slug).text)["og:image:alt"] == ["Travel"]


def test_no_private_value_reaches_the_preview() -> None:
    owner = TestClient(app)
    trip = make_trip(owner, title="Public title", summary="Public line.")
    area = owner.post(f"/api/trips/{trip['id']}/areas", json={"label": PRIVATE, "country_code": "TW"}).json()
    owner.post(
        f"/api/trips/{trip['id']}/visits",
        json={"title": PRIVATE, "area_id": area["id"], "notes": PRIVATE},
    )
    owner.post(
        f"/api/trips/{trip['id']}/travel-updates",
        json={
            "occurred_at": "2054-04-04T10:00:00Z",
            "date_precision": "day",
            "title": PRIVATE,
            "body": PRIVATE,
            "visibility": "private",
        },
    )
    private_photo = photo(owner, trip["id"], alt_text=PRIVATE)
    owner.patch(f"/api/trips/{trip['id']}", json={"cover_derivative_id": private_photo["id"]})
    slug = publish(owner, trip["id"])
    document = fetch(slug).text
    assert PRIVATE not in document
    assert private_photo["id"] not in document
    assert trip["id"] not in document
    assert "owner-1" not in document


def test_hidden_links_keep_the_generic_shell_through_the_api_route() -> None:
    owner = TestClient(app)
    trip = make_trip(owner, title=f"Trip to {PRIVATE}", summary=f"At {PRIVATE}")
    link = owner.post(f"/api/trips/{trip['id']}/share-links", json={"label": "Family", "scope": scope()}).json()
    owner.post(f"/api/trips/{trip['id']}/share-links/{link['id']}/preview")
    token = owner.post(
        f"/api/trips/{trip['id']}/share-links/{link['id']}/activate", json={"expires_in_days": 30}
    ).json()["token"]
    assert TestClient(app).get(f"/api/shared/{token}").status_code == 200
    # A capability is not a slug: even if one is offered to the public preview route it yields the generic shell.
    assert_generic(fetch(token))


def test_a_missing_shell_is_a_service_error_never_a_trip_specific_page(monkeypatch: pytest.MonkeyPatch) -> None:
    owner = TestClient(app)
    slug = publish(owner, make_trip(owner)["id"])
    monkeypatch.setattr(settings, "visitor_shell_dir", None)
    response = fetch(slug)
    assert response.status_code == 503
    assert response.headers["cache-control"] == "no-store"
    assert "Exampleland" not in response.text


def test_the_real_public_shell_carries_every_tag_the_preview_rewrites(monkeypatch: pytest.MonkeyPatch) -> None:
    # Guards against drift: a renamed or removed tag in frontend/public.html must fail here, not silently in production.
    source = Path(__file__).parents[2] / "frontend"
    monkeypatch.setattr(settings, "visitor_shell_dir", str(source))
    generic = tags((source / "public.html").read_text(encoding="utf-8"))
    for key in ("description", "og:title", "og:description", "og:image", "twitter:title", "twitter:image", "robots"):
        assert len(generic[key]) == 1, key
    owner = TestClient(app)
    trip = make_trip(owner)
    cover = photo(owner, trip["id"])
    owner.patch(f"/api/trips/{trip['id']}", json={"cover_derivative_id": cover["id"]})
    owner.put(cover["visibility"], json={"visibility": "everyone"})
    slug = publish(owner, trip["id"])
    rendered = fetch(slug).text
    meta = tags(rendered)
    assert all(len(values) == 1 for values in meta.values())
    assert meta["og:title"] == ["Exampleland 2054 · Travel"]
    assert "/api/public/trips/" in meta["og:image"][0] and "link-preview.png" not in rendered
    assert meta["robots"] == generic["robots"]
    assert rendered.count("<title>") == 1 and '<script type="module"' in rendered
