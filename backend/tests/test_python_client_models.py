"""`python-travel` keeps a small hand-written copy of the wire models it reads, because it is published on its own and
cannot import the backend. This holds each copy to the API's OpenAPI schema instead: a field the client requires must
be one the API always sends, and a field the API may leave null must be one the client accepts as null."""

import types
import typing

import pytest
from travel_client import models

from app.main import app

# Each wire model, with the response model it reads. A client may name fewer fields than the API sends.
READS = {
    models.Identity: "OwnerIdentityResponse",
    models.Trip: "TripSummaryResponse",
    models.TaskLink: "StoredTaskLink",
    models.Task: "TripTaskResponse",
    models.PackingList: "PackingListResponse",
    models.PackingItem: "PackingItemResponse",
    models.LiveSession: "LiveSessionResponse",
    models.PositionResult: "LivePositionAccepted",
}


def accepts_null(annotation: object) -> bool:
    return annotation is type(None) or (
        typing.get_origin(annotation) in (typing.Union, types.UnionType) and type(None) in typing.get_args(annotation)
    )


def schema_allows_null(prop: dict) -> bool:
    return prop.get("type") == "null" or any(branch.get("type") == "null" for branch in prop.get("anyOf", []))


@pytest.mark.parametrize(("wire", "schema_name"), READS.items(), ids=lambda value: getattr(value, "__name__", value))
def test_a_client_wire_model_matches_the_api_schema(wire: type, schema_name: str) -> None:
    schema = app.openapi()["components"]["schemas"][schema_name]
    properties, required = schema["properties"], set(schema.get("required", []))
    for name, field in wire.model_fields.items():
        assert name in properties, f"{wire.__name__}.{name} is not a field of {schema_name}"
        assert name in required, f"{schema_name}.{name} is not always sent, but {wire.__name__} requires it"
        if schema_allows_null(properties[name]):
            assert accepts_null(field.annotation), f"{schema_name}.{name} may be null; {wire.__name__} must accept it"
