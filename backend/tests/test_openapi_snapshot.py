"""The frontend API types are generated from a committed OpenAPI snapshot; it must follow the backend."""

import json

import pytest

from app import openapi_export


def test_the_committed_openapi_snapshot_matches_the_application() -> None:
    if not openapi_export.SNAPSHOT.exists():
        pytest.skip("frontend/openapi.json is not part of this checkout")
    assert openapi_export.SNAPSHOT.read_text(encoding="utf-8") == openapi_export.document(), (
        "frontend/openapi.json is stale: run `pnpm api:generate` in frontend/ and commit the result"
    )


def test_every_json_operation_describes_its_response() -> None:
    """No JSON endpoint may answer with an anonymous object or list of them: the generated types would not know
    its fields. (Files and streams have an empty schema and are not JSON documents.)"""
    untyped = []
    for path, operations in json.loads(openapi_export.document())["paths"].items():
        for method, operation in operations.items():
            for status, response in operation["responses"].items():
                schema = response.get("content", {}).get("application/json", {}).get("schema")
                if not status.startswith("2") or not schema:
                    continue
                described = schema.get("items", schema)
                if described.get("type") == "object" and "properties" not in described:
                    untyped.append(f"{method.upper()} {path}")
    assert not untyped, untyped
