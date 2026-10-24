from sqlalchemy import select
from test_visits import TestingSessionLocal, client_for, create_trip, setup_function, teardown_function  # noqa: F401

from app.models import Trip
from app.overview import _locations_repeating_areas


def test_only_locations_that_repeat_their_area_are_flagged() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}"
    taoyuan = owner.post(
        f"{base}/areas", json={"label": "Taoyuan Airport", "latitude": 25.08, "longitude": 121.23}
    ).json()
    schiphol = owner.post(f"{base}/areas", json={"label": "Schiphol", "latitude": 52.33, "longitude": 4.74}).json()
    taipei = owner.post(f"{base}/areas", json={"label": "Taipei", "latitude": 25.05, "longitude": 121.51}).json()

    def add(area: dict, **values) -> str:
        response = owner.post(f"{base}/locations", json={"area_id": area["id"], **values})
        assert response.status_code == 201, response.text
        return response.json()["id"]

    tpe = add(taoyuan, label="TPE", latitude=25.0793, longitude=121.2346, display_name="Taoyuan Airport (TPE)")
    city = add(taipei, latitude=25.05, longitude=121.51, display_name="Taipei", locality="Taipei")
    # Legitimate places: a hotel near the city centre, an airport hotel a couple of kilometres away.
    add(taipei, latitude=25.047, longitude=121.51, display_name="Example Hotel Taipei North Gate", locality="Taipei")
    add(schiphol, latitude=52.3096, longitude=4.7555, display_name="Example Hotel Amsterdam Airport Schiphol")
    # Far from the area's point, even with an airport code.
    add(schiphol, label="AMS", latitude=52.9, longitude=4.9, display_name="Elders (AMS)")

    with TestingSessionLocal() as session:
        warnings = _locations_repeating_areas(session.scalars(select(Trip)).one())
    assert sorted((warning["code"], warning["id"]) for warning in warnings) == sorted(
        [("location_repeats_area", tpe), ("location_repeats_area", city)]
    )
