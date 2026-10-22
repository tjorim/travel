import asyncio
import json
import logging

import httpx
import pytest
from fastapi.testclient import TestClient
from test_publication import client_for

from app.config import Settings
from app.main import app
from app.translation import (
    Piece,
    TranslationCancelled,
    TranslationError,
    TranslationService,
    chunks,
    get_translation_service,
    plan,
)

BASE = "http://translation.internal:5000"
SECRET = "Geheim hotel in Taipei"


def teardown_function() -> None:
    app.dependency_overrides.clear()


def service_with(handler, **settings) -> TranslationService:
    config = Settings(translation_api_base=BASE, **settings)
    return TranslationService(config, transport=httpx.MockTransport(handler))


def fake_translate(requests: list[dict]):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == f"{BASE}/translate"
        payload = json.loads(request.content)
        requests.append(payload)
        return httpx.Response(200, json={"translatedText": f"EN({payload['q']})"})

    return handler


def use(service: TranslationService) -> TestClient:
    app.dependency_overrides[get_translation_service] = lambda: service
    return client_for("owner-1")


def test_translates_prose_one_piece_at_a_time_and_keeps_markdown_structure() -> None:
    requests: list[dict] = []
    client = use(service_with(fake_translate(requests)))
    source = "\n".join(
        [
            "# Dag een",
            "",
            "Wij kwamen **laat** aan.  ",
            "- [ ] Koffers uitpakken",
            "> Mooi uitzicht",
            "```",
            "niet vertalen",
            "```",
            "| Plaats | Tijd |",
            "| --- | --- |",
            "| Taipei | 10:00 |",
            "https://example.test/kaart",
            "---",
            "Wij kwamen **laat** aan.  ",
        ]
    )
    response = client.post("/api/translation/drafts", json={"text": source, "source": "nl", "target": "en"})
    assert response.status_code == 200, response.text
    assert response.json() == {
        "text": "\n".join(
            [
                "# EN(Dag een)",
                "",
                "EN(Wij kwamen **laat** aan.)  ",
                "- [ ] EN(Koffers uitpakken)",
                "> EN(Mooi uitzicht)",
                "```",
                "niet vertalen",
                "```",
                "| EN(Plaats) | EN(Tijd) |",
                "| --- | --- |",
                "| EN(Taipei) | 10:00 |",
                "https://example.test/kaart",
                "---",
                "EN(Wij kwamen **laat** aan.)  ",
            ]
        ),
        "source": "nl",
        "target": "en",
        "machine_translated": True,
    }
    assert all(item["source"] == "nl" and item["target"] == "en" and item["format"] == "text" for item in requests)
    # The repeated sentence is translated once.
    assert [item["q"] for item in requests].count("Wij kwamen **laat** aan.") == 1


def test_long_paragraphs_are_split_on_sentences() -> None:
    assert chunks("Een. Twee. Drie.", 100) == ["Een. Twee. Drie."]
    assert chunks("Een zin. Nog een zin. Laatste zin.", 22) == ["Een zin. Nog een zin.", "Laatste zin."]
    assert chunks("Eenzeergrotezinzonderpunt", 5) == ["Eenzeergrotezinzonderpunt"]

    requests: list[dict] = []
    service = service_with(fake_translate(requests), translation_segment_characters=22)
    result = asyncio.run(service.translate("Een zin. Nog een zin. Laatste zin.", "nl", "en"))
    assert [item["q"] for item in requests] == ["Een zin. Nog een zin.", "Laatste zin."]
    assert result == "EN(Een zin. Nog een zin.) EN(Laatste zin.)"


def test_a_request_is_refused_when_translation_is_not_configured() -> None:
    client = use(TranslationService(Settings(translation_api_base=None)))
    response = client.post("/api/translation/drafts", json={"text": SECRET, "source": "nl", "target": "en"})
    assert response.status_code == 503
    assert response.json()["errors"][0]["code"] == "translation_is_not_configured"


def test_an_unreachable_service_leaves_a_safe_error_without_the_text(caplog) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"cannot reach {request.content!r}", request=request)

    client = use(service_with(refuse))
    with caplog.at_level(logging.DEBUG):
        response = client.post("/api/translation/drafts", json={"text": SECRET, "source": "nl", "target": "en"})
    assert response.status_code == 503
    assert response.json()["errors"][0]["code"] == "translation_service_is_unavailable"
    assert SECRET not in response.text and SECRET not in caplog.text


def test_service_errors_and_malformed_answers_are_typed_failures() -> None:
    for reply, code in (
        (httpx.Response(500, json={"error": SECRET}), "translation_service_is_unavailable"),
        (
            httpx.Response(200, content=f"not json {SECRET}".encode()),
            "translation_service_returned_an_invalid_response",
        ),
        (httpx.Response(200, json={"translatedText": 3}), "translation_service_returned_an_invalid_response"),
        (httpx.Response(200, json={"translatedText": "  "}), "translation_service_returned_an_invalid_response"),
        (httpx.Response(200, json=[SECRET]), "translation_service_returned_an_invalid_response"),
    ):
        client = use(service_with(lambda request, reply=reply: reply))
        response = client.post("/api/translation/drafts", json={"text": SECRET, "source": "nl", "target": "en"})
        assert response.status_code == 503
        assert response.json()["errors"][0]["code"] == code
        assert SECRET not in response.text


def test_the_request_is_validated_and_needs_the_owner() -> None:
    client = use(service_with(fake_translate([])))
    same = client.post("/api/translation/drafts", json={"text": "Hallo", "source": "nl", "target": "nl"})
    assert same.status_code == 422
    assert same.json()["errors"][0]["code"] == "translation_languages_must_differ"
    assert client.post("/api/translation/drafts", json={"text": "", "source": "nl", "target": "en"}).status_code == 422
    assert (
        client.post("/api/translation/drafts", json={"text": "Hallo", "source": "de", "target": "en"}).status_code
        == 422
    )
    too_long = client.post("/api/translation/drafts", json={"text": "a" * 8001, "source": "nl", "target": "en"})
    assert too_long.status_code == 422

    app.dependency_overrides.clear()
    anonymous = TestClient(app).post("/api/translation/drafts", json={"text": "Hallo", "source": "nl", "target": "en"})
    assert anonymous.status_code == 401


def test_a_departed_caller_stops_the_remaining_pieces() -> None:
    requests: list[dict] = []
    service = service_with(fake_translate(requests))
    calls = 0

    async def departs_after_one_piece() -> bool:
        nonlocal calls
        calls += 1
        return calls > 1

    try:
        asyncio.run(service.translate("Een\nTwee\nDrie", "nl", "en", cancelled=departs_after_one_piece))
    except TranslationCancelled:
        pass
    else:
        raise AssertionError("Expected cancellation")
    assert len(requests) == 1


def test_concurrent_requests_are_translated_one_at_a_time() -> None:
    state = {"running": 0, "peak": 0}

    class SlowTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            state["running"] += 1
            state["peak"] = max(state["peak"], state["running"])
            await asyncio.sleep(0.02)
            state["running"] -= 1
            return httpx.Response(200, json={"translatedText": "ok"}, request=request)

    service = TranslationService(Settings(translation_api_base=BASE), transport=SlowTransport())

    async def run() -> list[str]:
        return await asyncio.gather(*(service.translate(f"Tekst {n}\nNog {n}", "nl", "en") for n in range(3)))

    assert asyncio.run(run()) == ["ok\nok"] * 3
    assert state["peak"] == 1


def test_only_prose_is_translated_and_whitespace_is_kept() -> None:
    assert plan("12:30\n  Hallo  ") == [["", "12:30"], ["  ", Piece("", "Hallo", "  ")]]
    assert plan("Hallo\r\nDag") == [["", Piece("", "Hallo", "")], ["", Piece("", "Dag", "")]]


def test_backend_key_is_sent_only_in_body_and_failures_are_sanitized(tmp_path, caplog) -> None:
    key_file = tmp_path / "translation-key"
    key_file.write_text("t" * 64, encoding="utf-8")
    calls = []

    def handler(request):
        calls.append(request)
        assert json.loads(request.content)["api_key"] == "t" * 64
        assert "t" * 64 not in str(request.url)
        return httpx.Response(403, text=SECRET + "t" * 64)

    client = use(service_with(handler, translation_api_key_file=str(key_file)))
    with caplog.at_level(logging.DEBUG):
        response = client.post("/api/translation/drafts", json={"text": SECRET, "source": "nl", "target": "en"})
    assert response.status_code == 503 and len(calls) == 1
    assert "t" * 64 not in response.text + caplog.text
    assert SECRET not in response.text + caplog.text
    key_file.unlink()
    response = client.post("/api/translation/drafts", json={"text": SECRET, "source": "nl", "target": "en"})
    assert response.status_code == 503 and len(calls) == 1


def test_redirects_are_not_followed_or_retried() -> None:
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(307, headers={"Location": "https://untrusted.invalid/translate"})

    client = use(service_with(handler))
    response = client.post("/api/translation/drafts", json={"text": SECRET, "source": "nl", "target": "en"})
    assert response.status_code == 503 and len(calls) == 1


def test_total_deadline_includes_all_pieces_and_queue_wait() -> None:
    calls = []

    async def handler(request):
        calls.append(request)
        await asyncio.sleep(0.02)
        return httpx.Response(200, json={"translatedText": "Hello"})

    service = service_with(handler, translation_timeout_seconds=0.03)

    async def run():
        with pytest.raises(TranslationError):
            await service.translate("Een\nTwee", "nl", "en")
        assert len(calls) == 2 and not service._turn.locked()
        async with service._turn:
            with pytest.raises(TranslationError):
                await service.translate("Wacht", "nl", "en")
        assert len(calls) == 2

    asyncio.run(run())


def test_transport_configuration_ignores_ambient_proxy(monkeypatch) -> None:
    real_client = httpx.AsyncClient

    def client_factory(**kwargs):
        assert kwargs["trust_env"] is False and kwargs["follow_redirects"] is False
        assert kwargs["timeout"].connect == 5
        return real_client(**kwargs)

    monkeypatch.setattr("app.translation.httpx.AsyncClient", client_factory)
    assert asyncio.run(service_with(fake_translate([])).translate("Hallo", "nl", "en")) == "EN(Hallo)"
