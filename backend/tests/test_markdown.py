import io
from collections.abc import Generator
from html.parser import HTMLParser
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.database import Base, get_session
from app.main import app
from app.markdown import _TAGS, _clean, markdown_text, render_contact, render_inline, render_markdown
from app.storage import LocalObjectStorage, get_storage

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


def assert_inert(html: str, schemes: tuple[str, ...] = ("http://", "https://", "mailto:")) -> None:
    """Only allowlisted elements, no event handlers, and only http(s) or mailto links."""
    parser = Elements()
    parser.feed(html)
    for tag, attrs in parser.found:
        assert tag not in {"script", "img", "div", "iframe", "style"}, tag
        assert not any(name.startswith("on") for name in attrs), attrs
        if "href" in attrs:
            assert attrs["href"].startswith(schemes), attrs


def tags_in(html: str) -> set[str]:
    parser = Elements()
    parser.feed(html)
    return {tag for tag, _ in parser.found}


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
        ("EmergencyInfoEntryCreate", "notes"),
        ("EmergencyInfoEntryUpdate", "notes"),
    ):
        assert components[model]["properties"][field]["description"].startswith("Markdown"), (model, field)
    caption = components["MediaDerivativePresentationUpdate"]["properties"]["caption"]["description"]
    assert caption.startswith("Inline Markdown only")
    for model in ("StayCreate", "StayUpdate"):
        assert components[model]["properties"]["contact_details"]["description"].startswith("Plain text, not Markdown")
    for model, field in (
        ("StayResponse", "contact_details_html"),
        ("MediaDerivativeResponse", "caption_html"),
        ("EmergencyInfoEntryResponse", "notes_html"),
        ("EmergencyInfoEntryResponse", "notes_text"),
    ):
        assert field in components[model]["properties"], (model, field)
    assert "summary_html" in components["TripResponse"]["properties"]


def test_tables_render_with_alignment_as_their_only_style() -> None:
    html = render_markdown(
        '| Day | Place |\n|:--|--:|\n| 1 | **Taipei** |\n| 2 | <b onclick="x">Tainan</b> |',
    )
    assert {"table", "thead", "tbody", "tr", "th", "td", "strong"} <= tags_in(html)
    assert 'style="text-align:right"' in html
    assert "&lt;b onclick" in html and "<b " not in html
    assert_inert(html)
    assert markdown_text("| Day | Place |\n|--|--|\n| 1 | Taipei |") == "Day Place 1 Taipei"
    # A style other than a column's alignment never survives.
    sanitized = _clean('<table><tr><td style="color:red;text-align:left">b</td></tr></table>', _TAGS, "public")
    assert 'style="text-align:left"' in sanitized


@pytest.mark.parametrize("audience", ["owner", "public"])
def test_hostile_captions_render_inert_and_inline_only(audience: str) -> None:
    html = render_inline(HOSTILE, audience)
    assert "<strong>there</strong>" in html
    assert "&lt;script&gt;" in html
    assert 'href="javascript' not in html
    assert_inert(html)
    assert tags_in(html) <= {"strong", "em", "a"}


def test_captions_keep_bold_italic_and_links_and_drop_every_block() -> None:
    html = render_inline("**Bold** _italic_ [site](https://example.com)")
    assert html == (
        '<strong>Bold</strong> <em>italic</em> <a href="https://example.com" target="_blank" '
        'rel="noopener noreferrer nofollow">site</a>'
    )
    blocks = render_inline(
        "# Title\n\n- one\n> quote\n\n| a |\n|--|\n| b |\n\n```\ncode\n```\n\n---\n![p](https://x/p.jpg)"
    )
    # An image is at most a link to it, never an image.
    assert tags_in(blocks) <= {"a"}, blocks
    assert "Title" in blocks and "- one" in blocks
    assert markdown_text("**Bold** [site](https://example.com)", "inline") == "Bold site"
    assert render_inline("  ") is None


def test_contact_details_link_phone_numbers_and_addresses_and_keep_line_breaks() -> None:
    html = render_contact(
        "Front desk: +886 2 1234 5678\nMail desk@example.com\nhttps://example.com/stay.\nRoom 12345678, 2054-04-01"
    )
    assert '<a href="tel:+886212345678"' in html
    assert '<a href="mailto:desk@example.com"' in html
    assert '<a href="https://example.com/stay"' in html and "stay</a>." in html
    assert html.count("<br>") == 3
    # A room number without a trunk prefix and a date are never numbers to call.
    assert html.count("tel:") == 1
    assert render_contact("04/05/2054 or 0470 12 34 56").count("tel:") == 1
    assert 'href="tel:+3231234567"' in render_contact("+32 (0)3 123 45 67")
    # Markdown is not rendered: this field is plain text.
    assert "<strong>" not in render_contact("**Reception**")


@pytest.mark.parametrize("audience", ["owner", "public"])
def test_hostile_contact_details_render_inert(audience: str) -> None:
    html = render_contact(HOSTILE + "\n+32 470 12 34 56 javascript:alert(1)", audience)
    assert "&lt;script&gt;" in html and "&lt;img" in html and "&lt;div onclick" in html
    assert "[click](javascript:alert(1))" in html
    assert_inert(html, ("http://", "https://", "mailto:", "tel:"))
    assert tags_in(html) <= {"p", "br", "a"}


def test_stay_contact_details_and_emergency_notes_carry_rendered_html() -> None:
    owner = client_for("owner-1")
    trip = owner.post("/api/trips", json={"title": "Exampleland"}).json()
    stay = owner.post(
        f"/api/trips/{trip['id']}/stays",
        json={
            "property_name": "Hotel",
            "check_in_date": "2054-04-01",
            "check_out_date": "2054-04-03",
            "location": {"display_name": "Hotel, Taipei", "locality": "Taipei", "country_code": "TW"},
            "contact_details": "+886 2 1234 5678\n<script>x</script>",
        },
    )
    assert stay.status_code == 201, stay.text
    stay = stay.json()
    assert '<a href="tel:+886212345678"' in stay["contact_details_html"]
    assert_inert(stay["contact_details_html"], ("tel:",))

    entry = owner.post(
        "/api/library/emergency-info",
        json={"kind": "contact", "label": "Mom", "value": "+32 470 00 00 00", "notes": "# Call\n\n" + HOSTILE},
    )
    assert entry.status_code == 201, entry.text
    entry = entry.json()
    assert_inert(entry["notes_html"])
    assert entry["notes_html"].startswith("<h4>Call</h4>")
    assert entry["notes_text"].startswith("Call Hello there")
    assert "\n" not in entry["notes_text"]


def test_captions_render_inline_for_the_owner_and_visitors(tmp_path: Path) -> None:
    owner = client_for("owner-1")
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    trip = owner.post("/api/trips", json={"title": "Exampleland"}).json()
    update = owner.post(
        f"/api/trips/{trip['id']}/travel-updates",
        json={"occurred_at": "2054-04-04T10:00:00Z", "title": "Arrival", "body": "Landed"},
    ).json()
    image = io.BytesIO()
    Image.new("RGB", (40, 30), (20, 30, 40)).save(image, format="JPEG")
    asset = owner.post(
        f"/api/trips/{trip['id']}/media/uploads", files={"file": ("p.jpg", image.getvalue(), "image/jpeg")}
    ).json()
    base = f"/api/trips/{trip['id']}/media/{asset['id']}/derivatives"
    derivative = owner.post(base, json={"purpose": "share"}).json()
    owner.post(f"{base}/{derivative['id']}/approve")
    caption = "**Night** market\n\n- [x] <img src=x onerror=alert(1)> [a](javascript:alert(1))"
    presented = owner.patch(
        f"{base}/{derivative['id']}/presentation", json={"travel_update_id": update["id"], "caption": caption}
    )
    assert presented.status_code == 200, presented.text
    assert presented.json()["caption_html"].startswith("<strong>Night</strong> market")
    assert tags_in(presented.json()["caption_html"]) == {"strong"}

    owner.put(f"/api/trips/{trip['id']}/visibility/travel_update/{update['id']}", json={"visibility": "everyone"})
    slug = owner.post(f"/api/trips/{trip['id']}/public-projection/publish").json()["slug"]
    (media,) = TestClient(app).get(f"/api/public/trips/{slug}").json()["media"]
    assert media["caption"] == caption
    assert_inert(media["caption_html"])
    assert tags_in(media["caption_html"]) == {"strong"}


def test_the_preview_endpoint_uses_the_stored_renderer_and_requires_an_owner() -> None:
    assert TestClient(app).post("/api/markdown/render", json={"source": "x"}).status_code == 401
    owner = client_for("owner-1")
    for source, format, expected in (
        (HOSTILE, "markdown", render_markdown(HOSTILE, "owner")),
        ("| a |\n|--|\n| b |", "markdown", render_markdown("| a |\n|--|\n| b |", "owner")),
        (HOSTILE, "inline", render_inline(HOSTILE, "owner")),
        ("+32 470 12 34 56", "contact", render_contact("+32 470 12 34 56")),
    ):
        response = owner.post("/api/markdown/render", json={"source": source, "format": format})
        assert response.status_code == 200, response.text
        assert response.json()["html"] == expected
    assert owner.post("/api/markdown/render", json={"source": "# A\n**b**"}).json()["text"] == "A b"
    assert owner.post("/api/markdown/render", json={"source": " "}).json() == {"html": None, "text": None}
    assert owner.post("/api/markdown/render", json={"source": "x", "format": "html"}).status_code == 422
    assert owner.post("/api/markdown/render", json={"source": "x" * 10001}).status_code == 422
