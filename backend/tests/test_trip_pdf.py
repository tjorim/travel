"""PDF privacy, budgets and authenticated ephemeral delivery, using synthetic data."""

import json
import subprocess

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from test_export import (
    CANARIES,
    TestingSessionLocal,
    build_rich_trip,
    client_for,
    setup_function,
    teardown_function,
)

from app.models import OwnerActivityEvent, PublicSurface, ShareLink, TravelUpdate, Trip, Visibility
from app.projection import render_projection
from app.services.trips import owned_trip
from app.storage import get_storage
from app.trip_pdf import PdfRequest, check_budget, generate_pdf, pdf_data

# Reuse only synthetic fixture helpers; pytest calls these locally too.
__all__ = ["setup_function", "teardown_function"]


def request(**changes):
    return PdfRequest(content="both", view="audience", locale="nl", audience="public", **changes)


class NoFiles:
    def open(self, key):
        raise AssertionError("No original or remote file may be opened")


def test_audience_is_exact_projection_with_exclusions_and_precision():
    ids = build_rich_trip()
    with TestingSessionLocal() as session:
        trip = owned_trip(session, ids["trip"], "owner-1", load_relations=False)
        update = session.get(TravelUpdate, ids["update"])
        update.visibility = Visibility.EVERYONE
        update.private_notes = "SECRET-NOTES-CANARY"
        link = session.get(ShareLink, ids["link"])
        link.scope = {
            "items": [],
            "defaults": {"date_precision": "year"},
            "exclude": [{"kind": "travel_update", "id": update.id}],
        }
        surface = session.get(PublicSurface, trip.id)
        surface.scope = {
            "items": [],
            "defaults": {"date_precision": "year"},
            "trip": {"title": False, "summary": False, "dates": "year"},
        }
        session.commit()
        data, photos = pdf_data(session, trip, request())
        assert data == render_projection(trip, surface.scope, "travel/public-trip@1")
        assert data["updates"][0]["story_date"] == "2054"
        assert "SECRET-NOTES-CANARY" not in json.dumps(data)
        assert data["title"] is None and data["summary"] is None
        for canary in CANARIES.values():
            assert canary not in json.dumps(data)
        data, photos = pdf_data(
            session, trip, PdfRequest(content="both", view="audience", locale="en", audience=link.id)
        )
        assert data == render_projection(trip, link.scope, "travel/unlisted-trip@1")
        assert data["updates"] == [] and photos == {}


@pytest.mark.parametrize("locale", ["nl", "en"])
def test_private_pdf_delivery_audit_and_no_files(locale):
    ids = build_rich_trip()
    client = client_for("owner-1")
    from app.main import app

    app.dependency_overrides[get_storage] = lambda: NoFiles()
    response = client.post(
        f"/api/trips/{ids['trip']}/export/pdf",
        json={
            "content": "itinerary",
            "view": "private",
            "confirm_private": True,
            "locale": locale,
        },
    )
    assert response.status_code == 200, response.text
    assert response.content.startswith(b"%PDF-")
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["content-type"] == "application/pdf"
    with TestingSessionLocal() as session:
        audit = session.scalar(select(OwnerActivityEvent).where(OwnerActivityEvent.action == "trip.export_pdf"))
        assert audit.details == {}
        assert audit.transport == "http"
        assert audit.trip_id == ids["trip"]
    assert (
        client_for("someone-else")
        .post(
            f"/api/trips/{ids['trip']}/export/pdf",
            json={
                "content": "itinerary",
                "view": "private",
                "confirm_private": True,
                "locale": locale,
            },
        )
        .status_code
        == 404
    )


def test_explicit_private_acknowledgement_and_audience_required():
    for payload in [
        {"view": "private"},
        {"view": "audience"},
        {"view": "private", "confirm_private": True, "audience": "public"},
    ]:
        with pytest.raises(ValidationError):
            PdfRequest(content="both", locale="nl", **payload)


@pytest.mark.parametrize("audience", ["bad\x00text", "\ud800", "\udfff"])
def test_pdf_rejects_unsafe_audience_before_database_lookup(audience):
    ids = build_rich_trip()
    response = client_for("owner-1").post(
        f"/api/trips/{ids['trip']}/export/pdf",
        content=json.dumps({"content": "story", "view": "audience", "locale": "en", "audience": audience}),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422


def test_preflight_rejects_large_trip_before_relationship_load(monkeypatch):
    ids = build_rich_trip()
    with TestingSessionLocal() as session:
        monkeypatch.setattr("app.trip_pdf.MAX_ROWS", 1)
        with pytest.raises(HTTPException) as error:
            check_budget(session, ids["trip"])
        assert error.value.status_code == 413
        monkeypatch.setattr("app.trip_pdf.MAX_ROWS", 1500)
        trip = session.get(Trip, ids["trip"])
        trip.summary = "x" * 500_001
        session.commit()
        with pytest.raises(HTTPException):
            check_budget(session, ids["trip"])


def test_timeout_is_fixed_error_and_itinerary_never_opens_photos(monkeypatch, tmp_path):
    ids = build_rich_trip()

    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("renderer", 30)

    monkeypatch.setattr("app.trip_pdf.subprocess.run", timeout)
    with TestingSessionLocal() as session:
        trip = owned_trip(session, ids["trip"], "owner-1", load_relations=False)
        with pytest.raises(HTTPException) as error:
            generate_pdf(
                session,
                trip,
                PdfRequest(content="itinerary", view="private", confirm_private=True, locale="en"),
                NoFiles(),
                tmp_path,
            )
        assert error.value.status_code == 422
        assert "renderer" not in str(error.value.detail)


def test_foreign_audience_not_found():
    ids = build_rich_trip()
    with TestingSessionLocal() as session:
        other_trip = Trip(owner_subject="other-owner", title="Other synthetic trip")
        session.add(other_trip)
        session.flush()
        other_link = ShareLink(trip_id=other_trip.id, label="Other", series_id="b" * 32, scope={"items": []})
        session.add(other_link)
        session.commit()
        other_id = other_link.id
    with TestingSessionLocal() as session:
        trip = owned_trip(session, ids["trip"], "owner-1", load_relations=False)
        with pytest.raises(HTTPException) as error:
            pdf_data(session, trip, PdfRequest(content="story", view="audience", locale="en", audience=other_id))
        assert error.value.status_code == 404


def test_renderer_independent_audience_allowlist_and_markup_escape(tmp_path, monkeypatch):
    from app import pdf_renderer

    data = {
        "title": "Synthetic",
        "summary": '<img src="https://attacker.invalid/x"/>',
        "dates": None,
        "updates": [
            {"title": "Allowed", "body": "Visible", "private_notes": "PRIVATE-CANARY", "owner_subject": "OWNER-CANARY"}
        ],
        "visits": [{"title": "Visit", "notes": "NOTES-CANARY", "booking_reference": "BOOKING-CANARY"}],
        "stays": [],
        "routes": [],
        "places": [],
        "media": [],
    }
    source = tmp_path / "input.json"
    source.write_text(
        json.dumps({"data": data, "photos": {}, "request": {"view": "audience", "locale": "en", "content": "both"}})
    )
    collected = []
    monkeypatch.setattr(
        pdf_renderer.HTML, "write_pdf", lambda self, *args, **kwargs: collected.append(self.etree_element)
    )
    pdf_renderer.render(source, tmp_path / "unused.pdf")
    from xml.etree.ElementTree import tostring

    rendered = tostring(collected[0], encoding="unicode")
    for canary in ("PRIVATE-CANARY", "OWNER-CANARY", "NOTES-CANARY", "BOOKING-CANARY"):
        assert canary not in rendered
    assert "Visible" in rendered
    assert "&lt;img" in rendered
    assert "<img src=" not in rendered


def test_photo_resolution_reads_only_approved_copy_and_enforces_actual_bytes(tmp_path, monkeypatch):
    import io

    from app import trip_pdf

    ids = build_rich_trip()
    seen = []

    class CopiesOnly:
        def open(self, key):
            seen.append(key)
            assert key != CANARIES["object_key"]
            return io.BytesIO(b"x" * 32)

    monkeypatch.setattr(trip_pdf, "MAX_PHOTO_BYTES", 20)
    with TestingSessionLocal() as session:
        trip = owned_trip(session, ids["trip"], "owner-1", load_relations=False)
        with pytest.raises(HTTPException) as error:
            generate_pdf(
                session,
                trip,
                PdfRequest(content="story", view="private", confirm_private=True, locale="nl"),
                CopiesOnly(),
                tmp_path,
            )
        assert error.value.status_code == 413
        assert seen == [CANARIES["poster_key"]]
        monkeypatch.setattr(trip_pdf, "MAX_PHOTOS", 0)
        with pytest.raises(HTTPException):
            pdf_data(session, trip, PdfRequest(content="story", view="private", confirm_private=True, locale="nl"))


def test_failed_generation_cleans_temporary_directory_and_releases_admission(monkeypatch, tmp_path):
    import tempfile
    from threading import BoundedSemaphore

    from app import trip_pdf
    from app.routers import trips

    ids = build_rich_trip()
    slots = BoundedSemaphore(1)
    monkeypatch.setattr(trip_pdf, "_slots", slots)
    monkeypatch.setattr(trips, "_slots", slots)
    real_temporary = tempfile.TemporaryDirectory

    def temporary(**kwargs):
        return real_temporary(dir=tmp_path, **kwargs)

    def fail(*args, **kwargs):
        raise HTTPException(422, "Synthetic failure")

    monkeypatch.setattr(trip_pdf.tempfile, "TemporaryDirectory", temporary)
    monkeypatch.setattr(trips, "generate_pdf", fail)
    response = client_for("owner-1").post(
        f"/api/trips/{ids['trip']}/export/pdf",
        json={
            "content": "itinerary",
            "view": "private",
            "confirm_private": True,
            "locale": "en",
        },
    )
    assert response.status_code == 422
    assert list(tmp_path.iterdir()) == []
    assert slots.acquire(blocking=False)
    blocked = client_for("owner-1").post(
        f"/api/trips/{ids['trip']}/export/pdf",
        json={
            "content": "itinerary",
            "view": "private",
            "confirm_private": True,
            "locale": "en",
        },
    )
    assert blocked.status_code == 503
    assert blocked.headers["retry-after"] == "5"
    slots.release()


def test_disconnect_releases_ephemeral_response():
    import asyncio

    from starlette.requests import ClientDisconnect

    from app.trip_pdf import EphemeralPdfResponse

    cleaned = []

    async def send(message):
        if message["type"] == "http.response.body":
            raise OSError("Synthetic disconnect")

    async def receive():
        return {"type": "http.disconnect"}

    response = EphemeralPdfResponse(iter([b"%PDF-synthetic"]), cleanup=lambda: cleaned.append(True))
    with pytest.raises(ClientDisconnect):
        asyncio.run(response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send))
    assert cleaned == [True]


def test_snapshot_deadline_stops_subsequent_queries(monkeypatch):
    from sqlalchemy import text

    from app import trip_pdf

    with TestingSessionLocal() as session, trip_pdf.snapshot_budget(session):
        monkeypatch.setattr(trip_pdf.time, "monotonic", lambda: float("inf"))
        with pytest.raises(HTTPException) as error:
            session.execute(text("SELECT 1"))
        assert error.value.status_code == 422


def test_collection_member_uses_its_own_scope_and_owner_boundary():
    from app.models import Collection, CollectionMember

    ids = build_rich_trip()
    with TestingSessionLocal() as session:
        collection = Collection(owner_subject="owner-1", label="Synthetic collection")
        session.add(collection)
        session.flush()
        member = CollectionMember(
            collection_id=collection.id,
            trip_id=ids["trip"],
            scope={"items": [], "trip": {"title": False, "summary": False}, "defaults": {"date_precision": "year"}},
        )
        session.add(member)
        session.commit()
        trip = owned_trip(session, ids["trip"], "owner-1", load_relations=False)
        payload = PdfRequest(content="both", view="audience", locale="en", audience=f"collection:{member.id}")
        data, photos = pdf_data(session, trip, payload)
        assert data == render_projection(trip, member.scope, "travel/unlisted-trip@1")
        assert data["title"] is None
        collection.owner_subject = "someone-else"
        session.commit()
        with pytest.raises(HTTPException) as error:
            pdf_data(session, trip, payload)
        assert error.value.status_code == 404


@pytest.mark.parametrize("locale", ["nl", "en"])
def test_tagged_long_story_photos_and_resource_boundary(tmp_path, monkeypatch, locale):
    import socket

    from PIL import Image
    from pypdf import PdfReader
    from weasyprint import HTML

    from app import pdf_renderer

    photo = tmp_path / "approved"
    Image.new("RGB", (300, 500), "blue").save(photo, format="PNG")
    alt = 'Café & <sky> "quoted"'
    data = {
        "title": "Synthetic café",
        "summary": '<img src="file:///etc/passwd"> <img src="https://attacker.invalid/x">',
        "dates": {},
        "updates": [{"title": "Chapter", "body": "BEGIN-STORY " + "Long café vóór story. " * 1500 + " END-STORY"}],
        "media": [{"id": "copy", "alt_text": alt, "caption": "Caption"}],
        "visits": [{"title": "Visit"}],
        "stays": [],
        "routes": [],
        "places": [],
    }
    source = tmp_path / "input.json"
    source.write_text(
        json.dumps(
            {
                "data": data,
                "photos": {"copy": str(photo)},
                "request": {
                    "view": "audience",
                    "locale": locale,
                    "content": "both",
                },
            }
        )
    )
    original = HTML.write_pdf

    def checked_write(self, *args, **kwargs):
        for url in (
            "file:///etc/passwd",
            "https://attacker.invalid/x",
            "data:image/png;base64,AA",
            "https://travel.invalid/regular.ttf?x",
        ):
            with pytest.raises(ValueError, match="not approved"):
                self.url_fetcher.fetch(url)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(HTML, "write_pdf", checked_write)
    monkeypatch.setattr(socket, "create_connection", lambda *a, **kw: pytest.fail("Network access"))
    output = tmp_path / "trip.pdf"
    pdf_renderer.render(source, output)
    reader = PdfReader(output)
    root = reader.trailer["/Root"]
    assert root["/Lang"] == locale
    assert root["/MarkInfo"]["/Marked"]
    assert len(reader.pages) > 3
    elements = []

    def walk(node):
        if isinstance(node, list):
            for child in node:
                walk(child)
        elif hasattr(node, "get_object"):
            node = node.get_object()
            if isinstance(node, dict):
                if "/S" in node:
                    elements.append(node)
                if "/K" in node:
                    walk(node["/K"])

    walk(root["/StructTreeRoot"])
    tags = [node["/S"] for node in elements]
    assert tags.index("/H1") < tags.index("/H2") < tags.index("/H3") < tags.index("/Figure")
    assert [node["/Alt"] for node in elements if node["/S"] == "/Figure"] == [alt]
    text = "".join(page.extract_text() for page in reader.pages)
    assert "file:///etc/passwd" in text and "Caption" in text and "vóór" in text
    assert text.index("BEGIN-STORY") < text.index("END-STORY") < text.index("Caption")
    assert root.get("/Names") is None  # No attachments or authored links.
