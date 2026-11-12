"""The visitor document is typed end to end (#361): its models are the allowlist of what a visitor can receive."""

import io
import typing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import BaseModel, ValidationError
from test_publication import (  # noqa: F401
    client_for,
    create_trip,
    item,
    scope,
    setup_function,
    share,
    teardown_function,
)

from app import schemas
from app.main import app
from app.storage import LocalObjectStorage, get_storage

RECORDS = {
    "visits": schemas.ProjectionVisit,
    "places": schemas.ProjectionPlace,
    "updates": schemas.ProjectionUpdate,
    "stays": schemas.ProjectionStay,
    "media": schemas.ProjectionMedia,
    "routes": schemas.ProjectionRoute,
    "navigation": schemas.ProjectionNavigation,
}


def _models(roots: typing.Iterable[type[BaseModel]]) -> set[type[BaseModel]]:
    found: set[type[BaseModel]] = set()
    pending = list(roots)

    def named(annotation: object) -> typing.Iterator[type[BaseModel]]:
        if isinstance(annotation, type) and issubclass(annotation, BaseModel):
            yield annotation
        for argument in typing.get_args(annotation):
            yield from named(argument)

    while pending:
        model = pending.pop()
        if model not in found:
            found.add(model)
            for field in model.model_fields.values():
                pending.extend(named(field.annotation))
    return found


def _subclasses(base: type[BaseModel]) -> set[type[BaseModel]]:
    return {sub for child in base.__subclasses__() for sub in (child, *_subclasses(child))}


def _record(model: type[BaseModel]) -> dict[str, typing.Any]:
    """The smallest valid input of a record: just its required fields, each set to a value of its type."""
    samples = {str: "x", float: 1.5, int: 1}
    values: dict[str, typing.Any] = {}
    for name, field in model.model_fields.items():
        if not field.is_required():
            continue
        kinds = [arg for arg in typing.get_args(field.annotation) if arg is not type(None)] or [field.annotation]
        kind = kinds[0]
        if isinstance(kind, type) and issubclass(kind, BaseModel):
            values[name] = _record(kind)
        elif isinstance(kind, type) and issubclass(kind, str) and hasattr(kind, "__members__"):
            values[name] = next(iter(kind))
        else:
            values[name] = samples.get(kind, "line" if name == "type" else "x")
    return values


def test_every_delivered_kind_has_a_model_and_the_document_lists_exactly_those() -> None:
    document = schemas.ProjectionDocument.model_fields
    assert {key: typing.get_args(document[key].annotation)[0] for key in RECORDS} == RECORDS
    # Nothing is typed as a loose dictionary any more.
    assert all(typing.get_origin(document[key].annotation) is list for key in RECORDS)


def test_every_projection_model_refuses_a_field_it_does_not_declare() -> None:
    """A renderer that adds a field the model lacks fails at once, before anything is delivered."""
    models = _subclasses(schemas.ProjectionRecord)
    # Every model a visitor can receive is a ProjectionRecord, and none was left out of the document.
    assert models >= _models(RECORDS.values()) - {schemas.ProjectionRecord}
    reachable = _models([schemas.ProjectionDocument])
    assert models <= reachable, models - reachable
    for model in models:
        assert model.model_config["extra"] == "forbid", model
        with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
            model(**{**_record(model), "owner_only_field": "private"})


def test_an_optional_field_is_absent_unless_it_was_set_and_null_when_it_was_set_to_null() -> None:
    visit = schemas.ProjectionVisit(
        id="visit-1",
        title=None,
        summary=None,
        summary_html=None,
        place=None,
        date_precision=schemas.DatePrecision.DAY,
        starts_on="2054-04-04",
        ends_on=None,
    )
    assert visit.model_dump() == {
        "id": "visit-1",
        "title": None,
        "summary": None,
        "summary_html": None,
        "place": None,
        "date_precision": "day",
        "starts_on": "2054-04-04",
        "ends_on": None,
    }
    # Read back through the response model, the same keys remain: no null appears where a key was absent.
    again = schemas.ProjectionDocument.model_validate(
        {
            "schema_version": "x",
            "title": None,
            "summary": None,
            "dates": None,
            "visits": [visit.model_dump()],
            "places": [],
            "updates": [],
            "stays": [],
            "media": [],
            "routes": [],
            "navigation": [],
        }
    )
    assert again.model_dump(mode="json")["visits"] == [visit.model_dump()]


def _ok(response):
    assert response.status_code in (200, 201), response.text
    return response.json()


def _rich_document(owner: TestClient, tmp_path: Path) -> tuple[dict, dict]:
    """One trip that delivers every kind and every conditional field, and the document a visitor reads."""
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}"
    assert owner.patch(base, json={"starts_on": "2054-04-01", "ends_on": "2054-04-20"}).status_code == 200
    area = _ok(
        owner.post(
            f"{base}/areas",
            json={"label": "Taipei", "country_code": "TW", "region": "North", "latitude": 25.0, "longitude": 121.5},
        )
    )
    other = owner.post(f"{base}/areas", json={"label": "Tainan", "country_code": "TW"}).json()
    hotel = _ok(
        owner.post(
            f"{base}/locations",
            json={
                "area_id": area["id"],
                "label": "Hotel Riverside",
                "address_line1": "12 Guangming Road",
                "postal_code": "112",
                "locality": "Taipei",
                "country_code": "TW",
                "latitude": 25.0331,
                "longitude": 121.5651,
                "share_address": True,
            },
        )
    )
    station = _ok(
        owner.post(
            f"{base}/locations",
            json={"area_id": other["id"], "label": "Tainan Station", "latitude": 22.99, "longitude": 120.2},
        )
    )
    visit = _ok(
        owner.post(
            f"{base}/visits",
            json={
                "title": "Dinner",
                "area_id": area["id"],
                "location": {"existing_location_id": hotel["id"]},
                "starts_on": "2054-04-04",
                "ends_on": "2054-04-05",
                "start_time": "18:30",
                "end_time": "20:00",
                "share_time": True,
                "share_date_precision": "day",
            },
        )
    )
    undated = owner.post(f"{base}/visits", json={"title": "Wander", "area_id": area["id"]}).json()
    stay = _ok(
        owner.post(
            f"{base}/stays",
            json={
                "location": {"existing_location_id": hotel["id"]},
                "check_in_date": "2054-04-01",
                "check_out_date": "2054-04-05",
                "share_date_precision": "day",
            },
        )
    )
    update = _ok(
        owner.post(
            f"{base}/travel-updates",
            json={
                "occurred_at": "2054-04-04T10:00:00Z",
                "title": "Landed",
                "body": "A **safe** note.",
                "location": {"existing_location_id": hotel["id"]},
            },
        )
    )
    timed = _ok(
        owner.post(
            f"{base}/routes",
            json={
                "mode": "flight",
                "label": "Flight",
                "departure_area_id": area["id"],
                "arrival_area_id": other["id"],
                "departure_location": {"existing_location_id": hotel["id"]},
                "arrival_location": {"existing_location_id": station["id"]},
                "departs_at": "2054-04-02T09:00:00Z",
                "arrives_at": "2054-04-02T11:00:00Z",
                "geometry": {"type": "LineString", "coordinates": [[121, 25], [120.2, 22.99]]},
            },
        )
    )
    day_only = _ok(
        owner.post(
            f"{base}/routes",
            json={
                "mode": "train",
                "departure_area_id": area["id"],
                "arrival_area_id": other["id"],
                "departs_on": "2054-04-03",
            },
        )
    )
    image = io.BytesIO()
    Image.new("RGB", (40, 30), (20, 30, 40)).save(image, format="JPEG")
    asset = owner.post(f"{base}/media/uploads", files={"file": ("a.jpg", image.getvalue(), "image/jpeg")}).json()
    derivative = owner.post(f"{base}/media/{asset['id']}/derivatives", json={"purpose": "share"}).json()
    owner.post(f"{base}/media/{asset['id']}/derivatives/{derivative['id']}/approve")
    presentation = f"{base}/media/{asset['id']}/derivatives/{derivative['id']}/presentation"
    assert (
        owner.patch(
            presentation,
            json={
                "travel_update_id": update["id"],
                "caption": "Shared",
                "alt_text": "Train",
                "focal_x": 25,
                "focal_y": 60,
            },
        ).status_code
        == 200
    )
    shared = [
        item("area", area["id"]),
        item("area", other["id"]),
        item("location", hotel["id"]),
        item("location", station["id"]),
        item("visit", visit["id"]),
        item("visit", undated["id"]),
        item("stay", stay["id"]),
        item("travel_update", update["id"]),
        item("route", timed["id"]),
        item("route", day_only["id"]),
        item("media_derivative", derivative["id"]),
    ]
    for entry in shared:
        share(owner, trip["id"], entry["kind"], entry["id"], "everyone")
    assert owner.put(f"{base}/public-projection", json=scope()).status_code == 200
    slug = owner.post(f"{base}/public-projection/publish").json()["slug"]
    response = TestClient(app).get(f"/api/public/trips/{slug}")
    assert response.status_code == 200, response.text
    return response.json(), {"slug": slug}


def test_a_delivered_document_carries_only_declared_fields_and_every_conditional_one_was_exercised(
    tmp_path: Path,
) -> None:
    document, _ = _rich_document(client_for("owner-1"), tmp_path)
    # Every record validates against its own model (forbidding anything else) ...
    parsed = schemas.ProjectionDocument.model_validate(document)
    assert (
        parsed.model_dump(mode="json", exclude_none=False)
        == {
            **document,
            "current_locations": None,
            "numbers": None,
        }
        or parsed.model_dump(mode="json") == document
    )
    # ... and the fixture reaches every optional field, so a field no fixture sends cannot hide here.
    for key, model in RECORDS.items():
        sent = {name for record in document[key] for name in record}
        assert sent <= set(model.model_fields), (key, sent - set(model.model_fields))
        # A video's marker is the one group this fixture (a photo) cannot send.
        assert set(model.model_fields) - sent <= {"video", "poster", "duration_seconds"}, (
            key,
            set(model.model_fields) - sent,
        )
    assert {name for record in document["places"] for name in record.get("address", {})} == {
        "line1",
        "postal_code",
        "locality",
    }


def test_the_openapi_schema_lists_every_field_a_visitor_can_receive(tmp_path: Path) -> None:
    schema = app.openapi()
    components = schema["components"]["schemas"]
    for path in ("/api/public/trips/{slug}", "/api/shared/{token}"):
        operation = schema["paths"][path]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
        assert "ProjectionDocument" in str(operation), path
    for model in _models([schemas.ProjectionDocument]):
        if model is schemas.ProjectionDocument:
            continue
        listed = components[model.__name__]["properties"]
        assert set(listed) == set(model.model_fields), model.__name__
        # A model that refuses unknown fields says so in the published schema too.
        assert (components[model.__name__].get("additionalProperties") is False) is issubclass(
            model, schemas.ProjectionRecord
        )
    assert set(components["ProjectionDocument"]["properties"]["visits"]["items"]["$ref"].split("/")[-1:]) == {
        "ProjectionVisit"
    }
