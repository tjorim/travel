import json
import logging
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.logging import ACCESS_LOGGER, configure_logging
from app.main import app as travel_app
from app.middleware.request_id import REQUEST_ID_HEADER, RequestIdMiddleware, current_request_id

UUID4 = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")


def build_app() -> FastAPI:
    application = FastAPI()
    application.add_middleware(RequestIdMiddleware)

    @application.get("/items/{item_id}")
    def read_item(item_id: int) -> dict[str, str | None]:
        return {"seen": current_request_id.get()}

    @application.get("/boom")
    def boom() -> None:
        raise RuntimeError("secret-token")

    return application


def access_lines(caplog) -> list[dict]:
    return [json.loads(record.getMessage()) for record in caplog.records if record.name == ACCESS_LOGGER]


@pytest.fixture
def client() -> TestClient:
    return TestClient(build_app(), raise_server_exceptions=False)


def test_every_response_carries_a_generated_request_id(client) -> None:
    first = client.get("/items/1").headers[REQUEST_ID_HEADER]
    second = client.get("/items/1").headers[REQUEST_ID_HEADER]
    assert UUID4.fullmatch(first)
    assert first != second


def test_a_callers_request_id_is_kept_and_visible_below_the_request(client) -> None:
    response = client.get("/items/1", headers={REQUEST_ID_HEADER: "gateway-42.a:b_c"})
    assert response.headers[REQUEST_ID_HEADER] == "gateway-42.a:b_c"
    assert response.json() == {"seen": "gateway-42.a:b_c"}
    assert current_request_id.get() is None


@pytest.mark.parametrize("supplied", ["x" * 129, "has space", "new\\nline", "q=1;drop", '{"a":1}'])
def test_a_request_id_that_could_forge_a_log_line_is_replaced(client, supplied) -> None:
    response = client.get("/items/1", headers={REQUEST_ID_HEADER: supplied})
    assert UUID4.fullmatch(response.headers[REQUEST_ID_HEADER])


def test_the_access_line_has_the_shared_fields_and_the_route_template(client, caplog) -> None:
    with caplog.at_level(logging.INFO, logger=ACCESS_LOGGER):
        response = client.get("/items/7?token=secret", headers={REQUEST_ID_HEADER: "abc"})
    (line,) = access_lines(caplog)
    assert set(line) == {"event", "request_id", "method", "route", "status_code", "latency_ms"}
    assert line["event"] == "http_request"
    assert line["request_id"] == response.headers[REQUEST_ID_HEADER] == "abc"
    assert (line["method"], line["route"], line["status_code"]) == ("GET", "/items/{item_id}", 200)
    assert line["latency_ms"] >= 0
    assert "secret" not in json.dumps(line)


def test_failures_log_by_severity_without_the_raw_path(client, caplog) -> None:
    with caplog.at_level(logging.INFO, logger=ACCESS_LOGGER):
        client.get("/missing/capability-token-123")
        client.get("/items/not-a-number")
        client.get("/boom")
    missing, invalid, boom = access_lines(caplog)
    assert (missing["status_code"], missing["route"]) == (404, "unmatched")
    assert invalid["status_code"] == 422
    assert (boom["status_code"], boom["route"]) == (500, "/boom")
    assert [record.levelno for record in caplog.records] == [logging.WARNING, logging.WARNING, logging.ERROR]
    assert "capability-token-123" not in caplog.text
    assert "secret-token" not in caplog.text


def test_the_travel_api_answers_with_an_id_on_success_and_on_error(caplog) -> None:
    client = TestClient(travel_app, raise_server_exceptions=False)
    with caplog.at_level(logging.INFO, logger=ACCESS_LOGGER):
        ok = client.get("/api/health/liveness")
        denied = client.get("/api/identity", headers={REQUEST_ID_HEADER: "trace-1"})
    assert UUID4.fullmatch(ok.headers[REQUEST_ID_HEADER])
    assert denied.status_code == 401
    assert denied.headers[REQUEST_ID_HEADER] == "trace-1"
    assert [line["request_id"] for line in access_lines(caplog)][-1] == "trace-1"


def test_logging_setup_prints_the_access_line_only_when_nothing_else_would(monkeypatch) -> None:
    access = logging.getLogger(ACCESS_LOGGER)
    monkeypatch.setattr(access, "handlers", [])
    monkeypatch.setattr(logging.getLogger(), "handlers", [])
    configure_logging()
    configure_logging()
    assert len(access.handlers) == 1
    assert access.handlers[0].formatter._fmt == "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
