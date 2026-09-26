import inspect
import typing

import pytest
from fastapi.routing import APIRoute
from pydantic import BaseModel, ValidationError

from app import schemas
from app.main import app
from app.mcp_server import TravelMcpBackend


def _models_in(annotation: object) -> typing.Iterator[type[BaseModel]]:
    """Every pydantic model a type annotation names, including inside lists, unions and forward references."""
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        yield annotation
    for argument in typing.get_args(annotation):
        yield from _models_in(argument)


def _with_nested(roots: typing.Iterable[type[BaseModel]]) -> set[type[BaseModel]]:
    """The models themselves and every model reachable through their fields."""
    found: set[type[BaseModel]] = set()
    pending = list(roots)
    while pending:
        model = pending.pop()
        if model in found:
            continue
        found.add(model)
        for field in model.model_fields.values():
            pending.extend(_models_in(field.annotation))
    return found


# Responses that reuse an input model's fields. They read stored data, so they ignore extra keys,
# and they must never be accepted from a client.
READ_ONLY = {
    schemas.LocationResponse,
    schemas.AreaResponse,
    schemas.StoredTaskLink,
    schemas.StoredGeoJsonLineString,
}


def _request_models() -> set[type[BaseModel]]:
    """Every model a client can send: REST bodies and MCP tool arguments, with their nested models."""
    roots: list[type[BaseModel]] = []
    pending = list(app.routes)
    while pending:
        route = pending.pop()
        if isinstance(route, APIRoute):
            for param in route.dependant.body_params:
                roots.extend(_models_in(param.field_info.annotation))
        # FastAPI keeps an included router as one entry that wraps the router's own routes.
        elif (included := getattr(route, "original_router", None)) is not None:
            pending.extend(included.routes)
    for name, method in inspect.getmembers(TravelMcpBackend, inspect.isfunction):
        if not name.startswith("_"):
            for annotation in typing.get_type_hints(method).values():
                roots.extend(_models_in(annotation))
    return _with_nested(roots)


def test_every_request_model_rejects_unknown_fields() -> None:
    models = _request_models()
    # Guard the walk itself: it must reach nested and MCP-only models too.
    assert {schemas.VisitUpdate, schemas.LocationInput, schemas.TaskLink, schemas.GeoJsonLineString} <= models
    # OAuthComplete is only a REST body, so this also proves the included routers were walked.
    assert {model.__name__ for model in models} >= {"BatchCreate", "BinaryUpload", "OAuthComplete"}
    assert not models & READ_ONLY
    # Also every InputModel, even one no route uses yet.
    inputs = models | {
        model for model in vars(schemas).values() if isinstance(model, type) and issubclass(model, schemas.InputModel)
    }
    lenient = sorted(model.__name__ for model in inputs - READ_ONLY if model.model_config.get("extra") != "forbid")
    assert lenient == []


def test_a_request_model_names_the_unknown_field() -> None:
    with pytest.raises(ValidationError) as caught:
        schemas.VisitUpdate.model_validate({"title": "x", "not_a_field": "idea"})
    assert [(error["loc"], error["type"]) for error in caught.value.errors()] == [(("not_a_field",), "extra_forbidden")]


def test_responses_still_read_stored_data_with_extra_keys() -> None:
    route = {"type": "LineString", "coordinates": [[4.0, 50.0], [5.0, 51.0]], "properties": {}}
    assert schemas.StoredGeoJsonLineString.model_validate(route).coordinates == [(4.0, 50.0), (5.0, 51.0)]
    link = {"label": "Tickets", "url": "https://example.com", "kind": "legacy"}
    assert schemas.StoredTaskLink.model_validate(link).label == "Tickets"
