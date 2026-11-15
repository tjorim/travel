"""Authored text in Dutch and English with fallback (#376): storage, the plain field name, the visitor's language."""

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import schemas
from app.atom import atom_document
from app.auth import current_subject
from app.config import settings
from app.content_language import ContentLanguage, pick, resolve
from app.database import Base, get_session
from app.main import app
from app.mcp_server import TravelMcpBackend
from app.models import Area, MediaDerivative, Trip, Visibility

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def override_session() -> Generator[Session]:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def setup_function() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[current_subject] = lambda: "owner-1"


def teardown_function() -> None:
    app.dependency_overrides.clear()


@pytest.fixture
def owner() -> TestClient:
    return TestClient(app)


def new_trip(owner: TestClient, **fields) -> dict:
    named = any(key.startswith("title") for key in fields)
    response = owner.post("/api/trips", json=({} if named else {"title": "Rondreis"}) | fields)
    assert response.status_code == 201, response.text
    return response.json()


def base(trip: dict) -> str:
    return f"/api/trips/{trip['id']}"


# --- the rule ------------------------------------------------------------------------


def test_one_rule_resolves_a_text_the_requested_language_then_the_other_then_nothing() -> None:
    assert pick("Hallo", "Hello", "nl") == ("Hallo", ContentLanguage.NL)
    assert pick("Hallo", "Hello", "en") == ("Hello", ContentLanguage.EN)
    assert pick("Hallo", None, "en") == ("Hallo", ContentLanguage.NL)
    assert pick(None, "Hello", "nl") == ("Hello", ContentLanguage.EN)
    # A cleared language is empty, never an empty text.
    assert pick("", "Hello", "nl") == ("Hello", ContentLanguage.EN)
    assert pick(None, None, "nl") == (None, None)
    assert resolve("Hallo", "Hello", "en") == "Hello"


# --- the owner API -------------------------------------------------------------------


def test_a_trip_has_a_content_language_and_the_plain_field_is_a_write_to_it(owner: TestClient) -> None:
    dutch = new_trip(owner, summary="Kort")
    assert (dutch["content_language"], dutch["title"], dutch["title_nl"], dutch["title_en"]) == (
        "nl",
        "Rondreis",
        "Rondreis",
        None,
    )
    assert (dutch["summary_nl"], dutch["summary_en"]) == ("Kort", None)

    english = new_trip(owner, title="Round trip", content_language="en")
    assert (english["content_language"], english["title"], english["title_nl"], english["title_en"]) == (
        "en",
        "Round trip",
        None,
        "Round trip",
    )


def test_both_languages_can_be_written_and_the_plain_name_falls_back_to_the_other(owner: TestClient) -> None:
    trip = owner.post("/api/trips", json={"title_en": "Round trip", "summary_nl": "Kort"}).json()
    # The content language (Dutch) has no title, so the plain name reads the English one.
    assert (trip["content_language"], trip["title"], trip["title_nl"], trip["title_en"]) == (
        "nl",
        "Round trip",
        None,
        "Round trip",
    )
    assert (trip["summary"], trip["summary_html"]) == ("Kort", "<p>Kort</p>\n")

    updated = owner.patch(base(trip), json={"title_nl": "Rondreis"}).json()
    assert (updated["title"], updated["title_nl"], updated["title_en"]) == ("Rondreis", "Rondreis", "Round trip")
    assert owner.get(base(trip)).json()["title_en"] == "Round trip"


def test_a_plain_write_next_to_the_same_language_with_other_text_is_refused(owner: TestClient) -> None:
    trip = new_trip(owner)
    conflict = owner.patch(base(trip), json={"title": "Reis", "title_nl": "Rondreis"})
    assert conflict.status_code == 422
    assert conflict.json()["errors"][0]["code"] == "localized_text_conflict"
    assert owner.get(base(trip)).json()["title"] == "Rondreis"
    # The same text twice is not a conflict, and the other language never conflicts.
    assert owner.patch(base(trip), json={"title": "Reis", "title_nl": "Reis", "title_en": "Trip"}).status_code == 200


def test_a_record_read_can_be_sent_back_unchanged(owner: TestClient) -> None:
    trip = owner.post("/api/trips", json={"title_en": "Round trip"}).json()
    # `title` reads the English text because Dutch is empty; echoing it must not copy it into Dutch.
    echoed = owner.patch(
        base(trip), json={key: trip[key] for key in ("title", "title_nl", "title_en", "summary", "summary_nl")}
    )
    assert echoed.status_code == 200, echoed.text
    assert (echoed.json()["title_nl"], echoed.json()["title_en"]) == (None, "Round trip")


def test_an_empty_string_or_null_clears_one_language_but_never_the_last_of_a_required_field(owner: TestClient) -> None:
    trip = owner.post("/api/trips", json={"title_nl": "Rondreis", "title_en": "Round trip", "summary": "Kort"}).json()
    cleared = owner.patch(base(trip), json={"title_nl": "", "summary": None}).json()
    assert (cleared["title"], cleared["title_nl"], cleared["title_en"], cleared["summary"]) == (
        "Round trip",
        None,
        "Round trip",
        None,
    )
    refused = owner.patch(base(trip), json={"title_en": None})
    assert refused.status_code == 422
    assert refused.json()["errors"][0]["code"] == "text_required_in_a_language"
    assert owner.post("/api/trips", json={"summary": "Alleen een samenvatting"}).status_code == 422
    assert owner.post("/api/trips", json={"title": ""}).status_code == 422


def test_moving_a_trip_to_another_content_language_moves_its_texts_in_one_step(owner: TestClient) -> None:
    trip = new_trip(owner, title="Round trip")
    owner.post(f"{base(trip)}/areas", json={"label": "Brussels"}).json()
    update = owner.post(
        f"{base(trip)}/travel-updates",
        json={"occurred_at": "2054-04-04T10:00:00Z", "title": "Day one", "body": "Story"},
    ).json()

    # Without `move_texts` only the language a plain write lands in changes.
    switched = owner.patch(base(trip), json={"content_language": "en"}).json()
    assert (switched["content_language"], switched["title_nl"], switched["title_en"]) == ("en", "Round trip", None)
    assert owner.patch(base(trip), json={"content_language": "nl"}).json()["content_language"] == "nl"

    moved = owner.patch(base(trip), json={"content_language": "en", "move_texts": True}).json()
    assert (moved["title_nl"], moved["title_en"]) == (None, "Round trip")
    assert owner.get(f"{base(trip)}/areas").json()[0]["label_en"] == "Brussels"
    moved_update = owner.get(f"{base(trip)}/travel-updates").json()[0]
    assert (moved_update["id"], moved_update["title_nl"], moved_update["title_en"], moved_update["body_en"]) == (
        update["id"],
        None,
        "Day one",
        "Story",
    )
    # A plain write now lands in English.
    assert owner.patch(base(trip), json={"summary": "Short"}).json()["summary_en"] == "Short"

    # It never overwrites: a field with both languages refuses the whole move.
    owner.patch(base(trip), json={"title_nl": "Rondreis"})
    refused = owner.patch(base(trip), json={"content_language": "nl", "move_texts": True})
    assert refused.status_code == 422
    assert refused.json()["errors"][0]["code"] == "trip_text_in_both_languages"
    assert owner.get(base(trip)).json()["content_language"] == "en"
    nothing = owner.patch(base(trip), json={"move_texts": True})
    assert nothing.json()["errors"][0]["code"] == "move_texts_needs_a_new_content_language"


def test_every_record_kind_stores_both_languages_and_its_plain_name_follows_the_trip(owner: TestClient) -> None:
    trip = new_trip(owner, content_language="en", title="Round trip")
    area = owner.post(f"{base(trip)}/areas", json={"label": "Brussels", "label_nl": "Brussel"}).json()
    assert (area["label"], area["label_nl"], area["label_en"]) == ("Brussels", "Brussel", "Brussels")
    other = owner.post(f"{base(trip)}/areas", json={"label": "Ghent"}).json()
    assert (other["label_nl"], other["label_en"]) == (None, "Ghent")

    location = owner.post(
        f"{base(trip)}/locations",
        json={"display_name": "Station", "locality": "Brussels", "label": "Central", "label_nl": "Centraal"},
    ).json()
    assert (location["label"], location["label_nl"], location["label_en"]) == ("Central", "Centraal", "Central")
    renamed = owner.patch(f"{base(trip)}/locations/{location['id']}", json={"label_nl": None}).json()
    assert (renamed["label"], renamed["label_nl"], renamed["label_en"]) == ("Central", None, "Central")

    visit = owner.post(
        f"{base(trip)}/visits",
        json={"area_id": area["id"], "title_nl": "Museum", "summary": "A highlight", "summary_nl": "Een hoogtepunt"},
    ).json()
    assert (visit["title"], visit["title_nl"], visit["title_en"]) == ("Museum", "Museum", None)
    assert (visit["summary"], visit["summary_nl"], visit["summary_en"]) == (
        "A highlight",
        "Een hoogtepunt",
        "A highlight",
    )
    assert visit["summary_html"] == "<p>A highlight</p>\n"

    route = owner.post(
        f"{base(trip)}/routes",
        json={
            "mode": "train",
            "label": "Morning train",
            "departure_area_id": area["id"],
            "arrival_area_id": other["id"],
        },
    ).json()
    assert (route["label"], route["label_nl"], route["label_en"]) == ("Morning train", None, "Morning train")

    update = owner.post(
        f"{base(trip)}/travel-updates",
        json={"occurred_at": "2054-04-04T10:00:00Z", "title": "Day one", "body_nl": "Een dag"},
    ).json()
    assert (update["title"], update["body"], update["body_nl"], update["body_en"]) == (
        "Day one",
        "Een dag",
        "Een dag",
        None,
    )
    assert update["body_html"] == "<p>Een dag</p>\n"
    patched = owner.patch(f"{base(trip)}/travel-updates/{update['id']}", json={"body_en": "A day"}).json()
    assert (patched["body"], patched["body_nl"], patched["body_en"]) == ("A day", "Een dag", "A day")
    required = owner.patch(f"{base(trip)}/travel-updates/{update['id']}", json={"title": None})
    assert required.status_code == 422
    assert required.json()["errors"][0]["code"] == "text_required_in_a_language"


def test_owner_search_finds_a_record_by_the_text_of_either_language(owner: TestClient) -> None:
    trip = new_trip(owner, title="Rondreis België", title_en="Round trip Belgium")
    owner.post(f"{base(trip)}/areas", json={"label_nl": "Gent", "label_en": "Ghent"})
    owner.post(
        f"{base(trip)}/travel-updates",
        json={"occurred_at": "2054-04-04T10:00:00Z", "title_nl": "Eerste dag", "title_en": "First day"},
    )
    assert [item["id"] for item in owner.get("/api/trips", params={"q": "belgium"}).json()] == [trip["id"]]
    assert [item["id"] for item in owner.get("/api/trips", params={"q": "belgië"}).json()] == [trip["id"]]
    assert len(owner.get(f"{base(trip)}/areas", params={"q": "ghent"}).json()) == 1
    assert len(owner.get(f"{base(trip)}/areas", params={"q": "gent"}).json()) == 1
    assert len(owner.get(f"{base(trip)}/travel-updates", params={"q": "first"}).json()) == 1
    assert len(owner.get(f"{base(trip)}/travel-updates", params={"q": "eerste"}).json()) == 1


def test_text_safe_handling_applies_to_every_language_field(owner: TestClient) -> None:
    for field in ("title_nl", "title_en", "summary_en"):
        assert owner.post("/api/trips", json={"title": "Ok", field: "bad\x00text"}).status_code == 422
    assert owner.post("/api/trips", json={"title": "x" * 161}).status_code == 422
    assert owner.post("/api/trips", json={"title_en": "x" * 161}).status_code == 422
    assert owner.post("/api/trips", json={"title": "Ok", "content_language": "de"}).status_code == 422


def test_the_mcp_tools_take_the_same_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "mcp_development_subject", "owner-1")
    backend = TravelMcpBackend(TestingSessionLocal)
    properties = schemas.TripCreate.model_json_schema()["properties"]
    assert {"title", "title_nl", "title_en", "summary_nl", "summary_en", "content_language"} <= set(properties)
    assert "Dutch" in properties["title_nl"]["description"]

    trip = backend.create_trip(schemas.TripCreate(title_en="Round trip", summary_nl="Kort"))
    assert (trip["content_language"], trip["title"], trip["title_nl"], trip["title_en"]) == (
        "nl",
        "Round trip",
        None,
        "Round trip",
    )
    updated = backend.update_trip(trip["id"], schemas.TripUpdate(title_nl="Rondreis", content_language="en"))
    assert (updated["content_language"], updated["title"], updated["title_nl"]) == ("en", "Round trip", "Rondreis")
    with pytest.raises(ValueError, match="Dutch or English"):
        backend.create_trip(schemas.TripCreate(summary_nl="Geen titel"))


# --- the visitor ---------------------------------------------------------------------


def published(owner: TestClient, trip: dict, *shared: dict) -> str:
    """Publish the trip's public page for the given (kind, record) pairs and return its slug."""
    items = []
    for kind, record in shared:
        response = owner.put(f"{base(trip)}/visibility/{kind}/{record['id']}", json={"visibility": "custom"})
        assert response.status_code == 200, response.text
        items.append({"kind": kind, "id": record["id"]})
    scope = {"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": items}
    assert owner.put(f"{base(trip)}/public-projection", json=scope).status_code == 200
    return owner.post(f"{base(trip)}/public-projection/publish").json()["slug"]


def bilingual_trip(owner: TestClient) -> tuple[dict, str]:
    trip = new_trip(
        owner, title_nl="Rondreis", title_en="Round trip", summary_nl="Een korte reis", summary_en="A short trip"
    )
    area = owner.post(f"{base(trip)}/areas", json={"label_nl": "Brussel", "country_code": "BE"}).json()
    both = owner.post(
        f"{base(trip)}/travel-updates",
        json={
            "occurred_at": "2054-04-04T10:00:00Z",
            "title_nl": "Eerste dag",
            "title_en": "First day",
            "body_nl": "Het regende.",
            "body_en": "It rained.",
            "area_id": area["id"],
        },
    ).json()
    # Only the body is written in just one language: fallback is per single field, not per record.
    half = owner.post(
        f"{base(trip)}/travel-updates",
        json={
            "occurred_at": "2054-04-05T10:00:00Z",
            "title_nl": "Tweede dag",
            "title_en": "Second day",
            "body_nl": "Het was zonnig.",
        },
    ).json()
    only_dutch = owner.post(
        f"{base(trip)}/travel-updates",
        json={"occurred_at": "2054-04-06T10:00:00Z", "title_nl": "Derde dag", "body_nl": "Terug naar huis."},
    ).json()
    visit = owner.post(
        f"{base(trip)}/visits",
        json={"area_id": area["id"], "title_en": "Museum", "summary_nl": "Een tip", "starts_on": "2054-04-04"},
    ).json()
    slug = published(
        owner,
        trip,
        ("travel_update", both),
        ("travel_update", half),
        ("travel_update", only_dutch),
        ("visit", visit),
        ("area", area),
    )
    return trip, slug


def delivered(owner: TestClient, slug: str, lang: str | None = None) -> dict:
    response = TestClient(app).get(f"/api/public/trips/{slug}", params={"lang": lang} if lang else {})
    assert response.status_code == 200, response.text
    return response.json()


def by_title(items: list[dict], title: str) -> dict:
    return next(item for item in items if item["title"] == title)


def test_the_visitor_gets_the_text_in_their_language_and_fallback_per_record_and_per_field(owner: TestClient) -> None:
    _, slug = bilingual_trip(owner)

    english = delivered(owner, slug, "en")
    assert (english["title"], english["summary"], english["summary_html"]) == (
        "Round trip",
        "A short trip",
        "<p>A short trip</p>\n",
    )
    assert "title_lang" not in english and "summary_lang" not in english
    first, second, third = (by_title(english["updates"], title) for title in ("First day", "Second day", "Derde dag"))
    # A record with both languages carries no marker at all.
    assert (first["body"], "title_lang" in first, "body_lang" in first) == ("It rained.", False, False)
    # One field of a record falls back; the others of the same record are still in the visitor's language.
    assert (second["title"], second["body"], second["body_lang"]) == ("Second day", "Het was zonnig.", "nl")
    assert "title_lang" not in second
    # A whole record in one language falls back in every text field and says so.
    assert (third["body"], third["title_lang"], third["body_lang"]) == ("Terug naar huis.", "nl", "nl")
    assert third["body_html"] == "<p>Terug naar huis.</p>\n"
    # The visit has an English title and a Dutch summary: the title is as asked, the summary falls back.
    visit = english["visits"][0]
    assert (visit["title"], visit["summary"], visit["summary_lang"]) == ("Museum", "Een tip", "nl")
    assert "title_lang" not in visit
    # Only the Dutch place name exists: it is delivered, marked, in the update's embedded place and the place list.
    assert english["places"][0]["label"] == "Brussel" and english["places"][0]["label_lang"] == "nl"
    assert first["place"]["label"] == "Brussel" and first["place"]["label_lang"] == "nl"

    dutch = delivered(owner, slug, "nl")
    assert (dutch["title"], by_title(dutch["updates"], "Eerste dag")["body"]) == ("Rondreis", "Het regende.")
    assert "label_lang" not in dutch["places"][0]
    # The Dutch visit title does not exist: English is delivered and marked.
    assert (dutch["visits"][0]["title"], dutch["visits"][0]["title_lang"]) == ("Museum", "en")
    assert "summary_lang" not in dutch["visits"][0]


def test_the_request_language_defaults_to_the_trip_and_an_unknown_one_is_ignored(owner: TestClient) -> None:
    _, slug = bilingual_trip(owner)
    assert delivered(owner, slug)["title"] == "Rondreis"
    assert delivered(owner, slug, "de")["title"] == "Rondreis"
    english_trip = new_trip(owner, title_nl="Rondreis", title_en="Round trip", content_language="en")
    english_slug = published(owner, english_trip)
    assert delivered(owner, english_slug)["title"] == "Round trip"
    assert delivered(owner, english_slug, "nl")["title"] == "Rondreis"


def test_a_delivered_document_says_which_language_its_unmarked_texts_are_in(owner: TestClient) -> None:
    """The page learns the trip's own language here when it asked for none, so it can set ``lang`` on its texts."""
    _, slug = bilingual_trip(owner)
    client = TestClient(app)
    assert client.get(f"/api/public/trips/{slug}").headers["Content-Language"] == "nl"
    assert client.get(f"/api/public/trips/{slug}", params={"lang": "en"}).headers["Content-Language"] == "en"
    # An unknown language is ignored: the document is the trip's own, and says so.
    assert client.get(f"/api/public/trips/{slug}", params={"lang": "de"}).headers["Content-Language"] == "nl"
    english_trip = new_trip(owner, title_nl="Rondreis", title_en="Round trip", content_language="en")
    english_slug = published(owner, english_trip)
    assert client.get(f"/api/public/trips/{english_slug}").headers["Content-Language"] == "en"
    assert client.get(f"/api/public/trips/{english_slug}", params={"lang": "nl"}).headers["Content-Language"] == "nl"


def test_the_owner_previews_either_language_of_what_a_visitor_receives(owner: TestClient) -> None:
    trip, slug = bilingual_trip(owner)
    scope = {"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": []}
    url = f"{base(trip)}/public-projection/preview"
    # Nothing asked for is the trip's own language; an unknown one is ignored, as on the visitor's own request.
    assert owner.post(url, json=scope).json()["title"] == "Rondreis"
    assert owner.post(url, json=scope, params={"lang": "de"}).json()["title"] == "Rondreis"
    english = owner.post(url, json=scope, params={"lang": "en"}).json()
    assert (english["title"], english["summary"]) == ("Round trip", "A short trip")
    assert "title_lang" not in english
    # The saved page is the one a visitor gets, in the same language.
    assert delivered(owner, slug, "en")["title"] == english["title"]


def test_only_the_texts_change_with_the_language_never_the_rest_of_the_document(owner: TestClient) -> None:
    _, slug = bilingual_trip(owner)
    english, dutch = delivered(owner, slug, "en"), delivered(owner, slug, "nl")
    text_keys = {"title", "summary", "summary_html", "summary_text", "body", "body_html", "label", "caption"}

    def structure(node):
        if isinstance(node, dict):
            return {
                key: structure(value)
                for key, value in node.items()
                if key not in text_keys and not key.endswith("_lang")
            }
        if isinstance(node, list):
            return [structure(value) for value in node]
        return node

    assert structure(english) == structure(dutch)
    # The allowlist is untouched: no stored column name, no owner-only text, no id of the stored records.
    for forbidden in ("title_nl", "title_en", "body_nl", "label_en", "content_language", "private_notes"):
        assert forbidden not in str(english)


def test_the_atom_feed_and_the_card_list_follow_the_requested_language(owner: TestClient) -> None:
    _, slug = bilingual_trip(owner)
    client = TestClient(app)
    cards = client.get("/api/public/trips", params={"lang": "en"}).json()
    assert (cards[0]["title"], cards[0]["summary"]) == ("Round trip", "A short trip")
    assert client.get("/api/public/trips", params={"lang": "nl"}).json()[0]["title"] == "Rondreis"

    feed = client.get(f"/api/public/trips/{slug}/feed.atom", params={"lang": "en"})
    assert feed.status_code == 200
    text = feed.content.decode()
    assert 'xml:lang="en"' in text and "First day" in text and "It rained." in text and "Eerste dag" not in text
    # An entry in the other language says so on its own elements.
    assert text.count('xml:lang="nl"') >= 1


def test_the_atom_document_marks_a_text_in_the_other_language() -> None:
    document = {
        "title": "Round trip",
        "updates": [
            {"id": "u1", "title": "Derde dag", "title_lang": "nl", "body": "Terug.", "body_lang": "nl", "place": None}
        ],
    }
    text = atom_document(document, "urn:test", "en").decode()
    assert text.count('xml:lang="nl"') == 2


def test_a_collection_index_gets_its_title_and_its_trips_in_the_requested_language(owner: TestClient) -> None:
    trip = new_trip(owner, title_nl="Rondreis", title_en="Round trip")
    scope = {"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": []}
    collection = owner.post(
        "/api/collections", json={"label": "Familie", "title_nl": "Onze reizen", "content_language": "nl"}
    ).json()
    assert (collection["title"], collection["title_nl"], collection["title_en"]) == ("Onze reizen", "Onze reizen", None)
    added = owner.post(f"/api/collections/{collection['id']}/members", json={"trip_id": trip["id"], "scope": scope})
    assert added.status_code in (200, 201), added.text
    activated = owner.post(f"/api/collections/{collection['id']}/activate", json={"expires_in_days": 30})
    assert activated.status_code == 200, activated.text
    token = activated.json()["token"]

    english = TestClient(app).get(f"/api/shared/{token}", params={"lang": "en"}).json()
    assert (english["title"], english["title_lang"], english["trips"][0]["title"]) == (
        "Onze reizen",
        "nl",
        "Round trip",
    )
    assert "title_lang" not in english["trips"][0]
    dutch = TestClient(app).get(f"/api/shared/{token}", params={"lang": "nl"}).json()
    assert (dutch["title"], "title_lang" in dutch, dutch["trips"][0]["title"]) == ("Onze reizen", False, "Rondreis")
    both = owner.patch(f"/api/collections/{collection['id']}", json={"title_en": "Our trips"}).json()
    assert (both["title_nl"], both["title_en"]) == ("Onze reizen", "Our trips")
    assert TestClient(app).get(f"/api/shared/{token}", params={"lang": "en"}).json()["title"] == "Our trips"


def test_a_collection_index_reads_every_member_in_the_collections_language_and_marks_what_differs(
    owner: TestClient,
) -> None:
    """A member trip written in the other language must not leave an unmarked text in a language the index does
    not declare: without ``lang`` the whole index is in the collection's own language."""
    scope = {"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": []}
    english_only = new_trip(owner, title_en="Round trip", content_language="en")
    both = new_trip(owner, title_nl="Rondreis", title_en="Tour", content_language="en")
    collection = owner.post(
        "/api/collections", json={"label": "Familie", "title_nl": "Onze reizen", "content_language": "nl"}
    ).json()
    for trip in (english_only, both):
        added = owner.post(f"/api/collections/{collection['id']}/members", json={"trip_id": trip["id"], "scope": scope})
        assert added.status_code in (200, 201), added.text
    token = owner.post(f"/api/collections/{collection['id']}/activate", json={"expires_in_days": 30}).json()["token"]

    response = TestClient(app).get(f"/api/shared/{token}")
    assert response.headers["Content-Language"] == "nl"
    document = response.json()
    assert "title_lang" not in document
    first, second = document["trips"]
    # No Dutch text exists: the English one is delivered and says so, instead of passing for Dutch.
    assert (first["title"], first["title_lang"]) == ("Round trip", "en")
    # An English-language trip with a Dutch version is read in Dutch, unmarked.
    assert (second["title"], "title_lang" in second) == ("Rondreis", False)
    english = TestClient(app).get(f"/api/shared/{token}", params={"lang": "en"}).json()
    assert (english["trips"][0]["title"], "title_lang" in english["trips"][0]) == ("Round trip", False)
    assert (english["trips"][1]["title"], "title_lang" in english["trips"][1]) == ("Tour", False)
    assert (english["title"], english["title_lang"]) == ("Onze reizen", "nl")


def test_a_photo_caption_and_alt_text_fall_back_in_the_projection() -> None:
    from app.projection import visitor_text

    photo = MediaDerivative(caption_nl="Zonsondergang", alt_text_en="A sunset over the sea")
    assert visitor_text(photo, "caption", "en") == {"caption": "Zonsondergang", "caption_lang": "nl"}
    assert visitor_text(photo, "alt_text", "en") == {"alt_text": "A sunset over the sea"}
    assert visitor_text(photo, "alt_text", "nl") == {"alt_text": "A sunset over the sea", "alt_text_lang": "en"}
    assert visitor_text(MediaDerivative(), "caption", "nl") == {"caption": None}


def test_an_update_without_text_in_either_language_breaks_no_delivery(owner: TestClient) -> None:
    """Such an update is never delivered (``sharing_blocker``), and rendering one is safe anyway."""
    from datetime import UTC, datetime

    from sqlalchemy import text

    from app.models import DatePrecision, TravelUpdate
    from app.projection import _render
    from app.trip_pdf import PdfRequest, pdf_data

    trip = new_trip(owner)
    update = owner.post(
        f"{base(trip)}/travel-updates",
        json={"occurred_at": "2054-04-04T10:00:00Z", "title": "Dag", "body": "Tekst"},
    ).json()
    slug = published(owner, trip, ("travel_update", update))
    scope = {
        "schema_version": "travel/share-scope@1",
        "trip": {"title": True, "summary": True},
        "items": [{"kind": "travel_update", "id": update["id"]}],
    }
    link = owner.post(f"{base(trip)}/share-links", json={"label": "Family", "scope": scope}).json()
    owner.post(f"{base(trip)}/share-links/{link['id']}/preview")
    token = owner.post(f"{base(trip)}/share-links/{link['id']}/activate", json={"expires_in_days": 30}).json()["token"]
    feed = owner.post(f"{base(trip)}/share-links/{link['id']}/feed/enable", json={"acknowledge_copies": True}).json()
    collection = owner.post("/api/collections", json={"label": "Familie"}).json()
    owner.post(f"/api/collections/{collection['id']}/members", json={"trip_id": trip["id"], "scope": scope})
    shared = owner.post(f"/api/collections/{collection['id']}/activate", json={"expires_in_days": 30}).json()
    index = TestClient(app).get(f"/api/shared/{shared['token']}").json()
    member = owner.get(f"/api/collections/{collection['id']}").json()["members"][0]["id"]
    assert index["trips"][0]["id"] == member

    with TestingSessionLocal() as session:
        session.execute(text("UPDATE travel_updates SET body_nl = NULL, body_en = NULL"))
        session.commit()

    client = TestClient(app)
    for path in (
        f"/api/public/trips/{slug}",
        f"/api/shared/{token}",
        f"/api/shared/{shared['token']}/trips/{member}",
    ):
        for lang in ("nl", "en"):
            response = client.get(path, params={"lang": lang})
            assert response.status_code == 200, (path, response.text)
            assert response.json()["updates"] == []
    for path in (f"/api/public/trips/{slug}/feed.atom", f"/api/shared/{feed['feed_token']}/feed.atom"):
        assert client.get(path, params={"lang": "en"}).status_code == 200, path
    with TestingSessionLocal() as session:
        stored = session.get(Trip, trip["id"])
        assert stored is not None
        data, _ = pdf_data(session, stored, PdfRequest(content="both", view="audience", locale="en", audience="public"))
        assert data["updates"] == []

    # Rendering such an update directly still gives the (required) empty text, never a missing one.
    item = TravelUpdate(
        id="u",
        share_id="s",
        trip=Trip(owner_subject="o"),
        title_nl="Dag",
        occurred_at=datetime(2054, 4, 4, tzinfo=UTC),
        share_date_precision=DatePrecision.DAY,
        visibility=Visibility.EVERYONE,
    )
    context = {
        "language": ContentLanguage.NL,
        "date_precision": "month",
        "zone_spans": (),
        "areas": set(),
        "locations": set(),
        "updates": {},
    }
    rendered = _render("travel_update", item, "update-s", context)
    assert (rendered["title"], rendered["body"]) == ("Dag", "")


def test_an_owner_can_edit_a_suggested_area_name_on_an_english_trip(owner: TestClient) -> None:
    from app.config import Settings
    from app.places.search import CachedPlaceSearchService
    from app.routers.places import get_place_search_service
    from tests.test_places import FakePlaceSearchProvider

    app.dependency_overrides[get_place_search_service] = lambda: CachedPlaceSearchService(
        FakePlaceSearchProvider(), Settings()
    )
    trip = new_trip(owner, title="Round trip", content_language="en")
    point = {"latitude": 25.033, "longitude": 121.565, "city": "Taipei"}
    suggestion = owner.post(f"{base(trip)}/areas/suggest", json=point).json()["area"]
    assert suggestion["label"] == "Taipei"

    # The place picker edits only `label` of the suggestion it got back, and sends the rest unchanged.
    edited = owner.post(f"{base(trip)}/areas", json={**suggestion, "label": "Taipei City"})
    assert edited.status_code == 201, edited.text
    assert (edited.json()["label"], edited.json()["label_nl"], edited.json()["label_en"]) == (
        "Taipei City",
        None,
        "Taipei City",
    )
    # An unedited suggestion saves as it is, through a location's new area too.
    created = owner.post(
        f"{base(trip)}/locations",
        json={"display_name": "Station", "locality": "Taipei", "new_area": {**suggestion, "label": "Taipei Main"}},
    )
    assert created.status_code == 201, created.text
    labels = {area["label_en"] for area in owner.get(f"{base(trip)}/areas").json()}
    assert labels == {"Taipei City", "Taipei Main"}
    plain = owner.post(f"{base(trip)}/areas", json=suggestion)
    assert plain.status_code == 201 and plain.json()["label_en"] == "Taipei"
    # A client that sends two different texts for the same language is still refused.
    assert owner.post(f"{base(trip)}/areas", json={"label": "A", "label_en": "B"}).status_code == 422


def test_models_keep_the_plain_name_for_older_code() -> None:
    trip = Trip(owner_subject="o", content_language="en")
    trip.title = "Rondreis"  # lands in the language the trip is written in
    assert (trip.title, trip.title_nl, trip.title_en) == ("Rondreis", None, "Rondreis")
    area = Area(label="Gent", visibility=Visibility.PRIVATE)
    assert (area.label, area.label_nl, area.label_en) == ("Gent", "Gent", None)
