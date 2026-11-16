"""Local place names (#376): the name as written where an area or a location is.

Stored on the owner's say-so only, searched, used for navigation, and shown to a visitor only beside a label that is
shared, never widening what the label itself would reveal."""

import httpx
import pytest
from fastapi.testclient import TestClient
from test_location_visitor_changes import Setup, changes_of
from test_publication import (  # noqa: F401
    TestingSessionLocal,
    activate,
    client_for,
    create_trip,
    item,
    scope,
    setup_function,
    share,
    teardown_function,
)

from app import schemas
from app.config import settings
from app.main import app
from app.mcp_server import TravelMcpBackend
from app.models import Area, Location
from app.navigation import area_navigation_url, location_navigation_url
from app.places.search import NominatimSearchProvider
from app.projection import place_names

TAIPEI = "台北"
HOTEL = "河畔飯店"
STATION = "臺南車站"


def base(trip: dict) -> str:
    return f"/api/trips/{trip['id']}"


# --- the owner API -------------------------------------------------------------------


def test_an_area_and_a_location_hold_a_local_name_the_owner_can_change_and_clear() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    area = owner.post(f"{base(trip)}/areas", json={"label": "Taipei", "local_name": TAIPEI}).json()
    assert area["local_name"] == TAIPEI
    location = owner.post(
        f"{base(trip)}/locations", json={"area_id": area["id"], "label": "Riverside", "local_name": HOTEL}
    ).json()
    assert location["local_name"] == HOTEL

    # Omitted keeps it; a blank one is no name; null clears it.
    assert owner.patch(f"{base(trip)}/areas/{area['id']}", json={"region": "North"}).json()["local_name"] == TAIPEI
    assert (
        owner.patch(f"{base(trip)}/areas/{area['id']}", json={"local_name": "  新北  "}).json()["local_name"] == "新北"
    )
    assert owner.patch(f"{base(trip)}/areas/{area['id']}", json={"local_name": "  "}).json()["local_name"] is None
    path = f"{base(trip)}/locations/{location['id']}"
    assert owner.patch(path, json={"notes": "x"}).json()["local_name"] == HOTEL
    assert owner.patch(path, json={"local_name": None}).json()["local_name"] is None
    assert owner.get(f"{base(trip)}/locations").json()[0]["local_name"] is None

    # The name is plain text of a bounded length.
    assert owner.post(f"{base(trip)}/areas", json={"label": "A", "local_name": "x" * 121}).status_code == 422
    assert owner.post(f"{base(trip)}/areas", json={"label": "A", "local_name": "bad\x00name"}).status_code == 422
    assert owner.post(f"{base(trip)}/locations", json={"display_name": "A", "local_name": "x" * 121}).status_code == 422


def test_a_new_area_inside_a_location_carries_its_local_name() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    created = owner.post(
        f"{base(trip)}/locations",
        json={"display_name": "Station", "local_name": STATION, "new_area": {"label": "Tainan", "local_name": "臺南"}},
    )
    assert created.status_code == 201, created.text
    assert created.json()["local_name"] == STATION
    (area,) = owner.get(f"{base(trip)}/areas").json()
    assert area["local_name"] == "臺南"


def test_owner_search_finds_an_area_or_a_location_by_its_local_name_ignoring_case_and_accents() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    area = owner.post(f"{base(trip)}/areas", json={"label": "Zurich", "local_name": "Zürich"}).json()
    owner.post(f"{base(trip)}/areas", json={"label": "Taipei"})
    owner.post(f"{base(trip)}/locations", json={"area_id": area["id"], "display_name": "x", "local_name": HOTEL})
    owner.post(f"{base(trip)}/locations", json={"area_id": area["id"], "display_name": "y"})

    assert [found["label"] for found in owner.get(f"{base(trip)}/areas", params={"q": "ZÜRICH"}).json()] == ["Zurich"]
    assert [found["label"] for found in owner.get(f"{base(trip)}/areas", params={"q": "zurich"}).json()] == ["Zurich"]
    assert len(owner.get(f"{base(trip)}/locations", params={"q": HOTEL[:2]}).json()) == 1
    assert owner.get(f"{base(trip)}/locations", params={"q": "資料"}).json() == []


def test_the_export_carries_the_local_name_without_a_new_version() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    area = owner.post(f"{base(trip)}/areas", json={"label": "Taipei", "local_name": TAIPEI}).json()
    owner.post(f"{base(trip)}/locations", json={"area_id": area["id"], "display_name": "x", "local_name": HOTEL})
    exported = owner.get(f"{base(trip)}/export").json()
    assert exported["schema_version"] == "travel/trip-export@3"
    assert exported["areas"][0]["local_name"] == TAIPEI
    assert exported["locations"][0]["local_name"] == HOTEL


def test_the_mcp_tools_take_and_search_the_local_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "mcp_development_subject", "owner-1")
    client_for("owner-1")
    backend = TravelMcpBackend(TestingSessionLocal)
    assert "local_name" in schemas.AreaInput.model_json_schema()["properties"]
    assert "local_name" in schemas.LocationUpdate.model_json_schema()["properties"]
    trip = backend.create_trip(schemas.TripCreate(title="Round trip"))
    area = backend.save_area(trip["id"], schemas.AreaInput(label="Taipei", local_name=TAIPEI))
    assert area["local_name"] == TAIPEI
    assert backend.update_area(trip["id"], area["id"], schemas.AreaUpdate(local_name="臺北"))["local_name"] == "臺北"
    location = backend.save_location(
        trip["id"], schemas.LocationInput(area_id=area["id"], display_name="Hotel", local_name=HOTEL)
    )
    assert location["local_name"] == HOTEL
    assert (
        backend.update_location(trip["id"], location["id"], schemas.LocationUpdate(local_name=None))["local_name"]
        is None
    )
    assert [found["local_name"] for found in backend.list_areas(trip["id"], query="臺北")] == ["臺北"]
    assert backend.list_areas(trip["id"], query="nothing") == []
    assert "local_name" in backend.list_locations(trip["id"])[0]


def test_changing_a_shared_locations_local_name_needs_the_owners_acknowledgement() -> None:
    setup = Setup(client_for("owner-1"), "everyone")
    refused = setup.owner.patch(setup.path, json={"local_name": HOTEL})
    (change,) = changes_of(refused).values()
    assert (change["field"], change["before"], change["after"]) == ("local_name", None, HOTEL)
    assert change["audiences"] == [{"id": "public", "label": None}]
    assert (
        setup.owner.patch(setup.path, json={"local_name": HOTEL, "acknowledge_visitor_changes": True}).status_code
        == 200
    )
    # A private location has no readers, so there is nothing to acknowledge.
    private = Setup(client_for("owner-1"), "private")
    assert private.owner.patch(private.path, json={"local_name": HOTEL}).status_code == 200


# --- the provider ----------------------------------------------------------------------


def _provider(monkeypatch: pytest.MonkeyPatch, **details) -> tuple[NominatimSearchProvider, list[dict]]:
    requests: list[dict] = []

    def get(url, *, params, headers, timeout):
        requests.append(params)
        place = {
            "osm_type": "node",
            "osm_id": 1,
            "display_name": details.pop("display_name", "Senso-ji, Asakusa, Taito, Tokyo, Japan"),
            "lat": "35.7148",
            "lon": "139.7967",
            "boundingbox": ["35.71", "35.72", "139.79", "139.80"],
            "address": {"city": "Tokyo", "country_code": "jp"},
            **({"namedetails": details} if details else {}),
        }
        payload = [place] if url.endswith("/search") else place
        return httpx.Response(200, json=payload, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", get)
    return NominatimSearchProvider(), requests


def test_the_provider_is_asked_for_names_and_keeps_english_for_the_display_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider, requests = _provider(monkeypatch, name="浅草寺", **{"name:en": "Senso-ji", "name:nl": "Sensō-ji"})
    (result,) = provider.search("Senso-ji")
    assert provider.reverse(35.7148, 139.7967) is not None
    assert [(request["namedetails"], request["accept-language"]) for request in requests] == [(1, "en"), (1, "en")]
    assert result.display_name == "Senso-ji, Asakusa, Taito, Tokyo, Japan"
    assert (result.local_name, result.name_en, result.name_nl) == ("浅草寺", "Senso-ji", "Sensō-ji")


def test_a_local_name_is_the_providers_plain_name_only_when_it_differs_from_the_english_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Same as the English reading (here the first part of the display name): no information, so none offered.
    provider, _ = _provider(monkeypatch, name="Senso-ji")
    assert provider.search("x")[0].local_name is None
    # Same as `name:en`, whatever the case.
    provider, _ = _provider(monkeypatch, name="TOKYO", **{"name:en": "Tokyo"}, display_name="Capital, Japan")
    assert provider.search("x")[0].local_name is None
    # An accent is a difference: Zürich is a local name next to Zurich.
    provider, _ = _provider(monkeypatch, name="Zürich", display_name="Zurich, Switzerland")
    assert provider.search("x")[0].local_name == "Zürich"
    # No `name:nl` or `name:en` tag means no suggestion: nothing is translated or guessed.
    result = _provider(monkeypatch, name="浅草寺")[0].search("x")[0]
    assert (result.local_name, result.name_nl, result.name_en) == ("浅草寺", None, None)


def test_a_provider_name_that_cannot_be_stored_or_is_not_text_is_left_out(monkeypatch: pytest.MonkeyPatch) -> None:
    provider, _ = _provider(monkeypatch, name="x" * 121, **{"name:nl": "   ", "name:en": 7})
    (result,) = provider.search("x")
    assert (result.local_name, result.name_nl, result.name_en) == (None, None, None)
    # Names are tidied, and a provider that sends no name details at all still answers.
    provider, _ = _provider(monkeypatch, name="  浅草   寺 ")
    assert provider.search("x")[0].local_name == "浅草 寺"
    provider, _ = _provider(monkeypatch)
    (bare,) = provider.search("x")
    assert (bare.local_name, bare.name_nl, bare.name_en) == (None, None, None)


def test_country_codes_become_english_names_and_an_unknown_one_becomes_nothing() -> None:
    from app.country_names import COUNTRY_NAMES, country_name

    assert (country_name("TW"), country_name("nl"), country_name("JP")) == ("Taiwan", "Netherlands", "Japan")
    assert (country_name(None), country_name(""), country_name("ZZ")) == (None, None, None)
    # Every entry is a two-letter upper-case code with a name, the shape the API accepts for a country.
    assert all(len(code) == 2 and code.isupper() and COUNTRY_NAMES[code].strip() for code in COUNTRY_NAMES)


# --- navigation ------------------------------------------------------------------------


def _url(destination: str) -> str:
    from app.navigation import google_maps_url

    return google_maps_url(destination)


def test_an_area_is_opened_by_its_local_name_else_its_label_with_the_country_as_a_name() -> None:
    area = Area(label_en="Taipei", local_name=TAIPEI, region="Northern", country_code="TW")
    assert area_navigation_url(area) == _url(f"{TAIPEI}, Northern, Taiwan")
    area.local_name = None
    assert area_navigation_url(area) == _url("Taipei, Northern, Taiwan")
    area.country_code = "ZZ"  # not a country: no raw code goes into the search either
    assert area_navigation_url(area) == _url("Taipei, Northern")


def test_a_location_without_a_point_is_opened_by_local_name_then_label_then_what_the_provider_said() -> None:
    place = Location(
        label_en="Riverside",
        local_name=HOTEL,
        display_name="Hotel Riverside, Taipei",
        locality="Taipei",
        country_code="TW",
    )
    assert location_navigation_url(place) == _url(f"{HOTEL}, Taipei, Taiwan")
    place.local_name = None
    assert location_navigation_url(place) == _url("Riverside, Taipei, Taiwan")
    place.label_en = None
    assert location_navigation_url(place) == _url("Hotel Riverside, Taipei")
    place.display_name = None
    assert location_navigation_url(place) == _url("Taipei")
    place.locality = None
    assert location_navigation_url(place) is None
    # A point beats every name: the exact target is unchanged.
    place.local_name, place.latitude, place.longitude = HOTEL, 25.0331, 121.5651
    assert location_navigation_url(place) == _url("25.0331000,121.5651000")


# --- what a visitor reads --------------------------------------------------------------


def _walk(node):
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value)


def _places(document: dict) -> list[dict]:
    """Every object that carries a name of a place: a shared area or location, an embedded one, a route end."""
    return [node for node in _walk(document) if "label" in node and "label_lang" in node or "local_name" in node]


def _trip_with_local_names(owner: TestClient):
    trip = create_trip(owner)
    taipei = owner.post(
        f"{base(trip)}/areas", json={"label": "Taipei", "local_name": TAIPEI, "country_code": "TW", "region": "North"}
    ).json()
    tainan = owner.post(
        f"{base(trip)}/areas", json={"label": "Tainan", "local_name": "臺南", "country_code": "TW"}
    ).json()
    hotel = owner.post(
        f"{base(trip)}/locations",
        json={
            "area_id": taipei["id"],
            "label": "Hotel Riverside",
            "local_name": HOTEL,
            "latitude": 25.0331,
            "longitude": 121.5651,
        },
    ).json()
    secret = owner.post(
        f"{base(trip)}/locations",
        json={"area_id": taipei["id"], "display_name": "Private flat", "local_name": "祕密住處"},
    ).json()
    visit = owner.post(
        f"{base(trip)}/visits",
        json={"title": "Dinner", "area_id": taipei["id"], "location": {"existing_location_id": hotel["id"]}},
    ).json()
    route = owner.post(
        f"{base(trip)}/routes",
        json={
            "mode": "train",
            "departure_area_id": taipei["id"],
            "arrival_area_id": tainan["id"],
            "departure_location": {"existing_location_id": hotel["id"]},
        },
    ).json()
    return trip, taipei, tainan, hotel, secret, visit, route


def test_a_visitor_reads_the_local_name_beside_every_label_that_is_shared_and_nowhere_else() -> None:
    owner = client_for("owner-1")
    trip, taipei, tainan, hotel, secret, visit, route = _trip_with_local_names(owner)
    for kind, record in (("area", taipei), ("location", hotel), ("visit", visit), ("route", route)):
        share(owner, trip["id"], kind, record["id"], "everyone")
    slug = owner.post(f"{base(trip)}/public-projection/publish").json()["slug"]
    document = TestClient(app).get(f"/api/public/trips/{slug}").json()

    shared = {node["label"]: node.get("local_name") for node in _places(document)}
    assert shared["Taipei"] == TAIPEI and shared["Hotel Riverside"] == HOTEL
    # The embedded area of a visit and of a route end shows what its label shows, and the route's map point too.
    assert document["visits"][0]["place"]["local_name"] == TAIPEI
    assert document["routes"][0]["departure"]["local_name"] == TAIPEI
    assert document["routes"][0]["arrival"]["local_name"] == "臺南"
    assert document["routes"][0]["map"]["departure"]["local_name"] == HOTEL
    # A location that is not shared is not delivered, and neither is its name.
    assert "祕密住處" not in str(document) and secret["id"] not in str(document)
    # Whatever carries a local name carries a label beside it: it follows the label, never goes ahead of it.
    for node in _walk(document):
        if "local_name" in node:
            assert node.get("label"), node
    # And the delivered text is plain: it carries no language marker of its own.
    assert not any(key.startswith("local_name_") for node in _walk(document) for key in node)


def test_an_unnamed_place_and_a_place_without_a_local_name_deliver_no_such_field() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    plain = owner.post(f"{base(trip)}/areas", json={"label": "Taipei"}).json()
    share(owner, trip["id"], "area", plain["id"], "everyone")
    slug = owner.post(f"{base(trip)}/public-projection/publish").json()["slug"]
    document = TestClient(app).get(f"/api/public/trips/{slug}").json()
    assert not any("local_name" in node for node in _walk(document))


def test_the_local_name_follows_the_label_through_fallback_and_never_stands_without_one() -> None:
    area = Area(local_name=TAIPEI, label_nl="Taipei")
    # The label exists in Dutch only: asked in English it falls back, and the name stays beside it.
    assert place_names(area, "en") == {"label": "Taipei", "label_lang": "nl", "local_name": TAIPEI}
    # Without a label (an unnamed area, or one whose label was cleared) the name is not delivered at all.
    assert place_names(Area(local_name=TAIPEI), "nl") == {"label": None}
    assert place_names(Location(local_name=HOTEL), "en") == {"label": None}


def test_a_share_link_reads_the_local_name_only_of_the_places_it_receives() -> None:
    owner = client_for("owner-1")
    trip, taipei, tainan, hotel, secret, visit, route = _trip_with_local_names(owner)
    hotel_entry = share(owner, trip["id"], "location", hotel["id"], "custom")
    area_entry = share(owner, trip["id"], "area", tainan["id"], "custom")
    anonymous = TestClient(app)

    def link_for(label: str, *entries: dict) -> dict:
        created = owner.post(f"{base(trip)}/share-links", json={"label": label, "scope": scope(*entries)}).json()
        return anonymous.get(f"/api/shared/{activate(owner, trip['id'], created['id'])['token']}").json()

    with_hotel = link_for("Hotel", hotel_entry)
    assert [place["local_name"] for place in with_hotel["places"]] == [HOTEL]
    assert "臺南" not in str(with_hotel) and TAIPEI not in str(with_hotel)
    with_area = link_for("Tainan", area_entry)
    assert [place["local_name"] for place in with_area["places"]] == ["臺南"]
    assert HOTEL not in str(with_area)
    nothing = link_for("Nothing")
    assert not any(name in str(nothing) for name in (TAIPEI, HOTEL, "臺南", "祕密住處"))


def test_a_hidden_place_hides_its_local_name_with_its_label() -> None:
    owner = client_for("owner-1")
    trip, taipei, tainan, hotel, secret, visit, route = _trip_with_local_names(owner)
    for kind, record in (("area", taipei), ("location", hotel)):
        share(owner, trip["id"], kind, record["id"], "everyone")
    created = owner.post(
        f"{base(trip)}/share-links",
        json={"label": "Family", "scope": {**scope(), "exclude": [{"kind": "location", "id": hotel["id"]}]}},
    )
    assert created.status_code == 201, created.text
    token = activate(owner, trip["id"], created.json()["id"])["token"]
    document = TestClient(app).get(f"/api/shared/{token}").json()
    assert [place["label"] for place in document["places"]] == ["Taipei"]
    assert HOTEL not in str(document) and "Hotel Riverside" not in str(document)
    assert TAIPEI in str(document)


def test_an_unshared_location_adds_nothing_to_what_a_shared_visit_reveals() -> None:
    owner = client_for("owner-1")
    trip, taipei, tainan, hotel, secret, visit, route = _trip_with_local_names(owner)
    # The visit is shared but not the hotel it is at: the visitor reads neither its label nor its local name.
    share(owner, trip["id"], "visit", visit["id"], "everyone")
    slug = owner.post(f"{base(trip)}/public-projection/publish").json()["slug"]
    document = TestClient(app).get(f"/api/public/trips/{slug}").json()
    assert "location" not in document["visits"][0]
    assert HOTEL not in str(document) and "Hotel Riverside" not in str(document)
    # The area it names is embedded, label and local name together, as before: no more than its label shows.
    assert document["visits"][0]["place"] == {
        "label": "Taipei",
        "local_name": TAIPEI,
        "country_code": "TW",
        "region": "North",
        "latitude": None,
        "longitude": None,
    }


def test_a_shared_areas_navigation_uses_the_local_name_and_the_country_as_a_name() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    area = owner.post(
        f"{base(trip)}/areas",
        json={"label": "Taipei", "local_name": TAIPEI, "country_code": "TW", "latitude": 25.0, "longitude": 121.5},
    ).json()
    share(owner, trip["id"], "area", area["id"], "everyone")
    slug = owner.post(f"{base(trip)}/public-projection/publish").json()["slug"]
    anonymous = TestClient(app)
    marker = anonymous.get(f"/api/public/trips/{slug}").json()["navigation"][0]["id"]
    redirect = anonymous.get(f"/api/public/trips/{slug}/navigation/{marker}", follow_redirects=False)
    assert redirect.headers["location"] == _url(f"{TAIPEI}, Taiwan")
