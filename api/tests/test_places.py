from fastapi.testclient import TestClient
from test_publication import activate, client_for, create_trip, engine, item, scope

from app.config import Settings
from app.database import Base
from app.main import app
from app.places.search import CachedPlaceSearchService
from app.routers.places import get_place_search_service


def setup_function() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def teardown_function() -> None:
    app.dependency_overrides.clear()


class FakePlaceSearchProvider:
    name = "fake-osm"
    attribution = "Fake OSM attribution"
    attribution_url = "https://example.test/attribution"

    def __init__(self) -> None:
        self.calls = 0
        self.reverse_calls = 0

    def search(self, query: str):
        self.calls += 1
        assert query == "Secret hotel"
        from app.schemas import PlaceSearchResult

        return [
            PlaceSearchResult(
                osm_element_type="way",
                osm_element_id="12345",
                display_name="Secret Hotel, Taipei, Exampleland",
                latitude=25.033,
                longitude=121.565,
                locality="Taipei",
                country_code="TW",
            )
        ]

    def reverse(self, latitude: float, longitude: float):
        self.reverse_calls += 1
        assert (latitude, longitude) == (25.033, 121.565)
        return self.search("Secret hotel")[0]


def test_owner_searches_and_saves_a_durable_osm_reference_without_persisting_query() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    provider = FakePlaceSearchProvider()
    service = CachedPlaceSearchService(provider, Settings(osm_place_search_cache_ttl_seconds=60))
    app.dependency_overrides[get_place_search_service] = lambda: service

    first = owner.post(f"/api/v1/trips/{trip['id']}/places/search", json={"query": "Secret hotel"})
    second = owner.post(f"/api/v1/trips/{trip['id']}/places/search", json={"query": "  Secret   hotel  "})
    assert first.status_code == 200
    assert second.status_code == 200
    assert provider.calls == 1
    result = first.json()["results"][0]
    assert first.json()["attribution"] == "Fake OSM attribution"
    assert "place_id" not in result

    # Reverse lookup returns the exact same selectable shape but leaves the
    # trip untouched until the owner separately saves/attaches a result.
    reversed_result = owner.post(
        f"/api/v1/trips/{trip['id']}/places/reverse", json={"latitude": 25.033, "longitude": 121.565}
    )
    assert reversed_result.status_code == 200
    assert reversed_result.json()["results"] == [result]
    assert provider.reverse_calls == 1
    assert owner.get(f"/api/v1/trips/{trip['id']}/places").json() == []

    saved = owner.post(f"/api/v1/trips/{trip['id']}/places", json=result)
    assert saved.status_code == 201
    place = saved.json()
    assert place["osm_element_type"] == "way"
    assert place["osm_element_id"] == "12345"
    assert place["display_name"] == "Secret Hotel, Taipei, Exampleland"
    # The exact target exists only on the owner route, not a public projection.
    navigation = owner.get(f"/api/v1/trips/{trip['id']}/places/{place['id']}/navigation")
    assert navigation.json() == {"url": "https://www.google.com/maps/dir/?api=1&destination=25.0330000%2C121.5650000", "exact": True}


def test_owner_can_select_a_broad_place_without_receiving_exact_places() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    exact = owner.post(
        f"/api/v1/trips/{trip['id']}/places",
        json={"locality": "Private Taipei address", "country_code": "TW"},
    ).json()

    saved = owner.post(
        f"/api/v1/trips/{trip['id']}/places/broad",
        json={"label": "Taipei", "country_code": "TW", "region": "Taipei City"},
    )
    assert saved.status_code == 201, saved.text
    assert saved.json()["kind"] == "broad"

    listed = owner.get(f"/api/v1/trips/{trip['id']}/places/broad")
    assert listed.status_code == 200
    assert listed.json() == [saved.json()]
    assert exact["id"] not in str(listed.json())

    other = client_for("owner-2")
    assert other.get(f"/api/v1/trips/{trip['id']}/places/broad").status_code == 404


def test_scoped_navigation_redacts_exact_place_and_falls_back_to_city_target() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    exact = owner.post(
        f"/api/v1/trips/{trip['id']}/places",
        json={
            "osm_element_type": "node",
            "osm_element_id": "7",
            "display_name": "Private house, Taipei",
            "latitude": 25.033,
            "longitude": 121.565,
            "locality": "Taipei",
            "country_code": "TW",
        },
    ).json()
    stage = owner.post(
        f"/api/v1/trips/{trip['id']}/route-stages",
        json={"position": 0, "label": "Taipei", "place": {"label": "Taipei", "country_code": "TW"}},
    ).json()

    denied_scope = scope(item("route_stage", stage["id"], "label", "navigation"))
    assert owner.put(f"/api/v1/trips/{trip['id']}/public-projection", json=denied_scope).status_code == 200
    slug = owner.post(f"/api/v1/trips/{trip['id']}/public-projection/publish").json()["slug"]
    anonymous = TestClient(app)
    projection = anonymous.get(f"/api/v1/public/trips/{slug}").json()
    assert projection["navigation"] == [{"id": "route_stage-1"}]
    assert str(exact["osm_element_id"]) not in str(projection)
    assert "Private house" not in str(projection)
    assert "latitude" not in str(projection)
    assert anonymous.get(
        f"/api/v1/public/trips/{slug}/navigation/exact_place-1", follow_redirects=False
    ).status_code == 404

    city = anonymous.get(f"/api/v1/public/trips/{slug}/navigation/route_stage-1", follow_redirects=False)
    assert city.status_code == 302
    assert city.headers["location"] == "https://www.google.com/maps/dir/?api=1&destination=Taipei%2C+TW"

    exact_scope = scope(
        item("route_stage", stage["id"], "label", "navigation"), item("exact_place", exact["id"], "navigation")
    )
    assert owner.put(f"/api/v1/trips/{trip['id']}/public-projection", json=exact_scope).status_code == 200
    authorized = anonymous.get(
        f"/api/v1/public/trips/{slug}/navigation/exact_place-2", follow_redirects=False
    )
    assert authorized.status_code == 302
    assert "destination=25.0330000%2C121.5650000" in authorized.headers["location"]


def test_unlisted_navigation_requires_its_own_exact_place_capability() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    exact = owner.post(
        f"/api/v1/trips/{trip['id']}/places",
        json={"osm_element_type": "node", "osm_element_id": "7", "latitude": 25.033, "longitude": 121.565},
    ).json()
    link = owner.post(
        f"/api/v1/trips/{trip['id']}/share-links",
        json={"label": "Family", "scope": scope()},
    ).json()
    token = activate(owner, trip["id"], link["id"])["token"]
    anonymous = TestClient(app)
    assert anonymous.get(f"/api/v1/shared/{token}/navigation/exact_place-1", follow_redirects=False).status_code == 404

    widened = owner.patch(
        f"/api/v1/trips/{trip['id']}/share-links/{link['id']}",
        json={"scope": scope(item("exact_place", exact["id"], "navigation"))},
    )
    assert widened.status_code == 200
    allowed = anonymous.get(f"/api/v1/shared/{token}/navigation/exact_place-1", follow_redirects=False)
    assert allowed.status_code == 302
    assert "destination=25.0330000%2C121.5650000" in allowed.headers["location"]
    assert allowed.headers["cache-control"] == "no-store, private"
