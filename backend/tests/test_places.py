from fastapi.testclient import TestClient
from test_publication import activate, client_for, create_trip, engine, scope, share

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

    first = owner.post(f"/api/trips/{trip['id']}/places/search", json={"query": "Secret hotel"})
    second = owner.post(f"/api/trips/{trip['id']}/places/search", json={"query": "  Secret   hotel  "})
    assert first.status_code == 200
    assert second.status_code == 200
    assert provider.calls == 1
    result = first.json()["results"][0]
    assert first.json()["attribution"] == "Fake OSM attribution"
    assert "place_id" not in result

    # Reverse lookup returns the exact same selectable shape but leaves the
    # trip untouched until the owner separately saves/attaches a result.
    reversed_result = owner.post(
        f"/api/trips/{trip['id']}/places/reverse", json={"latitude": 25.033, "longitude": 121.565}
    )
    assert reversed_result.status_code == 200
    assert reversed_result.json()["results"] == [result]
    assert provider.reverse_calls == 1
    assert owner.get(f"/api/trips/{trip['id']}/locations").json() == []

    saved = owner.post(f"/api/trips/{trip['id']}/locations", json=result)
    assert saved.status_code == 201
    place = saved.json()
    assert place["osm_element_type"] == "way"
    assert place["osm_element_id"] == "12345"
    assert place["display_name"] == "Secret Hotel, Taipei, Exampleland"
    # The exact target exists only on the owner route, not a public projection.
    navigation = owner.get(f"/api/trips/{trip['id']}/locations/{place['id']}/navigation")
    assert navigation.json() == {
        "url": "https://www.google.com/maps/dir/?api=1&destination=25.0330000%2C121.5650000",
        "exact": True,
    }


def test_area_suggestion_is_owner_only_and_requires_explicit_selection() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}"
    provider = FakePlaceSearchProvider()
    app.dependency_overrides[get_place_search_service] = lambda: CachedPlaceSearchService(provider)

    new = owner.post(f"{base}/areas/suggest", json={"latitude": 25.033, "longitude": 121.565})
    assert new.status_code == 200, new.text
    assert new.json()["existing_area_id"] is None
    assert new.json()["area"]["latitude"] == 25.03
    assert new.json()["area"]["longitude"] == 121.56
    assert new.json()["area"]["timezone"] == "Asia/Taipei"
    assert owner.get(f"{base}/areas").json() == []

    created = owner.post(
        f"{base}/locations",
        json={
            "display_name": "Station",
            "latitude": 25.033,
            "longitude": 121.565,
            "locality": "Taipei",
            "new_area": new.json()["area"],
        },
    )
    assert created.status_code == 201, created.text
    area = owner.get(f"{base}/areas").json()[0]
    assert area["latitude"] == 25.03 and area["longitude"] == 121.56
    near = owner.post(f"{base}/areas/suggest", json={"latitude": 25.033, "longitude": 121.565})
    assert near.json()["existing_area_id"] == area["id"]
    assert provider.reverse_calls == 1
    assert (
        client_for("owner-2").post(f"{base}/areas/suggest", json={"latitude": 25.033, "longitude": 121.565}).status_code
        == 404
    )


def test_area_points_are_generalized_on_create_update_and_city_derivation() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}"
    created = owner.post(f"{base}/areas", json={"label": "Taipei", "latitude": 25.03371, "longitude": 121.56541})
    assert created.status_code == 201
    assert (created.json()["latitude"], created.json()["longitude"]) == (25.03, 121.57)
    updated = owner.patch(f"{base}/areas/{created.json()['id']}", json={"latitude": 25.03999, "longitude": 121.56123})
    assert (updated.json()["latitude"], updated.json()["longitude"]) == (25.04, 121.56)
    derived = owner.post(f"{base}/locations", json={"locality": "Tainan", "latitude": 22.99911, "longitude": 120.21237})
    assert derived.status_code == 201
    assert [(area["latitude"], area["longitude"]) for area in owner.get(f"{base}/areas").json()] == [
        (25.04, 121.56),
        (23.0, 120.21),
    ]
    no_city = owner.post(f"{base}/locations", json={"latitude": 21.12345, "longitude": 120.12345})
    assert no_city.status_code == 201
    assert owner.get(f"{base}/areas").json()[-1]["label"] == "Unassigned"
    assert owner.get(f"{base}/areas").json()[-1]["latitude"] is None


def test_owner_can_select_an_area_without_receiving_locations() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    exact = owner.post(
        f"/api/trips/{trip['id']}/locations",
        json={"display_name": "Private address", "country_code": "TW"},
    ).json()

    saved = owner.post(
        f"/api/trips/{trip['id']}/areas",
        json={"label": "Taipei", "country_code": "TW", "region": "Taipei City"},
    )
    assert saved.status_code == 201, saved.text

    listed = owner.get(f"/api/trips/{trip['id']}/areas")
    assert listed.status_code == 200
    assert [area["label"] for area in listed.json()] == ["Unassigned", "Taipei"]
    assert saved.json() in listed.json()
    assert exact["id"] not in str(listed.json())

    other = client_for("owner-2")
    assert other.get(f"/api/trips/{trip['id']}/areas").status_code == 404


def test_owner_can_delete_an_unused_area_and_its_direct_share_selection() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    place = owner.post(f"/api/trips/{trip['id']}/areas", json={"label": "Taipei"}).json()
    assert (
        owner.put(
            f"/api/trips/{trip['id']}/public-projection", json=scope(share(owner, trip["id"], "area", place["id"]))
        ).status_code
        == 200
    )

    deleted = owner.delete(f"/api/trips/{trip['id']}/areas/{place['id']}")
    assert deleted.status_code == 204
    assert owner.get(f"/api/trips/{trip['id']}/areas").json() == []
    assert owner.post(f"/api/trips/{trip['id']}/public-projection/preview").json()["places"] == []
    assert owner.get(f"/api/trips/{trip['id']}/public-projection").json()["scope"]["items"] == []


def test_owner_must_unlink_an_area_before_deleting_it() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    place = owner.post(f"/api/trips/{trip['id']}/areas", json={"label": "Taipei"}).json()
    assert owner.post(f"/api/trips/{trip['id']}/visits", json={"area_id": place["id"]}).status_code == 201

    rejected = owner.delete(f"/api/trips/{trip['id']}/areas/{place['id']}")
    assert rejected.status_code == 409
    assert rejected.json()["detail"] == "Dit gebied wordt nog gebruikt door: 1 bezoek. Pas of verwijder die eerst."


def test_a_shared_location_needs_a_public_name_and_never_discloses_its_address() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    location = owner.post(
        f"{trips_path}/locations",
        json={
            "osm_element_type": "node",
            "osm_element_id": "7",
            "display_name": "Beitou Hot Spring, 12 Guangming Road, Taipei",
            "address_line1": "12 Guangming Road",
            "postal_code": "112",
            "notes": "Booked for 3pm",
            "latitude": 25.137,
            "longitude": 121.507,
            "locality": "Taipei",
            "country_code": "TW",
        },
    ).json()
    assert location["visibility"] == "private"

    # Without a public name the location cannot be shared: its display name usually contains the address.
    rejected = owner.put(f"{trips_path}/visibility/location/{location['id']}", json={"visibility": "everyone"})
    assert rejected.status_code == 422
    assert "public name" in rejected.json()["detail"]
    assert (
        owner.patch(f"{trips_path}/locations/{location['id']}", json={"label": "Beitou hot spring"}).json()["label"]
        == "Beitou hot spring"
    )
    assert (
        owner.put(f"{trips_path}/visibility/location/{location['id']}", json={"visibility": "everyone"}).status_code
        == 200
    )
    # A shared location cannot lose its name.
    assert owner.patch(f"{trips_path}/locations/{location['id']}", json={"label": None}).status_code == 422

    slug = owner.post(f"{trips_path}/public-projection/publish").json()["slug"]
    anonymous = TestClient(app)
    delivered = anonymous.get(f"/api/public/trips/{slug}")
    assert delivered.json()["places"] == [
        {
            "id": delivered.json()["places"][0]["id"],
            "label": "Beitou hot spring",
            "country_code": "TW",
            "region": "Taipei",
            "latitude": 25.137,
            "longitude": 121.507,
        }
    ]
    for private in ("12 Guangming", "112", "Booked for 3pm", "osm_element", "Hot Spring, 12"):
        assert private not in delivered.text
    marker = delivered.json()["navigation"][0]["id"]
    assert marker == delivered.json()["places"][0]["id"]
    directions = anonymous.get(f"/api/public/trips/{slug}/navigation/{marker}", follow_redirects=False)
    assert directions.status_code == 302
    assert "destination=25.1370000%2C121.5070000" in directions.headers["location"]

    # Back to private: it is no longer delivered and its navigation stops resolving.
    owner.put(f"{trips_path}/visibility/location/{location['id']}", json={"visibility": "private"})
    assert anonymous.get(f"/api/public/trips/{slug}").json()["places"] == []
    assert anonymous.get(f"/api/public/trips/{slug}/navigation/{marker}", follow_redirects=False).status_code == 404


def test_a_shared_area_offers_a_city_level_navigation_target() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    area = owner.post(
        f"{trips_path}/areas", json={"label": "Taipei", "country_code": "TW", "latitude": 25.0, "longitude": 121.5}
    ).json()
    share(owner, trip["id"], "area", area["id"], "everyone")
    slug = owner.post(f"{trips_path}/public-projection/publish").json()["slug"]
    anonymous = TestClient(app)
    marker = anonymous.get(f"/api/public/trips/{slug}").json()["navigation"][0]["id"]
    city = anonymous.get(f"/api/public/trips/{slug}/navigation/{marker}", follow_redirects=False)
    assert city.status_code == 302
    assert city.headers["location"] == "https://www.google.com/maps/dir/?api=1&destination=Taipei%2C+TW"


def test_a_custom_location_reaches_only_the_link_that_lists_it() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    location = owner.post(
        f"{trips_path}/locations",
        json={
            "osm_element_type": "node",
            "osm_element_id": "7",
            "label": "Lookout",
            "latitude": 25.033,
            "longitude": 121.565,
        },
    ).json()
    listed = owner.post(f"{trips_path}/share-links", json={"label": "Family", "scope": scope()}).json()
    other = owner.post(f"{trips_path}/share-links", json={"label": "Friends", "scope": scope()}).json()
    listed_token, other_token = (activate(owner, trip["id"], link["id"])["token"] for link in (listed, other))
    anonymous = TestClient(app)
    assert anonymous.get(f"/api/shared/{listed_token}").json()["places"] == []

    selected = scope(share(owner, trip["id"], "location", location["id"]))
    assert owner.patch(f"{trips_path}/share-links/{listed['id']}", json={"scope": selected}).status_code == 200
    places = anonymous.get(f"/api/shared/{listed_token}").json()["places"]
    assert [place["label"] for place in places] == ["Lookout"]
    assert anonymous.get(f"/api/shared/{other_token}").json()["places"] == []
    allowed = anonymous.get(f"/api/shared/{listed_token}/navigation/{places[0]['id']}", follow_redirects=False)
    assert allowed.status_code == 302
    assert "destination=25.0330000%2C121.5650000" in allowed.headers["location"]
    assert allowed.headers["cache-control"] == "no-store, private"
    assert (
        anonymous.get(f"/api/shared/{other_token}/navigation/{places[0]['id']}", follow_redirects=False).status_code
        == 404
    )


def test_an_area_can_carry_and_change_its_time_zone() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    created = owner.post(f"/api/trips/{trip['id']}/areas", json={"label": "Linkou", "timezone": "Asia/Taipei"})
    assert created.status_code == 201, created.text
    assert created.json()["timezone"] == "Asia/Taipei"
    endpoint = f"/api/trips/{trip['id']}/areas/{created.json()['id']}"

    changed = owner.patch(endpoint, json={"timezone": "Europe/Brussels", "region": "Test"})
    assert changed.status_code == 200, changed.text
    assert (changed.json()["timezone"], changed.json()["label"]) == ("Europe/Brussels", "Linkou")
    assert owner.patch(endpoint, json={"timezone": "Mars/Olympus"}).status_code == 422
    assert owner.patch(endpoint, json={"latitude": 25.0}).status_code == 422
    assert client_for("owner-2").patch(endpoint, json={"timezone": "Asia/Taipei"}).status_code == 404

    # The zone helps the owner's views only; a shared projection never carries it.
    owner = client_for("owner-1")
    selected = {
        "schema_version": "travel/share-scope@1",
        "items": [share(owner, trip["id"], "area", created.json()["id"])],
    }
    assert owner.put(f"/api/trips/{trip['id']}/public-projection", json=selected).status_code == 200
    preview = owner.post(f"/api/trips/{trip['id']}/public-projection/preview")
    assert "Europe/Brussels" not in preview.text


def test_an_area_holds_its_locations_and_cannot_be_deleted_while_it_does() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    first = owner.post(
        f"{trips_path}/locations", json={"display_name": "Hotel", "locality": "Taipei", "country_code": "TW"}
    ).json()
    second = owner.post(
        f"{trips_path}/locations", json={"display_name": "Station", "locality": "Taipei", "country_code": "TW"}
    ).json()
    elsewhere = owner.post(
        f"{trips_path}/locations", json={"display_name": "Tea house", "locality": "Alishan", "country_code": "TW"}
    ).json()
    nowhere = owner.post(f"{trips_path}/locations", json={"display_name": "Roadside"}).json()

    assert first["area_id"] == second["area_id"] != elsewhere["area_id"] != nowhere["area_id"]
    areas = {area["label"]: area["id"] for area in owner.get(f"{trips_path}/areas").json()}
    assert areas == {"Taipei": first["area_id"], "Alishan": elsewhere["area_id"], "Unassigned": nowhere["area_id"]}

    refused = owner.delete(f"{trips_path}/areas/{first['area_id']}")
    assert refused.status_code == 409 and "2 locaties" in refused.json()["detail"]

    # A location can be moved to another area of this trip, but not to a foreign one or to a location.
    moved = owner.patch(f"{trips_path}/locations/{nowhere['id']}", json={"area_id": areas["Alishan"]})
    assert moved.status_code == 200 and moved.json()["area_id"] == areas["Alishan"]
    assert owner.patch(f"{trips_path}/locations/{nowhere['id']}", json={"area_id": None}).status_code == 422
    assert owner.patch(f"{trips_path}/locations/{nowhere['id']}", json={"area_id": first["id"]}).status_code == 422
    other_trip = create_trip(owner, "Other")
    foreign = owner.post(f"/api/trips/{other_trip['id']}/areas", json={"label": "Osaka"}).json()
    assert owner.patch(f"{trips_path}/locations/{nowhere['id']}", json={"area_id": foreign["id"]}).status_code == 422


def test_a_location_shows_its_address_only_when_the_owner_also_chooses_that() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    hotel = owner.post(
        f"{trips_path}/locations",
        json={
            "label": "Hotel Riverside",
            "display_name": "Hotel Riverside, 12 Guangming Road, Taipei, 112",
            "address_line1": "12 Guangming Road",
            "postal_code": "112",
            "locality": "Taipei",
            "country_code": "TW",
            "latitude": 25.0331,
            "longitude": 121.5651,
            "notes": "Room 402, ask for Mei.",
            "osm_element_type": "node",
            "osm_element_id": "99",
        },
    ).json()
    assert hotel["share_address"] is False
    share(owner, trip["id"], "location", hotel["id"], "everyone")
    slug = owner.post(f"{trips_path}/public-projection/publish").json()["slug"]
    anonymous = TestClient(app)

    without = anonymous.get(f"/api/public/trips/{slug}")
    (location,) = without.json()["places"]
    assert "address" not in location and location["label"] == "Hotel Riverside"
    assert "12 Guangming" not in without.text

    assert (
        owner.patch(f"{trips_path}/locations/{hotel['id']}", json={"share_address": True}).json()["share_address"]
        is True
    )
    with_address = anonymous.get(f"/api/public/trips/{slug}")
    (location,) = with_address.json()["places"]
    assert location["address"] == {"line1": "12 Guangming Road", "postal_code": "112", "locality": "Taipei"}
    # Still never the notes, the provider reference or the display name.
    for private in ("Room 402", "Mei", "osm_element", "Hotel Riverside, 12", "display_name"):
        assert private not in with_address.text

    # Turning it off again hides it at once.
    owner.patch(f"{trips_path}/locations/{hotel['id']}", json={"share_address": False})
    assert "address" not in anonymous.get(f"/api/public/trips/{slug}").json()["places"][0]


def test_an_update_and_a_stay_show_their_location_only_when_that_location_is_shared() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    trips_path = f"/api/trips/{trip['id']}"
    spring = owner.post(
        f"{trips_path}/locations",
        json={
            "label": "Warme bron van Beitou",
            "display_name": "Beitou Hot Spring, Taipei",
            "locality": "Taipei",
            "country_code": "TW",
            "latitude": 25.137,
            "longitude": 121.507,
        },
    ).json()
    update = owner.post(
        f"{trips_path}/travel-updates",
        json={
            "occurred_at": "2054-04-04T10:00:00Z",
            "title": "Soaking",
            "body": "A lovely bath.",
            "location": {"existing_location_id": spring["id"]},
        },
    ).json()
    assert update["area"]["label"] == "Taipei" and update["area_id"] is None
    share(owner, trip["id"], "travel_update", update["id"], "everyone")
    slug = owner.post(f"{trips_path}/public-projection/publish").json()["slug"]
    anonymous = TestClient(app)

    # The update shows its area (derived from the location) but not the location itself yet.
    (shown,) = anonymous.get(f"/api/public/trips/{slug}").json()["updates"]
    assert shown["place"]["label"] == "Taipei" and "location" not in shown

    share(owner, trip["id"], "location", spring["id"], "everyone")
    document = anonymous.get(f"/api/public/trips/{slug}").json()
    (shown,) = document["updates"]
    assert shown["location"]["label"] == "Warme bron van Beitou" and shown["location"]["latitude"] == 25.137
    # The location links to its directions through the same marker the places list uses.
    assert shown["location"]["id"] in {entry["id"] for entry in document["navigation"]}
    assert "Beitou Hot Spring, Taipei" not in str(document)
