"""A stay may be filed under an area alone until an accommodation is chosen (#239).

No placeholder location is created for it. Every reader of a stay tolerates having no location: the owner's list
and export, the merge tools and their widening checks, deleting an area or a location, hiding by exclusion, and the
MCP tools, which run the same code as the API."""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker
from test_publication import (  # noqa: F401
    activate,
    client_for,
    create_trip,
    engine,
    scope,
    setup_function,
    share,
    teardown_function,
)

from app import schemas
from app.config import settings
from app.main import app
from app.mcp_server import BatchCreate, TravelMcpBackend
from app.models import Stay

NIGHTS = {"check_in_date": "2054-04-01", "check_out_date": "2054-04-03"}


def _area(owner: TestClient, trip_id: str, label: str = "Taipei", **extra) -> dict:
    response = owner.post(f"/api/trips/{trip_id}/areas", json={"label": label, "country_code": "TW", **extra})
    assert response.status_code == 201, response.text
    return response.json()


def _stay(owner: TestClient, trip_id: str, **place) -> dict:
    response = owner.post(f"/api/trips/{trip_id}/stays", json={**NIGHTS, **place})
    assert response.status_code == 201, response.text
    return response.json()


def _hotel(owner: TestClient, trip_id: str, area: dict, label: str = "Hotel") -> dict:
    response = owner.post(
        f"/api/trips/{trip_id}/locations", json={"area_id": area["id"], "label": label, "display_name": label}
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_listing_counts_and_the_stored_area_of_area_only_stays() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    taipei, tainan = _area(owner, trip["id"]), _area(owner, trip["id"], "Tainan")
    undecided = _stay(owner, trip["id"], area_id=taipei["id"])
    decided = _stay(owner, trip["id"], location={"existing_location_id": _hotel(owner, trip["id"], tainan)["id"]})

    assert (undecided["location"], undecided["area"]["id"]) == (None, taipei["id"])
    assert decided["area"]["id"] == tainan["id"]
    listed = owner.get(f"/api/trips/{trip['id']}/stays").json()
    assert {row["id"]: (row["area"]["id"], row["location"] and row["location"]["id"]) for row in listed} == {
        undecided["id"]: (taipei["id"], None),
        decided["id"]: (tainan["id"], decided["location"]["id"]),
    }
    assert len(owner.get(f"/api/trips/{trip['id']}/locations").json()) == 1  # only the hotel
    with Session(engine) as session:
        assert session.get(Stay, undecided["id"]).area_id == taipei["id"]
        assert session.get(Stay, undecided["id"]).location_id is None


def test_export_has_the_stays_area_and_a_null_location_for_an_undecided_stay() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    taipei = _area(owner, trip["id"])
    undecided = _stay(owner, trip["id"], area_id=taipei["id"])

    response = owner.get(f"/api/trips/{trip['id']}/export")
    assert response.status_code == 200, response.text
    document = json.loads(response.text)
    assert document["schema_version"] == "travel/trip-export@1"
    (row,) = document["stays"]
    assert (row["id"], row["area_id"], row["location_id"]) == (undecided["id"], taipei["id"], None)
    assert document["locations"] == []


def test_moving_a_location_to_another_area_moves_its_stays_and_asks_before_changing_what_visitors_read() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}"
    taipei, tainan = _area(owner, trip["id"]), _area(owner, trip["id"], "Tainan")
    hotel = _hotel(owner, trip["id"], taipei)
    stay = _stay(owner, trip["id"], location={"existing_location_id": hotel["id"]})
    for kind, record in (("area", taipei), ("area", tainan), ("stay", stay)):
        share(owner, trip["id"], kind, record["id"], "everyone")
    assert owner.post(f"{base}/public-projection/publish").status_code == 200

    # A shared stay is read through its area, so moving its location is a visitor-visible change.
    refused = owner.patch(f"{base}/locations/{hotel['id']}", json={"area_id": tainan["id"]})
    assert refused.status_code == 409, refused.text
    (change,) = refused.json()["detail"]["changes"]
    assert (change["field"], change["stays"], change["visits"]) == ("area_id", 1, 0)
    assert owner.get(f"{base}/stays/{stay['id']}").json()["area"]["id"] == taipei["id"]

    moved = owner.patch(
        f"{base}/locations/{hotel['id']}", json={"area_id": tainan["id"], "acknowledge_visitor_changes": True}
    )
    assert moved.status_code == 200, moved.text
    after = owner.get(f"{base}/stays/{stay['id']}").json()
    assert (after["area"]["id"], after["location"]["area_id"]) == (tainan["id"], tainan["id"])


def test_location_merge_moves_stays_with_their_area_and_never_touches_area_only_stays() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}"
    taipei, tainan = _area(owner, trip["id"]), _area(owner, trip["id"], "Tainan")
    keep, duplicate = _hotel(owner, trip["id"], tainan, "Kept"), _hotel(owner, trip["id"], taipei, "Duplicate")
    at_duplicate = _stay(owner, trip["id"], location={"existing_location_id": duplicate["id"]})
    undecided = _stay(owner, trip["id"], area_id=taipei["id"])

    preview = owner.post(f"{base}/locations/merge", json={"keep_id": keep["id"], "duplicate_ids": [duplicate["id"]]})
    assert preview.status_code == 200, preview.text
    assert preview.json()["duplicates"][0]["stays"] == 1  # the area-only stay is not at the location

    applied = owner.post(
        f"{base}/locations/merge", json={"keep_id": keep["id"], "duplicate_ids": [duplicate["id"]], "confirm": True}
    )
    assert applied.status_code == 200, applied.text
    moved = owner.get(f"{base}/stays/{at_duplicate['id']}").json()
    assert (moved["location"]["id"], moved["area"]["id"]) == (keep["id"], tainan["id"])
    left = owner.get(f"{base}/stays/{undecided['id']}").json()
    assert (left["location"], left["area"]["id"]) == (None, taipei["id"])


def test_area_merge_moves_area_only_stays_and_widening_names_them() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}"
    keep, duplicate = (
        _area(owner, trip["id"], "Taipei", latitude=25.0, longitude=121.5),
        _area(owner, trip["id"], "Taipei City"),
    )
    undecided = _stay(owner, trip["id"], area_id=duplicate["id"])
    hotel = _hotel(owner, trip["id"], duplicate)
    at_hotel = _stay(owner, trip["id"], location={"existing_location_id": hotel["id"]})
    # Only the kept area and the stays are shared: the merge would show the kept area's point through the stays.
    share(owner, trip["id"], "area", keep["id"], "everyone")
    share(owner, trip["id"], "stay", undecided["id"], "everyone")
    assert owner.post(f"{base}/public-projection/publish").status_code == 200

    request = {"keep_id": keep["id"], "duplicate_ids": [duplicate["id"]]}
    preview = owner.post(f"{base}/areas/merge", json=request).json()
    (summary,) = preview["duplicates"]
    assert (summary["stays"], summary["locations"]) == (2, 1)
    assert [record["id"] for record in summary["widened_records"]] == [undecided["id"]]
    refused = owner.post(f"{base}/areas/merge", json={**request, "confirm": True})
    assert refused.status_code == 409, refused.text

    applied = owner.post(f"{base}/areas/merge", json={**request, "confirm": True, "confirm_widening": True})
    assert applied.status_code == 200, applied.text
    for stay in (undecided, at_hotel):
        after = owner.get(f"{base}/stays/{stay['id']}").json()
        assert after["area"]["id"] == keep["id"]
    assert owner.get(f"{base}/stays/{undecided['id']}").json()["location"] is None
    assert owner.get(f"{base}/stays/{at_hotel['id']}").json()["location"]["area_id"] == keep["id"]


def test_an_area_in_use_by_an_area_only_stay_cannot_be_deleted_until_the_stay_goes() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}"
    taipei = _area(owner, trip["id"])
    stay = _stay(owner, trip["id"], area_id=taipei["id"])

    refused = owner.delete(f"{base}/areas/{taipei['id']}")
    assert refused.status_code == 409, refused.text
    assert refused.json()["errors"][0]["params"]["stays"] == 1
    assert owner.delete(f"{base}/stays/{stay['id']}").status_code == 204
    assert owner.delete(f"{base}/areas/{taipei['id']}").status_code == 204


def test_a_location_is_free_to_delete_once_its_stay_is_undecided_again() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}"
    taipei = _area(owner, trip["id"])
    hotel = _hotel(owner, trip["id"], taipei)
    stay = _stay(owner, trip["id"], location={"existing_location_id": hotel["id"]})

    assert owner.delete(f"{base}/locations/{hotel['id']}").status_code == 409
    assert owner.patch(f"{base}/stays/{stay['id']}", json={"location": None}).status_code == 200
    assert owner.delete(f"{base}/locations/{hotel['id']}").status_code == 204
    assert owner.get(f"{base}/stays/{stay['id']}").json()["area"]["id"] == taipei["id"]


def test_excluding_an_area_hides_the_area_only_stays_filed_under_it_from_that_link_only() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}"
    taipei, tainan = _area(owner, trip["id"]), _area(owner, trip["id"], "Tainan")
    in_taipei, in_tainan = (_stay(owner, trip["id"], area_id=area["id"]) for area in (taipei, tainan))
    for kind, record in (("area", taipei), ("area", tainan), ("stay", in_taipei), ("stay", in_tainan)):
        share(owner, trip["id"], kind, record["id"], "everyone")
    slug = owner.post(f"{base}/public-projection/publish").json()["slug"]
    link_scope = {**scope(), "exclude": [{"kind": "area", "id": taipei["id"]}]}
    created = owner.post(f"{base}/share-links", json={"label": "Friends", "scope": link_scope})
    assert created.status_code == 201, created.text
    token = activate(owner, trip["id"], created.json()["id"])["token"]

    anonymous = TestClient(app)
    titles = lambda document: sorted(stay["title"] for stay in document["stays"])  # noqa: E731
    assert titles(anonymous.get(f"/api/shared/{token}").json()) == ["Tainan"]
    assert titles(anonymous.get(f"/api/public/trips/{slug}").json()) == ["Tainan", "Taipei"]


def test_a_visitor_reads_an_area_only_stay_as_its_area_and_nights_and_nothing_about_a_location() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}"
    taipei = _area(owner, trip["id"], latitude=25.04, longitude=121.5)
    stay = _stay(
        owner,
        trip["id"],
        area_id=taipei["id"],
        property_name="Secret Inn",
        booking_reference="BOOKING-SECRET",
        notes="private note",
        contact_details="host@example.test",
        share_date_precision="day",
    )
    share(owner, trip["id"], "area", taipei["id"], "everyone")
    share(owner, trip["id"], "stay", stay["id"], "everyone")
    assert owner.put(f"{base}/public-projection", json={"defaults": None}).status_code == 200
    slug = owner.post(f"{base}/public-projection/publish").json()["slug"]

    document = TestClient(app).get(f"/api/public/trips/{slug}").json()
    (shared,) = document["stays"]
    assert set(shared) == {"id", "title", "place", "date_precision", "starts_on", "ends_on"}
    assert (shared["title"], shared["starts_on"], shared["ends_on"]) == ("Taipei", "2054-04-01", "2054-04-03")
    assert shared["place"]["label"] == "Taipei"
    for private in ("Secret Inn", "BOOKING-SECRET", "private note", "host@example.test"):
        assert private not in json.dumps(document)


@pytest.fixture
def backend(monkeypatch: pytest.MonkeyPatch) -> TravelMcpBackend:
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "mcp_development_subject", "owner-1")
    return TravelMcpBackend(sessionmaker(bind=engine, autocommit=False, autoflush=False))


def test_mcp_create_batch_and_update_behave_like_the_api(backend: TravelMcpBackend) -> None:
    trip = backend.create_trip(schemas.TripCreate(title="Area only"))
    taipei = backend.save_area(trip["id"], schemas.AreaInput(label="Taipei"))
    tainan = backend.save_area(trip["id"], schemas.AreaInput(label="Tainan"))

    undecided = backend.create_stay(trip["id"], schemas.StayCreate(area_id=taipei["id"], **NIGHTS))
    assert (undecided["location"], undecided["area"]["id"]) == (None, taipei["id"])
    assert backend.list_locations(trip["id"]) == []
    (row,) = backend.list_stays(trip["id"])
    assert (row["location_id"], row["area"]["id"]) == (None, taipei["id"])

    batch = backend.batch_create(
        trip["id"],
        BatchCreate(
            stays=[
                schemas.StayCreate(area_id=tainan["id"], **NIGHTS),
                schemas.StayCreate(location={"area_id": tainan["id"]}, **NIGHTS),
            ]
        ),
    )
    assert [stay["location_id"] for stay in batch["stays"]] == [None, None]
    assert backend.list_locations(trip["id"]) == []

    chosen = backend.update_stay(
        trip["id"],
        undecided["id"],
        schemas.StayUpdate(location=schemas.LocationInput(display_name="Hotel", locality="Taipei", country_code="TW")),
    )
    assert chosen["location"]["display_name"] == "Hotel" and chosen["area"]["id"] == taipei["id"]
    assert backend.get_stay(trip["id"], undecided["id"])["location"]["id"] == chosen["location"]["id"]
    again = backend.update_stay(trip["id"], undecided["id"], schemas.StayUpdate(location=None))
    assert (again["location"], again["area"]["id"]) == (None, taipei["id"])

    with pytest.raises(ValueError, match="not in the chosen area"):
        backend.update_stay(
            trip["id"],
            undecided["id"],
            schemas.StayUpdate(
                area_id=tainan["id"], location=schemas.LocationInput(existing_location_id=chosen["location"]["id"])
            ),
        )
    # A stay filed under an area is reported to the merge tools like any other.
    merged = backend.merge_areas(trip["id"], tainan["id"], [taipei["id"]], confirm=False)
    assert merged["duplicates"][0]["stays"] == 1
