"""Contract coverage independent of diagnostic wording and UI languages."""

import ast
import logging
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field
from pydantic_core import PydanticCustomError
from starlette.exceptions import HTTPException

from app.core.errors import (
    ApiException,
    http_error_handler,
    service_exception,
    unhandled_error_handler,
    validation_error_handler,
)
from app.db.session import get_session
from app.main import app as travel_app
from app.middleware.request_id import RequestIdMiddleware
from app.schemas import require_visit_times
from app.services.media.providers import GooglePhotosPickerProvider, ProviderError


def contract_app():
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    return app


class Payload(BaseModel):
    title: str = Field(max_length=3)
    weight: int = Field(ge=0)


def test_validation_paths_constraints_and_redaction():
    app = contract_app()

    @app.post("/validate")
    def validate(body: Payload):
        return body

    response = TestClient(app).post("/validate", json={"title": "secret-token", "weight": -1})
    assert response.status_code == 422
    assert response.json()["errors"] == [
        {"code": "string_too_long", "path": ["body", "title"], "params": {"max_length": 3}},
        {"code": "greater_than_equal", "path": ["body", "weight"], "params": {"ge": 0}},
    ]
    assert "secret-token" not in response.text
    assert "input" not in response.json()["detail"][0]
    assert TestClient(app).post("/validate", json={}).json()["errors"][0]["code"] == "missing"
    broken = TestClient(app).post(
        "/validate", content='{"title": "secret-token", broken', headers={"Content-Type": "application/json"}
    )
    assert "secret-token" not in broken.text
    assert broken.json()["errors"][0]["code"] == "json_invalid"


def test_custom_validation_and_service_errors_preserve_codes():
    error = PydanticCustomError("arrival_must_be_after_departure", "Arrival must be after departure")
    converted = service_exception(422, error)
    assert converted.detail == str(error)
    assert converted.descriptor["code"] == "arrival_must_be_after_departure"
    # A shared schema helper used outside Pydantic must retain its typed cause.
    try:
        require_visit_times(None, None, "12:00", None)
    except PydanticCustomError as error:
        assert service_exception(422, error).descriptor["code"] == error.type


def test_status_only_and_privacy_headers_survive():
    app = contract_app()
    headers = {"Content-Range": "bytes */5", "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer"}

    @app.get("/range")
    def file_range():
        raise ApiException(416, headers=headers, code="range_unsatisfiable")

    response = TestClient(app).get("/range")
    assert response.status_code == 416
    assert response.json()["errors"] == [{"code": "range_unsatisfiable", "params": {}, "path": []}]
    for key, value in headers.items():
        assert response.headers[key] == value
    assert TestClient(app).get("/missing").json()["errors"][0]["code"] == "not_found"


def test_provider_diagnostics_never_expose_urls_or_tokens():
    def reply(request):
        return httpx.Response(500, request=request, text="Bearer secret-token https://private.example/share/capability")

    provider = GooglePhotosPickerProvider(
        api_base="https://private.example/share/capability",
        client=httpx.Client(base_url="https://private.example/share/capability", transport=httpx.MockTransport(reply)),
    )
    try:
        provider.create_session(access_token="secret-token")
    except ProviderError as error:
        converted = service_exception(502, error)
        assert converted.descriptor["code"] == "provider_failed"
        assert converted.detail == "Media provider request failed"
    else:
        raise AssertionError("Expected provider rejection")


def test_framework_http_errors_get_a_stable_code_and_keep_their_detail_and_headers():
    app = contract_app()

    @app.get("/status/{code}")
    def raise_status(code: int):
        raise HTTPException(code, "Plain diagnostic", headers={"WWW-Authenticate": "Bearer", "Retry-After": "7"})

    @app.get("/owned")
    def owned():
        raise ApiException(403, "Owned diagnostic", code="not_the_owner", params={"kind": "trip"})

    client = TestClient(app)
    for status, code in [
        (400, "bad_request"),
        (401, "unauthorized"),
        (403, "forbidden"),
        (404, "not_found"),
        (405, "method_not_allowed"),
        (418, "http_418"),
        (503, "http_503"),
    ]:
        response = client.get(f"/status/{status}")
        assert response.status_code == status
        assert response.json() == {
            "detail": "Plain diagnostic",
            "code": code,
            "errors": [{"code": code, "params": {}, "path": []}],
        }
        assert response.headers["WWW-Authenticate"] == "Bearer"
        assert response.headers["Retry-After"] == "7"
    # A code an application rule chose is never replaced by the one its status would get.
    assert client.get("/owned").json() == {
        "detail": "Owned diagnostic",
        "code": "not_the_owner",
        "errors": [{"code": "not_the_owner", "params": {"kind": "trip"}, "path": []}],
    }
    # An unmatched route and a wrong method come from the framework itself and keep Allow.
    assert client.get("/nowhere").json()["detail"] == "Not Found"
    wrong = client.post("/owned")
    assert (wrong.status_code, wrong.json()["code"], wrong.headers["Allow"]) == (405, "method_not_allowed", "GET")


def test_every_app_owned_http_failure_declares_a_code():
    root = Path(__file__).parents[1] / "app"
    for path in [
        *root.joinpath("routers").glob("*.py"),
        root / "core/auth.py",
        root / "main.py",
        root / "services/media/ranges.py",
    ]:
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                assert node.func.id != "HTTPException", (path, node.lineno)
                if node.func.id == "ApiException":
                    assert any(keyword.arg == "code" for keyword in node.keywords), (path, node.lineno)


def test_malformed_provider_responses_have_a_safe_typed_failure():
    for content in (b"not json secret-token", b'{"secret": "https://private.example/share/capability"}', b"[]"):

        def reply(request, content=content):
            return httpx.Response(200, request=request, content=content)

        provider = GooglePhotosPickerProvider(
            client=httpx.Client(base_url="https://provider.example", transport=httpx.MockTransport(reply))
        )
        try:
            provider.create_session(access_token="secret-token")
        except ProviderError as error:
            assert error.code == "provider_invalid_response"
            assert str(error) == "Media provider returned an invalid response"
        else:
            raise AssertionError("Expected invalid provider response")


def assert_error_body(body: dict) -> None:
    """The one error shape: ``detail``, a top-level ``code`` and ``errors`` entries of ``code``, ``params`` and ``path``."""
    assert set(body) == {"detail", "code", "errors"}
    assert body["code"] == body["errors"][0]["code"]
    assert body["errors"], body
    for entry in body["errors"]:
        assert set(entry) == {"code", "params", "path"}
        assert isinstance(entry["code"], str) and entry["code"]
        assert isinstance(entry["params"], dict)
        assert isinstance(entry["path"], list)


def test_the_assembled_app_answers_every_failure_in_one_shape_with_stable_codes():
    client = TestClient(travel_app, raise_server_exceptions=False)
    expected = [
        (client.get("/api/does-not-exist"), 404, "not_found"),
        (client.delete("/api/health"), 405, "method_not_allowed"),
        (client.get("/api/identity"), 401, "unauthorized"),
        (client.post("/api/trips", json={}), 401, "unauthorized"),
    ]
    for response, status, code in expected:
        assert response.status_code == status
        assert response.headers["content-type"] == "application/json"
        body = response.json()
        assert_error_body(body)
        assert body["errors"][0]["code"] == code


def test_the_assembled_app_answers_an_unhandled_exception_in_the_error_shape_with_the_request_id():
    def broken_session():
        raise RuntimeError("secret-token postgresql://user:password@db/travel")

    travel_app.dependency_overrides[get_session] = broken_session
    try:
        response = TestClient(travel_app, raise_server_exceptions=False).get(
            "/api/health/readiness", headers={"X-Request-ID": "assembled-500"}
        )
    finally:
        travel_app.dependency_overrides.pop(get_session, None)
    assert response.status_code == 500
    assert response.headers["X-Request-ID"] == "assembled-500"
    assert response.json()["code"] == "internal_error"
    assert response.json()["detail"] == "Internal server error"
    assert "secret-token" not in response.text


def test_failures_never_carry_a_stack_trace_or_a_secret():
    client = TestClient(travel_app, raise_server_exceptions=False)
    for response in (
        client.get("/api/does-not-exist"),
        client.get("/api/identity", headers={"Authorization": "Bearer secret-token"}),
    ):
        assert "secret-token" not in response.text
        for marker in ("Traceback", 'File "', "site-packages", "/app/", "sqlalchemy"):
            assert marker not in response.text


def test_an_unhandled_exception_answers_500_with_a_stable_code_and_the_request_id(caplog):
    # The same wiring as app.main: the catch-all handler is Starlette's outermost, outside RequestIdMiddleware.
    application = FastAPI()
    application.add_exception_handler(Exception, unhandled_error_handler)
    application.add_middleware(RequestIdMiddleware)

    @application.get("/boom")
    def boom():
        raise RuntimeError("secret-token postgresql://user:password@db/travel")

    with caplog.at_level(logging.ERROR, logger="app.core.errors"):
        response = TestClient(application, raise_server_exceptions=False).get(
            "/boom", headers={"X-Request-ID": "trace-500"}
        )
    assert response.status_code == 500
    assert response.headers["content-type"] == "application/json"
    assert response.headers["X-Request-ID"] == "trace-500"
    body = response.json()
    assert body["detail"] == "Internal server error"
    assert body["code"] == "internal_error"
    assert body["errors"] == [{"code": "internal_error", "params": {}, "path": []}]
    for secret in ("secret-token", "password", "Traceback", "RuntimeError"):
        assert secret not in response.text
    # The cause and its traceback stay on the server, tied to the request id.
    record = next(r for r in caplog.records if r.name == "app.core.errors")
    assert "trace-500" in record.getMessage()
    assert record.exc_info is not None and "secret-token" in str(record.exc_info[1])


def test_an_unhandled_exception_without_a_request_id_middleware_still_answers_500():
    application = FastAPI()
    application.add_exception_handler(Exception, unhandled_error_handler)

    @application.get("/boom")
    def boom():
        raise RuntimeError("secret-token")

    response = TestClient(application, raise_server_exceptions=False).get("/boom")
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    assert "X-Request-ID" not in response.headers
    assert "secret-token" not in response.text
