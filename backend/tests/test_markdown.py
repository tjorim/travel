from collections.abc import Generator
from html.parser import HTMLParser

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.database import Base, get_session
from app.main import app
from app.markdown import markdown_text, render_markdown

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

HOSTILE = """Hello **there**

<script>alert(1)</script>

[click](javascript:alert(1)) [relative](/admin/)

<img src=x onerror=alert(1)>

<div onclick="alert(1)">raw block</div>
"""


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


class Elements(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.found: list[tuple[str, dict[str, str | None]]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.found.append((tag, dict(attrs)))


def assert_inert(html: str) -> None:
    """Only allowlisted elements, no event handlers, and only http(s) or mailto links."""
    parser = Elements()
    parser.feed(html)
    for tag, attrs in parser.found:
        assert tag not in {"script", "img", "div", "iframe", "style"}, tag
        assert not any(name.startswith("on") for name in attrs), attrs
        if "href" in attrs:
            assert attrs["href"].startswith(("http://", "https://", "mailto:")), attrs


@pytest.mark.parametrize("audience", ["owner", "public"])
def test_hostile_markdown_renders_inert(audience: str) -> None:
    html = render_markdown(HOSTILE, audience)
    assert "<strong>there</strong>" in html
    assert "&lt;script&gt;" in html
    assert_inert(html)


def test_the_supported_subset_renders_and_headings_stay_below_the_page() -> None:
    html = render_markdown(
        "# Day one\n## Morning\n### Detail\n#### Deeper\n\n*a* `b`\n\n> quote\n\n1. one\n2. two\n\n---\n\n```\nx < y\n```"
    )
    assert "<h4>Day one</h4>" in html
    assert "<h5>Morning</h5>" in html
    assert "<h6>Detail</h6>" in html
    assert "<h6>Deeper</h6>" in html
    assert "<h1" not in html and "<h2" not in html and "<h3" not in html
    for fragment in ("<em>a</em>", "<code>b</code>", "<blockquote>", "<ol>", "<hr>", "<pre><code>x &lt; y"):
        assert fragment in html


def test_a_single_line_break_stays_a_line_break() -> None:
    assert render_markdown("Phone\nEmail") == "<p>Phone<br>\nEmail</p>\n"


def test_links_open_in_a_new_tab_and_only_public_views_add_nofollow() -> None:
    owner = render_markdown("[site](https://example.com) [mail](mailto:a@example.com)", "owner")
    public = render_markdown("[site](https://example.com)", "public")
    assert 'href="https://example.com"' in owner and 'href="mailto:a@example.com"' in owner
    assert 'target="_blank"' in owner and 'rel="noopener noreferrer"' in owner
    assert 'rel="noopener noreferrer nofollow"' in public
    assert 'href="ftp://' not in render_markdown("[f](ftp://example.com/file)")


def test_images_are_not_rendered() -> None:
    assert "<img" not in render_markdown("![photo](https://example.com/p.jpg)")


def test_task_lists_render_as_disabled_checkboxes_only() -> None:
    html = render_markdown("- [ ] book train\n- [x] passport")
    assert html.count('type="checkbox"') == 2
    assert html.count('disabled="disabled"') == 2
    assert html.count('checked="checked"') == 1


def test_plain_text_preview_strips_markdown() -> None:
    assert markdown_text("# Exampleland\n\nTwo **weeks** of [trains](https://example.com)\n- `night` market") == (
        "Exampleland Two weeks of trains night market"
    )
    assert markdown_text("<script>x</script>") == "<script>x</script>"
    assert markdown_text("   ") is None
    assert render_markdown("") is None


def test_owner_responses_carry_rendered_html_next_to_the_source() -> None:
    owner = client_for("owner-1")
    trip = owner.post("/api/trips", json={"title": "Exampleland", "summary": HOSTILE}).json()
    assert trip["summary"] == HOSTILE
    assert_inert(trip["summary_html"])
    assert "<strong>there</strong>" in trip["summary_html"]

    area = owner.post(f"/api/trips/{trip['id']}/areas", json={"label": "Taipei", "country_code": "TW"}).json()
    visit = owner.post(
        f"/api/trips/{trip['id']}/visits",
        json={"area_id": area["id"], "notes": "- [ ] tickets\n- [x] hotel", "summary": "[x](https://example.com)"},
    ).json()
    assert visit["notes_html"].count('disabled="disabled"') == 2
    assert 'rel="noopener noreferrer"' in visit["summary_html"]
    assert "nofollow" not in visit["summary_html"]

    task = owner.post(
        f"/api/trips/{trip['id']}/trip-tasks", json={"title": "Pack", "notes": "- [ ] socks\n- [ ] charger"}
    )
    assert task.status_code == 201, task.text
    assert task.json()["notes_html"].count('type="checkbox"') == 2
    # A task list is display-only: it never creates trip tasks.
    assert len(owner.get(f"/api/trips/{trip['id']}/trip-tasks").json()) == 1

    update = owner.post(
        f"/api/trips/{trip['id']}/travel-updates",
        json={"occurred_at": "2054-04-04T10:00:00Z", "title": "Arrival", "body": HOSTILE, "private_notes": "*mine*"},
    ).json()
    assert_inert(update["body_html"])
    assert update["private_notes_html"] == "<p><em>mine</em></p>\n"
    assert owner.get(f"/api/trips/{trip['id']}").json()["travel_updates"][0]["body_html"] == update["body_html"]


def test_visitor_views_receive_sanitized_html_and_a_plain_text_card() -> None:
    owner = client_for("owner-1")
    trip = owner.post("/api/trips", json={"title": "Exampleland", "summary": "# Exampleland\n\n" + HOSTILE}).json()
    area = owner.post(f"/api/trips/{trip['id']}/areas", json={"label": "Taipei", "country_code": "TW"}).json()
    visit = owner.post(
        f"/api/trips/{trip['id']}/visits", json={"area_id": area["id"], "summary": HOSTILE, "notes": "secret"}
    ).json()
    update = owner.post(
        f"/api/trips/{trip['id']}/travel-updates",
        json={"occurred_at": "2054-04-04T10:00:00Z", "title": "Arrival", "body": "[a](https://example.com)"},
    ).json()
    for kind, record in (("visit", visit), ("travel_update", update)):
        assert (
            owner.put(
                f"/api/trips/{trip['id']}/visibility/{kind}/{record['id']}", json={"visibility": "everyone"}
            ).status_code
            == 200
        )
    slug = owner.post(f"/api/trips/{trip['id']}/public-projection/publish").json()["slug"]

    visitor = TestClient(app)
    document = visitor.get(f"/api/public/trips/{slug}").json()
    assert_inert(document["summary_html"])
    assert document["summary_html"].startswith("<h4>Exampleland</h4>")
    assert document["summary_text"].startswith("Exampleland Hello there")
    (shared_visit,) = document["visits"]
    assert_inert(shared_visit["summary_html"])
    assert "notes" not in shared_visit and "notes_html" not in shared_visit
    (shared_update,) = document["updates"]
    assert 'rel="noopener noreferrer nofollow"' in shared_update["body_html"]
    assert "private_notes_html" not in shared_update

    (card,) = visitor.get("/api/public/trips").json()
    assert card["summary_text"] == document["summary_text"]
    assert "summary_html" not in card

    link = owner.post(f"/api/trips/{trip['id']}/share-links", json={"label": "Family"}).json()
    preview = owner.post(f"/api/trips/{trip['id']}/share-links/{link['id']}/preview").json()
    assert preview["summary_html"] == document["summary_html"]


def test_openapi_marks_markdown_fields() -> None:
    components = app.openapi()["components"]["schemas"]
    for model, field in (
        ("TripCreate", "summary"),
        ("VisitCreate", "notes"),
        ("VisitCreate", "summary"),
        ("TravelUpdateCreate", "body"),
        ("TravelUpdateCreate", "private_notes"),
        ("StayCreate", "notes"),
        ("RouteCreate", "notes"),
        ("TripTaskCreate", "notes"),
        ("LocationInput", "notes"),
    ):
        assert components[model]["properties"][field]["description"].startswith("Markdown"), (model, field)
    assert "summary_html" in components["TripResponse"]["properties"]
