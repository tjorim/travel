from datetime import UTC, datetime, timedelta
from xml.etree.ElementTree import fromstring

from app.atom import atom_document
from app.authlimit import failed_authentication
from app.config import settings
from app.models import ShareLink
from tests import test_publication as publication
from tests.test_publication import (
    TestingSessionLocal,
    add_update,
    client_for,
    create_trip,
    item,
    scope,
)


def setup_function():
    publication.setup_function()


def teardown_function():
    publication.teardown_function()


def test_serializer_allowlist():
    document = {
        "title": "<Trip>&",
        "secret": "SECRET",
        "media": ["PHOTO"],
        "updates": [
            {
                "id": "local",
                "title": "<Title>",
                "body": "<script>alert(1)</script>\x01",
                "story_date": "2054-04",
                "date_precision": "month",
                "place": {"label": "Area", "latitude": "GPS"},
                "body_html": "HTML",
                "notes": "NOTES",
                "location": "LOCATION",
            }
        ],
    }
    xml = atom_document(document, "urn:test")
    root = fromstring(xml)
    for secret in (b"SECRET", b"PHOTO", b"GPS", b"HTML", b"NOTES", b"LOCATION", b"2054-04-01"):
        assert secret not in xml
    assert root.find("{*}entry/{*}content").attrib == {"type": "text"}
    assert root.find("{*}entry/{*}content").text == "2054-04\n\nArea\n\n<script>alert(1)</script>"


def enabled_feed():
    client = client_for("owner")
    trip = create_trip(client)
    selected = add_update(client, trip["id"], "Visible")
    add_update(client, trip["id"], "SECRET")
    path = f"/api/trips/{trip['id']}"
    link = client.post(
        path + "/share-links", json={"label": "Private label", "scope": scope(item("travel_update", selected["id"]))}
    ).json()
    base = path + "/share-links/" + link["id"]
    page = client.post(base + "/activate", json={}).json()
    assert client.post(base + "/feed/enable", json={}).status_code == 422
    feed = client.post(base + "/feed/enable", json={"acknowledge_copies": True}).json()
    return client, path, base, page, feed


def test_lifecycle_headers_scope_and_audit():
    client, path, base, page, feed = enabled_feed()
    url = f"/api/shared/{feed['feed_token']}/feed.atom"
    response = client.get(url)
    assert response.status_code == 200, response.text
    assert "Visible" in response.text
    for secret in ("SECRET", "Private label", page["token"], page["id"]):
        assert secret not in response.text
    assert response.headers["cache-control"] == "no-store, private"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "noindex" in response.headers["x-robots-tag"]
    assert client.get(f"/api/shared/{page['token']}/feed.atom").status_code == 404
    assert client.get(f"/api/shared/{feed['feed_token']}").status_code == 404
    rotated = client.post(base + "/feed/rotate", json={"acknowledge_copies": True}).json()
    assert client.get(url).status_code == 404
    url = f"/api/shared/{rotated['feed_token']}/feed.atom"
    assert client.get(url).status_code == 200
    assert client.post(base + "/feed/revoke", json={}).status_code == 200
    assert client.get(url).status_code == 404
    events = client.get(path + "/audit-events").json()
    assert {"feed.enable", "feed.rotate", "feed.revoke"} <= {e["kind"] for e in events}
    assert feed["feed_token"] not in str(events)
    exported = client.get(path + "/export")
    assert exported.status_code == 200
    assert feed["feed_token"] not in exported.text
    assert "feed_verifier" not in exported.text


def test_parent_and_feed_expiry_and_revocation():
    client, _, base, page, feed = enabled_feed()
    url = f"/api/shared/{feed['feed_token']}/feed.atom"
    for field in ("feed_expires_at", "expires_at"):
        with TestingSessionLocal() as session:
            link = session.get(ShareLink, page["id"])
            setattr(link, field, datetime.now(UTC) - timedelta(seconds=1))
            session.commit()
        assert client.get(url).status_code == 404
        with TestingSessionLocal() as session:
            link = session.get(ShareLink, page["id"])
            setattr(link, field, None)
            session.commit()
    assert client.post(base + "/revoke", json={}).status_code == 200
    assert client.get(url).status_code == 404


def test_failed_feed_tokens_throttled():
    client = client_for("owner")
    failed_authentication.enabled = True
    for _ in range(settings.auth_failure_limit):
        assert client.get("/api/shared/invalid/feed.atom").status_code == 404
    response = client.get("/api/shared/invalid/feed.atom")
    assert response.status_code == 429
    assert "noindex" in response.headers["x-robots-tag"]
    assert "invalid" not in response.text


def test_public_feed_withdrawal_and_restricted_link_exclusion():
    client = client_for("owner")
    trip = create_trip(client)
    update = add_update(client, trip["id"], "Public story", "everyone")
    path = f"/api/trips/{trip['id']}"
    public = client.post(path + "/public-projection/publish").json()
    url = f"/api/public/trips/{public['slug']}/feed.atom"
    assert "Public story" in client.get(url).text
    response = client.post(
        path + "/share-links",
        json={"label": "Restricted", "scope": {**scope(), "exclude": [item("travel_update", update["id"])]}},
    )
    base = path + "/share-links/" + response.json()["id"]
    client.post(base + "/activate", json={})
    feed = client.post(base + "/feed/enable", json={"acknowledge_copies": True}).json()
    response = client.get(f"/api/shared/{feed['feed_token']}/feed.atom")
    assert response.status_code == 200
    assert "Public story" not in response.text
    client.post(path + "/public-projection/unpublish", json={})
    unavailable = client.get(url)
    assert unavailable.status_code == 404
    assert "noindex" in unavailable.headers["x-robots-tag"]
    assert unavailable.headers["referrer-policy"] == "no-referrer"


def test_other_owner_cannot_manage_feed_and_page_rotation_stops_feed():
    client, path, base, page, feed = enabled_feed()
    assert client_for("someone-else").post(base + "/feed/revoke", json={}).status_code == 404
    client = client_for("owner")
    assert client.post(base + "/rotate", json={}).status_code == 200
    assert client.get(f"/api/shared/{feed['feed_token']}/feed.atom").status_code == 404
