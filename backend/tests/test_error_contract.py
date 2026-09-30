"""Contract coverage independent of diagnostic wording and UI languages."""

import ast
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field
from pydantic_core import PydanticCustomError
from starlette.exceptions import HTTPException

from app.errors import ApiException, http_error_handler, service_exception, validation_error_handler
from app.media.providers import GooglePhotosPickerProvider, ProviderError
from app.schemas import require_visit_times


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
    assert TestClient(app).get("/missing").json()["errors"][0]["code"] == "http_error"


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


def test_every_app_owned_http_failure_declares_a_code():
    root = Path(__file__).parents[1] / "app"
    for path in [*root.joinpath("routers").glob("*.py"), root / "auth.py", root / "main.py", root / "media/ranges.py"]:
        for node in ast.walk(ast.parse(path.read_text())):
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
