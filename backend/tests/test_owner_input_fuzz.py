"""Deterministic OpenAPI edge cases; SQLite always, isolated PostgreSQL when configured."""

import json
import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.database import Base, get_session
from app.main import app


@pytest.fixture(params=["sqlite", "postgres"])
def owner(request):
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL") or os.environ.get("TRAVEL_DATABASE_URL")
    if request.param == "postgres" and not (url and url.startswith("postgresql")):
        pytest.skip("PostgreSQL URL not configured")
    schema = "input_fuzz_" + uuid4().hex
    admin = None
    if request.param == "postgres":
        admin = create_engine(url)
        with admin.begin() as connection:
            connection.execute(text(f"CREATE SCHEMA {schema}"))
        engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    else:
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)

    def session():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_session] = session
    app.dependency_overrides[current_subject] = lambda: "synthetic-fuzz-owner"
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
        if admin:
            with admin.begin() as connection:
                connection.execute(text(f"DROP SCHEMA {schema} CASCADE"))
            admin.dispose()


def send(client, method, path, payload):
    # ASCII escaping keeps lone surrogates representable as JSON bytes.
    return client.request(method, path, content=json.dumps(payload), headers={"Content-Type": "application/json"})


def test_known_database_failures_are_field_errors(owner):
    trip = owner.post("/api/trips", json={"title": "Synthetic trip"}).json()
    base = f"/api/trips/{trip['id']}"
    area = owner.post(base + "/areas", json={"label": "Synthetic city"}).json()
    stay = owner.post(
        base + "/stays", json={"area_id": area["id"], "check_in_date": "2054-05-01", "check_out_date": "2054-05-02"}
    ).json()
    packing = owner.post(base + "/packing-lists", json={"name": "Synthetic packing"}).json()
    packing_path = base + f"/packing-lists/{packing['id']}"
    visit = owner.post(
        base + "/visits", json={"area_id": area["id"], "starts_on": "2054-05-01", "start_time": "10:00"}
    ).json()
    cases = [
        ("POST", packing_path + "/bags", {"name": "Bag", "weight_limit_g": 10**30}, "weight_limit_g"),
        ("POST", packing_path + "/items", {"label": "Item", "weight_g": 10**30}, "weight_g"),
        ("PATCH", base + f"/visits/{visit['id']}", {"end_time": 5}, "end_time"),
        ("PATCH", base + f"/stays/{stay['id']}", {"check_in_time": "15:00Z"}, "check_in_time"),
        ("POST", "/api/trips", {"title": "bad\x00text"}, "title"),
        ("PATCH", base, {"title": None}, "title"),
        ("PATCH", base + f"/stays/{stay['id']}", {"share_date_precision": None}, "share_date_precision"),
        (
            "POST",
            base + "/visits",
            {
                "title": "Visit",
                "area_id": area["id"],
                "starts_on": "2054-05-01",
                "start_time": "10:00",
                "end_time": "11:00Z",
            },
            "end_time",
        ),
        ("POST", base + "/visits", {"title": "Visit", "area_id": "\ud800"}, "area_id"),
    ]
    for method, path, payload, field in cases:
        response = send(owner, method, path, payload)
        assert response.status_code == 422, (path, response.text)
        assert any(error["path"] == ["body", field] for error in response.json()["errors"])


def test_openapi_owner_write_edges_never_return_5xx(owner):
    document = owner.get("/openapi.json").json()

    def resolve(schema):
        if "$ref" in schema:
            return resolve(document["components"]["schemas"][schema["$ref"].split("/")[-1]])
        if "anyOf" in schema:
            return resolve(next(item for item in schema["anyOf"] if item.get("type") != "null"))
        return schema

    def sample(schema):
        schema = resolve(schema)
        if "default" in schema and schema["default"] is not None:
            return schema["default"]
        if "enum" in schema:
            return schema["enum"][0]
        kind = schema.get("type")
        if kind == "object":
            return {key: sample(schema["properties"][key]) for key in schema.get("required", [])}
        if kind == "array":
            return [sample(schema["items"]) for _ in range(schema.get("minItems", 0))]
        if kind in {"integer", "number"}:
            return schema.get("minimum", 1)
        if kind == "boolean":
            return False
        return {
            "date": "2054-05-01",
            "date-time": "2054-05-01T10:00:00Z",
            "time": "10:00:00",
            "uri": "https://example.org",
        }.get(schema.get("format"), "Synthetic")

    trip = owner.post("/api/trips", json={"title": "Synthetic fuzz"}).json()
    count = 0
    for path, operations in document["paths"].items():
        if (
            not path.startswith("/api/")
            or path.startswith(("/api/shared/", "/api/public/", "/api/auth/"))
            or "/media" in path
        ):
            continue
        for method, operation in operations.items():
            if method not in {"post", "patch", "put"}:
                continue
            body = operation.get("requestBody", {}).get("content", {}).get("application/json")
            if not body:
                continue
            schema = resolve(body["schema"])
            url = path
            for parameter in operation.get("parameters", []):
                if parameter["in"] == "path":
                    url = url.replace(
                        "{" + parameter["name"] + "}", trip["id"] if parameter["name"] == "trip_id" else "a" * 32
                    )
            baseline = sample(schema)
            for field, definition in schema.get("properties", {}).items():
                resolved = resolve(definition)
                values = [None]
                if resolved.get("type") == "string":
                    values += ["bad\x00text", "\ud800", "\udfff"]
                    if resolved.get("format") == "time":
                        values += ["11:00:00Z", "11:00:00+02:00", 5]
                elif resolved.get("type") == "integer":
                    values += [10**30, -(10**30)]
                elif resolved.get("type") == "object":
                    values += [
                        {key: "bad\x00text"}
                        for key, nested in resolved.get("properties", {}).items()
                        if resolve(nested).get("type") == "string"
                    ]
                elif resolved.get("type") == "array":
                    values += [["\ud800"], ["bad\x00text"]]
                for value in values:
                    response = send(owner, method, url, {**baseline, field: value})
                    assert response.status_code < 500, (method, path, field, repr(value), response.text)
                    count += 1
    assert count > 500
    print(f"OpenAPI owner input fuzz: {count} requests, no 5xx")
