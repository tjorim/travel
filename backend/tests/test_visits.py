from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from test_publication import share

from app.auth import current_subject
from app.database import Base, get_session
from app.main import app

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def override_session() -> Generator[Session]:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def client_for(subject: str) -> TestClient:
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[current_subject] = lambda: subject
    return TestClient(app)


def setup_function() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def teardown_function() -> None:
    app.dependency_overrides.clear()


def create_trip(client: TestClient, title: str = "Exampleland 2054") -> dict:
    response = client.post("/api/trips", json={"title": title})
    assert response.status_code == 201, response.text
    return response.json()


def make_area(client: TestClient, trip_id: str, label: str = "Taipei") -> str:
    response = client.post(f"/api/trips/{trip_id}/areas", json={"label": label, "country_code": "TW"})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_a_visit_needs_only_a_place() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    taipei = make_area(owner, trip["id"])
    base = f"/api/trips/{trip['id']}/visits"

    created = owner.post(base, json={"area_id": taipei})
    assert created.status_code == 201, created.text
    visit = created.json()
    assert visit["area"]["label"] == "Taipei" and visit["location"] is None
    assert visit["title"] is None and visit["starts_on"] is None and visit["start_time"] is None
    assert visit["visibility"] == "private" and visit["share_time"] is False
    assert visit["status"] == "planned"
    assert owner.get(base).json() == [visit]
    assert owner.get(f"{base}/{visit['id']}").json() == visit

    # Somewhere is required, and it must be on this trip.
    assert owner.post(base, json={"title": "Nowhere"}).status_code == 422
    other = create_trip(owner, "Elsewhere")
    assert owner.post(base, json={"area_id": make_area(owner, other["id"], "Osaka")}).status_code == 422


def test_a_visit_at_a_location_takes_the_locations_area() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    taipei, tainan = make_area(owner, trip["id"]), make_area(owner, trip["id"], "Tainan")
    base = f"/api/trips/{trip['id']}/visits"

    visit = owner.post(base, json={"location": {"display_name": "Beitou Hot Spring", "area_id": taipei}}).json()
    assert visit["area"]["id"] == taipei and visit["location"]["display_name"] == "Beitou Hot Spring"

    mismatch = owner.post(base, json={"location": {"display_name": "Somewhere", "area_id": taipei}, "area_id": tainan})
    assert mismatch.status_code == 422

    # Changing only the area drops a location that is no longer in it; the same area keeps it.
    assert owner.patch(f"{base}/{visit['id']}", json={"area_id": taipei}).json()["location"] is not None
    moved = owner.patch(f"{base}/{visit['id']}", json={"area_id": tainan}).json()
    assert moved["area"]["id"] == tainan and moved["location"] is None
    # A cleared location keeps the area.
    again = owner.post(base, json={"location": {"display_name": "Tea house", "area_id": taipei}}).json()
    cleared = owner.patch(f"{base}/{again['id']}", json={"location": None}).json()
    assert cleared["area"]["id"] == taipei and cleared["location"] is None


def test_days_and_times_are_optional_but_consistent() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    taipei = make_area(owner, trip["id"])
    base = f"/api/trips/{trip['id']}/visits"

    timed = owner.post(base, json={
        "area_id": taipei, "title": "Night market", "starts_on": "2054-11-21", "start_time": "18:30", "end_time": "21:00", "kind": "free",
    })
    assert timed.status_code == 201, timed.text
    assert timed.json()["start_time"] == "18:30:00" and timed.json()["kind"] == "free"

    for bad in (
        {"ends_on": "2054-11-22"},                                   # a last day needs a first day
        {"starts_on": "2054-11-22", "ends_on": "2054-11-21"},        # the last day cannot precede the first
        {"start_time": "10:00"},                                     # a time needs a day
        {"starts_on": "2054-11-21", "end_time": "10:00"},            # an end time needs a start time
        {"starts_on": "2054-11-21", "start_time": "10:00", "end_time": "09:00"},  # it must end after it starts
    ):
        assert owner.post(base, json={"area_id": taipei, **bad}).status_code == 422, bad

    # A multi-day visit may end at an earlier time of day; an edit is checked against what is stored.
    multi = owner.post(base, json={"area_id": taipei, "starts_on": "2054-11-21", "ends_on": "2054-11-23", "start_time": "18:00", "end_time": "10:00"})
    assert multi.status_code == 201, multi.text
    visit = timed.json()
    assert owner.patch(f"{base}/{visit['id']}", json={"end_time": "18:00"}).status_code == 422
    assert owner.patch(f"{base}/{visit['id']}", json={"starts_on": None}).status_code == 422
    assert owner.patch(f"{base}/{visit['id']}", json={"share_time": None}).status_code == 422
    assert owner.post(base, json={"area_id": taipei, "kind": "travel"}).status_code == 422


def test_visits_can_be_reordered_and_the_order_is_compacted() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}/visits"
    areas = [make_area(owner, trip["id"], label) for label in ("Taipei", "Tainan", "Kaohsiung")]
    visits = [owner.post(base, json={"area_id": area, "title": title}).json() for area, title in zip(areas, ("A", "B", "C"), strict=True)]
    assert [visit["position"] for visit in visits] == [0, 1, 2]

    assert owner.patch(f"{base}/{visits[2]['id']}", json={"position": 0}).status_code == 200
    assert [(item["position"], item["title"]) for item in owner.get(base).json()] == [(0, "C"), (1, "A"), (2, "B")]

    assert owner.delete(f"{base}/{visits[0]['id']}").status_code == 204
    assert [(item["position"], item["title"]) for item in owner.get(base).json()] == [(0, "C"), (1, "B")]
    inserted = owner.post(base, json={"area_id": areas[0], "title": "D", "position": 0}).json()
    assert [item["title"] for item in owner.get(base).json()] == ["D", "C", "B"] and inserted["position"] == 0


def test_visits_are_owner_only() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    visit = owner.post(f"/api/trips/{trip['id']}/visits", json={"area_id": make_area(owner, trip["id"])}).json()
    other = client_for("owner-2")
    base = f"/api/trips/{trip['id']}/visits"
    assert other.get(base).status_code == 404
    assert other.get(f"{base}/{visit['id']}").status_code == 404
    assert other.patch(f"{base}/{visit['id']}", json={"title": "x"}).status_code == 404
    assert other.delete(f"{base}/{visit['id']}").status_code == 404


def test_a_shared_visit_shows_its_place_and_days_and_the_time_only_when_chosen() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    taipei = make_area(owner, trip["id"])
    assert owner.patch(f"/api/trips/{trip['id']}/areas/{taipei}", json={"timezone": "Asia/Taipei"}).status_code == 200
    base = f"/api/trips/{trip['id']}"
    visit = owner.post(f"{base}/visits", json={
        "area_id": taipei, "title": "Night market", "summary": "Street food.", "notes": "SECRET NOTE",
        "starts_on": "2054-11-21", "ends_on": "2054-11-22", "start_time": "18:30", "end_time": "21:00",
        "location": {"display_name": "Shilin, 101 Secret Street", "area_id": taipei},
    }).json()
    share(owner, trip["id"], "visit", visit["id"], "everyone")
    assert owner.put(f"{base}/public-projection", json={"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": []}).status_code == 200
    slug = owner.post(f"{base}/public-projection/publish").json()["slug"]

    def delivered() -> dict:
        response = TestClient(app).get(f"/api/public/trips/{slug}")
        for secret in ("SECRET NOTE", "Secret Street"):
            assert secret not in response.text
        return response.json()["visits"][0]

    shared = delivered()
    # The default precision is a month: never the days, never the time.
    assert shared["title"] == "Night market" and shared["summary"] == "Street food."
    assert shared["place"]["label"] == "Taipei" and shared["starts_on"] == "2054-11" and shared["ends_on"] == "2054-11"
    assert "start_time" not in shared and "timezone" not in shared and "location" not in shared

    owner.patch(f"{base}/visits/{visit['id']}", json={"share_date_precision": "day", "share_time": True})
    shared = delivered()
    assert shared["starts_on"] == "2054-11-21" and shared["ends_on"] == "2054-11-22"
    assert shared["start_time"] == "18:30" and shared["end_time"] == "21:00"
    # The times are local at the visit, so a viewer far away is told the zone to read them in.
    assert shared["timezone"] == "Asia/Taipei"

    # The time is only shown when the owner chose it, and only on a full date.
    owner.patch(f"{base}/visits/{visit['id']}", json={"share_time": False})
    assert "start_time" not in delivered()
    owner.patch(f"{base}/visits/{visit['id']}", json={"share_time": True, "share_date_precision": "month"})
    assert "start_time" not in delivered()


def test_a_visit_status_is_owner_only_planning_state() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}"
    visit = owner.post(f"{base}/visits", json={"area_id": make_area(owner, trip["id"]), "status": "idea"}).json()
    assert visit["status"] == "idea"
    assert owner.post(f"{base}/visits", json={"area_id": visit["area"]["id"], "status": "concept"}).status_code == 422
    assert owner.patch(f"{base}/visits/{visit['id']}", json={"status": None}).status_code == 422
    assert owner.patch(f"{base}/visits/{visit['id']}", json={"status": "confirmed"}).json()["status"] == "confirmed"
    owner.patch(f"{base}/visits/{visit['id']}", json={"status": "idea"})

    share(owner, trip["id"], "visit", visit["id"], "everyone")
    assert owner.put(f"{base}/public-projection", json={"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": []}).status_code == 200
    slug = owner.post(f"{base}/public-projection/publish").json()["slug"]
    shared = TestClient(app).get(f"/api/public/trips/{slug}").json()["visits"][0]
    assert "status" not in shared and "idea" not in shared.values()


def test_a_visit_without_a_title_goes_by_its_shared_location_or_its_area() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    taipei = make_area(owner, trip["id"])
    base = f"/api/trips/{trip['id']}"
    plain = owner.post(f"{base}/visits", json={"area_id": taipei}).json()
    share(owner, trip["id"], "visit", plain["id"], "everyone")
    assert owner.put(f"{base}/public-projection", json={"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": []}).status_code == 200
    slug = owner.post(f"{base}/public-projection/publish").json()["slug"]
    assert TestClient(app).get(f"/api/public/trips/{slug}").json()["visits"][0]["title"] == "Taipei"

    located = owner.patch(f"{base}/visits/{plain['id']}", json={"location": {"display_name": "Hot spring, 1 Road", "label": "Beitou hot spring", "area_id": taipei}}).json()
    # An unshared location is not named to visitors.
    assert TestClient(app).get(f"/api/public/trips/{slug}").json()["visits"][0]["title"] == "Taipei"
    share(owner, trip["id"], "location", located["location"]["id"], "everyone")
    assert TestClient(app).get(f"/api/public/trips/{slug}").json()["visits"][0]["title"] == "Beitou hot spring"
