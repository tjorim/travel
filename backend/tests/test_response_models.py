"""Every JSON route documents its success response, and every optional response field says why it is optional."""

import json

import pytest

from app import openapi_export


def _unstructured(schema: dict) -> bool:
    if not schema:
        return True
    if "$ref" in schema:
        return False
    for union in ("anyOf", "oneOf", "allOf"):
        if union in schema:
            return any(_unstructured(branch) for branch in schema[union])
    if schema.get("type") == "array":
        return _unstructured(schema.get("items", {}))
    if schema.get("type") == "object":
        return not schema.get("properties") and (
            not isinstance(schema.get("additionalProperties"), dict) or _unstructured(schema["additionalProperties"])
        )
    return schema.get("type") not in {"string", "number", "integer", "boolean", "null"}


def _undocumented_responses(document: dict) -> list[str]:
    untyped = []
    for path, operations in document["paths"].items():
        for method, operation in operations.items():
            for status, response in operation["responses"].items():
                if not status.startswith("2") or status == "204":
                    continue
                content = response.get("content", {})
                if content and "application/json" not in content:
                    continue
                schema = content.get("application/json", {}).get("schema", {})
                if _unstructured(schema):
                    untyped.append(f"{method.upper()} {path} -> {status}")
    return untyped


NON_RECORD_RESPONSES = {
    (
        "get",
        "/api/trips/{trip_id}/export",
    ): "Deliberate streaming archive download; versioned export format is tested separately.",
    ("post", "/api/trips/{trip_id}/export/pdf"): "PDF download stream.",
    (
        "get",
        "/api/trips/{trip_id}/public-projection/preview/files/{local_id}",
    ): "File download or redirect, not a JSON API record.",
    (
        "post",
        "/api/trips/{trip_id}/public-projection/preview/files/{local_id}",
    ): "File download or redirect, not a JSON API record.",
    (
        "post",
        "/api/trips/{trip_id}/public-projection/preview/navigation/{local_id}",
    ): "Navigation redirect or confirmation page.",
    (
        "get",
        "/api/trips/{trip_id}/public-projection/preview/navigation/{local_id}",
    ): "Navigation redirect or confirmation page.",
    (
        "get",
        "/api/trips/{trip_id}/share-links/{link_id}/preview/files/{local_id}",
    ): "File download or redirect, not a JSON API record.",
    (
        "post",
        "/api/trips/{trip_id}/share-links/{link_id}/preview/files/{local_id}",
    ): "File download or redirect, not a JSON API record.",
    (
        "post",
        "/api/trips/{trip_id}/share-links/{link_id}/preview/navigation/{local_id}",
    ): "Navigation redirect or confirmation page.",
    (
        "get",
        "/api/trips/{trip_id}/share-links/{link_id}/preview/navigation/{local_id}",
    ): "Navigation redirect or confirmation page.",
    (
        "post",
        "/api/collections/{collection_id}/members/{member_id}/preview/files/{local_id}",
    ): "File download or redirect, not a JSON API record.",
    (
        "get",
        "/api/collections/{collection_id}/members/{member_id}/preview/files/{local_id}",
    ): "File download or redirect, not a JSON API record.",
    (
        "post",
        "/api/collections/{collection_id}/members/{member_id}/preview/navigation/{local_id}",
    ): "Navigation redirect or confirmation page.",
    (
        "get",
        "/api/collections/{collection_id}/members/{member_id}/preview/navigation/{local_id}",
    ): "Navigation redirect or confirmation page.",
    ("get", "/api/public/trips/{slug}/files/{local_id}"): "File download or redirect, not a JSON API record.",
    ("get", "/api/shared/{token}/files/{local_id}"): "File download or redirect, not a JSON API record.",
    ("get", "/api/public/trips/{slug}/feed.atom"): "Atom XML feed.",
    ("get", "/api/shared/{token}/feed.atom"): "Atom XML feed.",
    (
        "get",
        "/api/shared/{token}/trips/{member_id}/files/{local_id}",
    ): "File download or redirect, not a JSON API record.",
    ("get", "/api/documents/{document_id}/original"): "File download or redirect, not a JSON API record.",
    (
        "get",
        "/api/trips/{trip_id}/documents/{document_id}/original",
    ): "File download or redirect, not a JSON API record.",
    ("get", "/api/library/documents/{document_id}/original"): "File download or redirect, not a JSON API record.",
    ("get", "/api/trips/{trip_id}/media/{media_id}/original"): "File download or redirect, not a JSON API record.",
    ("get", "/api/trips/{trip_id}/media/{media_id}/thumbnail"): "File download or redirect, not a JSON API record.",
    (
        "get",
        "/api/trips/{trip_id}/media/{media_id}/derivatives/{derivative_id}/file",
    ): "File download or redirect, not a JSON API record.",
    (
        "get",
        "/api/trips/{trip_id}/media/{media_id}/derivatives/{derivative_id}/poster",
    ): "File download or redirect, not a JSON API record.",
}


def test_every_json_operation_describes_its_response() -> None:
    document = json.loads(openapi_export.document())
    untyped = set(_undocumented_responses(document))
    exceptions = {f"{method.upper()} {path} -> 200" for method, path in NON_RECORD_RESPONSES}
    assert not untyped - exceptions, sorted(untyped - exceptions)
    assert not exceptions - untyped, "Remove stale non-record response exceptions: " + str(exceptions - untyped)


@pytest.mark.parametrize(
    "schema",
    [
        None,
        {},
        {"type": "object"},
        {"type": "object", "properties": {}},
        {"title": "Undocumented"},
        {"type": "object", "additionalProperties": {}},
        {"anyOf": [{"type": "null"}, {}]},
        {"type": "array", "items": {}},
        {"type": "array", "items": {"type": "object"}},
    ],
)
def test_undocumented_json_is_rejected(schema) -> None:
    media = {} if schema is None else {"schema": schema}
    document = {"paths": {"/example": {"get": {"responses": {"200": {"content": {"application/json": media}}}}}}}
    assert _undocumented_responses(document) == ["GET /example -> 200"]


@pytest.mark.parametrize(
    "response,status",
    [
        ({}, "200"),
        ({"content": {"application/json": {}}}, "200"),
    ],
)
def test_missing_json_schema_is_rejected(response, status) -> None:
    assert _undocumented_responses({"paths": {"/example": {"get": {"responses": {status: response}}}}})


@pytest.mark.parametrize(
    "response,status",
    [
        ({}, "204"),
        ({"content": {"application/octet-stream": {"schema": {}}}}, "200"),
        ({"content": {"text/event-stream": {"schema": {}}}}, "200"),
        *[
            ({"content": {"application/json": {"schema": schema}}}, "200")
            for schema in [
                {"type": "string"},
                {"type": "boolean"},
                {"type": "integer"},
                {"type": "null"},
                {"type": "array", "items": {"type": "string"}},
                {"$ref": "#/components/schemas/Record"},
                {"type": "object", "additionalProperties": {"type": "integer"}},
            ]
        ],
    ],
)
def test_described_and_non_json_responses_are_accepted(response, status) -> None:
    assert not _undocumented_responses({"paths": {"/example": {"get": {"responses": {status: response}}}}})


# Every exception describes real omission, never merely a Python default. Keep this per-field
# allowlist explicit: new optional fields and stale exceptions both fail below.
OPTIONAL_ON_THE_WIRE = {
    ("AuditEventDetails", "audiences"): "Event-kind-specific detail; omitted when the event does not set it.",
    ("AuditEventDetails", "changed"): "Event-kind-specific detail; omitted when the event does not set it.",
    ("AuditEventDetails", "changes"): "Event-kind-specific detail; omitted when the event does not set it.",
    ("AuditEventDetails", "exclusions"): "Event-kind-specific detail; omitted when the event does not set it.",
    ("AuditEventDetails", "from"): "Event-kind-specific detail; omitted when the event does not set it.",
    ("AuditEventDetails", "merged"): "Event-kind-specific detail; omitted when the event does not set it.",
    ("AuditEventDetails", "newly_reached"): "Event-kind-specific detail; omitted when the event does not set it.",
    ("AuditEventDetails", "no_longer_reached"): "Event-kind-specific detail; omitted when the event does not set it.",
    ("AuditEventDetails", "others"): "Event-kind-specific detail; omitted when the event does not set it.",
    ("AuditEventDetails", "record_kind"): "Event-kind-specific detail; omitted when the event does not set it.",
    ("AuditEventDetails", "scope_version_after"): "Event-kind-specific detail; omitted when the event does not set it.",
    (
        "AuditEventDetails",
        "scope_version_before",
    ): "Event-kind-specific detail; omitted when the event does not set it.",
    ("AuditEventDetails", "to"): "Event-kind-specific detail; omitted when the event does not set it.",
    ("AuditMergedRecord", "widened"): "Event-kind-specific detail; omitted when the event does not set it.",
    ("CollectionIndexDocument", "title_lang"): "Omitted unless authored text falls back to the other language.",
    ("CollectionIndexEntry", "summary_lang"): "Omitted unless authored text falls back to the other language.",
    ("CollectionIndexEntry", "title_lang"): "Omitted unless authored text falls back to the other language.",
    (
        "HTTPValidationError",
        "detail",
    ): "FastAPI/Pydantic validation error envelope; keys depend on the validation failure.",
    ("ProjectionAddress", "admin_area"): "Audience-selected field; omitted unless this record and scope deliver it. ",
    ("ProjectionAddress", "line1"): "Audience-selected field; omitted unless this record and scope deliver it. ",
    ("ProjectionAddress", "line2"): "Audience-selected field; omitted unless this record and scope deliver it. ",
    ("ProjectionAddress", "locality"): "Audience-selected field; omitted unless this record and scope deliver it. ",
    ("ProjectionAddress", "postal_code"): "Audience-selected field; omitted unless this record and scope deliver it. ",
    ("ProjectionArea", "label_lang"): "Omitted unless authored text falls back to the other language.",
    (
        "ProjectionArea",
        "local_name",
    ): "Audience-selected field; omitted unless this record and scope deliver it. The name of the place as written where it is, present only beside a delivered `label` (it follows the label's visibility) and only when the owner entered one. It is in no particular language, so the page sets no `lang` on it.",
    ("ProjectionDocument", "current_locations"): "Omitted unless this audience receives a current live location.",
    ("ProjectionDocument", "numbers"): "Omitted unless the owner selected visitor figures.",
    ("ProjectionDocument", "summary_lang"): "Omitted unless authored text falls back to the other language.",
    ("ProjectionDocument", "title_lang"): "Omitted unless authored text falls back to the other language.",
    ("ProjectionMedia", "alt_text_lang"): "Omitted unless authored text falls back to the other language.",
    ("ProjectionMedia", "caption_lang"): "Omitted unless authored text falls back to the other language.",
    (
        "ProjectionMedia",
        "duration_seconds",
    ): "Audience-selected field; omitted unless this record and scope deliver it. Only a video.",
    (
        "ProjectionMedia",
        "image",
    ): "Audience-selected field; omitted unless this record and scope deliver it. Only a photo.",
    (
        "ProjectionMedia",
        "poster",
    ): "Audience-selected field; omitted unless this record and scope deliver it. Only a video: its still frame.",
    (
        "ProjectionMedia",
        "update",
    ): "Audience-selected field; omitted unless this record and scope deliver it. The id of the shared `updates` record this photo travels with.",
    (
        "ProjectionMedia",
        "video",
    ): "Audience-selected field; omitted unless this record and scope deliver it. Only a video.",
    (
        "ProjectionPlace",
        "address",
    ): "Audience-selected field; omitted unless this record and scope deliver it. Only a location whose owner shares its address.",
    ("ProjectionPlace", "label_lang"): "Omitted unless authored text falls back to the other language.",
    (
        "ProjectionPlace",
        "local_name",
    ): "Audience-selected field; omitted unless this record and scope deliver it. The name of the place as written where it is, present only beside a delivered `label` (it follows the label's visibility) and only when the owner entered one. It is in no particular language, so the page sets no `lang` on it.",
    (
        "ProjectionRoute",
        "arrival_timezone",
    ): "Audience-selected field; omitted unless this record and scope deliver it. With `departs_at`.",
    (
        "ProjectionRoute",
        "arrives_at",
    ): "Audience-selected field; omitted unless this record and scope deliver it. With `departs_at`.",
    (
        "ProjectionRoute",
        "date_precision",
    ): "Audience-selected field; omitted unless this record and scope deliver it. With `departs_on`.",
    (
        "ProjectionRoute",
        "departs_at",
    ): "Audience-selected field; omitted unless this record and scope deliver it. An instant (ISO 8601, UTC); only to an audience that may read days.",
    (
        "ProjectionRoute",
        "departs_on",
    ): "Audience-selected field; omitted unless this record and scope deliver it. Only a route that has a departure day.",
    (
        "ProjectionRoute",
        "departure_timezone",
    ): "Audience-selected field; omitted unless this record and scope deliver it. With `departs_at`.",
    (
        "ProjectionRoute",
        "geometry",
    ): "Audience-selected field; omitted unless this record and scope deliver it. Only a route with a drawn line.",
    ("ProjectionRoute", "label_lang"): "Omitted unless authored text falls back to the other language.",
    (
        "ProjectionRoute",
        "map",
    ): "Audience-selected field; omitted unless this record and scope deliver it. Only a route with a shared location at an end.",
    ("ProjectionRoutePoint", "label_lang"): "Omitted unless authored text falls back to the other language.",
    (
        "ProjectionRoutePoint",
        "local_name",
    ): "Audience-selected field; omitted unless this record and scope deliver it. The name of the place as written where it is, present only beside a delivered `label` (it follows the label's visibility) and only when the owner entered one. It is in no particular language, so the page sets no `lang` on it.",
    (
        "ProjectionStay",
        "location",
    ): "Audience-selected field; omitted unless this record and scope deliver it. Only a location this audience receives.",
    ("ProjectionStay", "title_lang"): "Omitted unless authored text falls back to the other language.",
    ("ProjectionUpdate", "body_lang"): "Omitted unless authored text falls back to the other language.",
    (
        "ProjectionUpdate",
        "location",
    ): "Audience-selected field; omitted unless this record and scope deliver it. Only a location this audience receives.",
    ("ProjectionUpdate", "title_lang"): "Omitted unless authored text falls back to the other language.",
    (
        "ProjectionVisit",
        "end_time",
    ): "Audience-selected field; omitted unless this record and scope deliver it. With `start_time`; null when the visit has no end time.",
    (
        "ProjectionVisit",
        "ends_on",
    ): "Audience-selected field; omitted unless this record and scope deliver it. With `starts_on`; null for a visit that has no end.",
    (
        "ProjectionVisit",
        "location",
    ): "Audience-selected field; omitted unless this record and scope deliver it. Only a location this audience receives.",
    (
        "ProjectionVisit",
        "start_time",
    ): "Audience-selected field; omitted unless this record and scope deliver it. HH:MM local at the visit; only when the owner shares the time, at day precision.",
    (
        "ProjectionVisit",
        "starts_on",
    ): "Audience-selected field; omitted unless this record and scope deliver it. Only a visit that has a start day.",
    ("ProjectionVisit", "summary_lang"): "Omitted unless authored text falls back to the other language.",
    (
        "ProjectionVisit",
        "timezone",
    ): "Audience-selected field; omitted unless this record and scope deliver it. With `start_time`: the zone those times are local in.",
    ("ProjectionVisit", "title_lang"): "Omitted unless authored text falls back to the other language.",
    ("PublicTripCard", "summary_lang"): "Omitted unless authored text falls back to the other language.",
    ("PublicTripCard", "title_lang"): "Omitted unless authored text falls back to the other language.",
    ("PublicTripCover", "alt_text_lang"): "Omitted unless authored text falls back to the other language.",
    ("ShareScope", "defaults"): "Stored owner setting; omitted when the owner has not configured it.",
    ("ShareScope", "exclude"): "Stored owner setting; omitted when the owner has not configured it.",
    ("ShareScope", "numbers"): "Stored owner setting; omitted when the owner has not configured it.",
    ("ValidationError", "ctx"): "FastAPI/Pydantic validation error envelope; keys depend on the validation failure.",
    ("ValidationError", "input"): "FastAPI/Pydantic validation error envelope; keys depend on the validation failure.",
}


def _response_schema_names(document: dict) -> set[str]:
    def refs(node):
        if isinstance(node, dict):
            found = {node["$ref"].rsplit("/", 1)[-1]} if "$ref" in node else set()
            return found.union(*(refs(value) for value in node.values()))
        if isinstance(node, list):
            return set().union(*(refs(value) for value in node))
        return set()

    pending = set().union(
        *(refs(operation.get("responses", {})) for item in document["paths"].values() for operation in item.values())
    )
    reached = set()
    while pending:
        name = pending.pop()
        if name not in reached:
            reached.add(name)
            pending |= refs(document["components"]["schemas"][name])
    return reached


def test_all_optional_response_fields_are_justified() -> None:
    document = json.loads(openapi_export.document())
    schemas = document["components"]["schemas"]
    optional = {
        (name, field)
        for name in _response_schema_names(document)
        for field in schemas[name].get("properties", {})
        if field not in schemas[name].get("required", [])
    }
    assert not optional - OPTIONAL_ON_THE_WIRE.keys(), sorted(optional - OPTIONAL_ON_THE_WIRE.keys())
    assert not OPTIONAL_ON_THE_WIRE.keys() - optional, sorted(OPTIONAL_ON_THE_WIRE.keys() - optional)
    assert all(OPTIONAL_ON_THE_WIRE.values())


def test_a_response_field_with_a_default_is_required_in_the_schema() -> None:
    """A default is how the server fills a field, not a reason for the client to treat it as maybe absent."""
    document = json.loads(openapi_export.document())
    schemas = document["components"]["schemas"]
    defaulted = {
        (name, field)
        for name in _response_schema_names(document)
        for field, spec in schemas[name].get("properties", {}).items()
        if "default" in spec and field not in schemas[name].get("required", [])
    }
    assert not defaulted - OPTIONAL_ON_THE_WIRE.keys(), sorted(defaulted - OPTIONAL_ON_THE_WIRE.keys())


def test_response_schema_changes_preserve_defaults_and_request_optionality() -> None:
    from app.routers.auth import OidcDiscoveryConfig
    from app.schemas import AreaInput, GeoJsonLineString, SuggestedArea

    area = {"label": "Synthetic city", "latitude": 12.0, "longitude": 34.0}
    assert SuggestedArea.model_validate(area).model_dump() == AreaInput.model_validate(area).model_dump()
    assert "type" not in GeoJsonLineString.model_json_schema(mode="validation")["required"]
    assert "type" in GeoJsonLineString.model_json_schema(mode="serialization")["required"]
    line = GeoJsonLineString(coordinates=[(1.0, 2.0), (3.0, 4.0)])
    assert line.model_dump()["type"] == "LineString"
    config = OidcDiscoveryConfig(
        issuer="https://auth.example.test",
        authorization_url="https://auth.example.test/a",
        token_url="https://auth.example.test/t",
        client_id="synthetic",
    )
    assert config.model_dump()["end_session_url"] is None
