"""Owner requests cost the same whatever else the trip holds (#365)."""

from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.database import Base, get_session
from app.main import app

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
statements: list[str] = []
measured: list[str] = []  # every statement of every measured request in the test


@event.listens_for(engine, "connect")
def enable_foreign_keys(connection: object, _: object) -> None:
    connection.execute("PRAGMA foreign_keys=ON")


@event.listens_for(engine, "before_cursor_execute")
def count_statement(_connection, _cursor, statement, *_rest) -> None:
    statements.append(statement)


def override_session() -> Generator[Session]:
    with TestingSessionLocal() as session:
        yield session


def setup_function() -> None:
    measured.clear()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[current_subject] = lambda: "owner-1"


def teardown_function() -> None:
    app.dependency_overrides.clear()


def untouched(*tables: str) -> bool:
    """Whether none of the recorded statements read or write one of these tables."""
    return not any(
        f" {table} " in statement or f" {table}\n" in statement for statement in measured for table in tables
    )


def queries_for(call) -> int:
    statements.clear()
    response = call()
    assert response.status_code < 300, response.text
    measured.extend(statements)
    return len(statements)


def fill(client: TestClient, trip_id: str, size: int) -> None:
    """Give a trip ``size`` of every kind that the full trip graph used to load on each request."""
    base = f"/api/trips/{trip_id}"
    area = client.post(f"{base}/areas", json={"label": "Taipei", "country_code": "TW"}).json()
    for index in range(size):
        day = f"2054-04-{index % 27 + 1:02d}"
        assert client.post(f"{base}/trip-tasks", json={"title": f"Task {index}"}).status_code == 201
        assert (
            client.post(
                f"{base}/stays",
                json={"area_id": area["id"], "check_in_date": day, "check_out_date": "2054-04-28"},
            ).status_code
            == 201
        )
        assert client.post(
            f"{base}/routes",
            json={
                "mode": "train",
                "departure_area_id": area["id"],
                "arrival_area_id": area["id"],
                "departs_on": day,
                "departure_location": None,
            },
        ).status_code in (201, 422)
        assert (
            client.post(
                f"{base}/travel-updates",
                json={"occurred_at": f"{day}T10:00:00Z", "title": f"Update {index}", "area_id": area["id"]},
            ).status_code
            == 201
        )
        assert client.post(f"{base}/visits", json={"area_id": area["id"], "title": f"Visit {index}"}).status_code == 201


def test_a_task_write_costs_the_same_in_a_small_and_a_large_trip() -> None:
    client = TestClient(app)
    small = client.post("/api/trips", json={"title": "Small"}).json()["id"]
    large = client.post("/api/trips", json={"title": "Large"}).json()["id"]
    fill(client, small, 1)
    fill(client, large, 12)
    costs = []
    for trip_id in (small, large):
        base = f"/api/trips/{trip_id}/trip-tasks"
        task = client.get(base).json()[0]
        costs.append(
            (
                queries_for(lambda base=base: client.post(base, json={"title": "Another"})),
                queries_for(
                    lambda base=base, task=task: client.patch(f"{base}/{task['id']}", json={"completed": True})
                ),
                queries_for(lambda base=base, task=task: client.get(f"{base}/{task['id']}")),
                queries_for(lambda base=base, task=task: client.delete(f"{base}/{task['id']}")),
            )
        )
    assert costs[0] == costs[1]
    # Authorising the trip, reading the task and writing it: a handful, never a pass over the trip.
    assert max(costs[0]) <= 6
    assert untouched("stays", "routes", "travel_updates", "media_derivatives", "areas", "locations")


def test_a_packing_write_costs_the_same_in_a_small_and_a_large_trip() -> None:
    client = TestClient(app)
    small = client.post("/api/trips", json={"title": "Small"}).json()["id"]
    large = client.post("/api/trips", json={"title": "Large"}).json()["id"]
    fill(client, small, 1)
    fill(client, large, 12)
    costs = []
    for trip_id in (small, large):
        base = f"/api/trips/{trip_id}/packing-lists"
        packing_list = client.post(base, json={}).json()
        items = f"{base}/{packing_list['id']}/items"
        item = client.post(items, json={"label": "Passport"}).json()
        costs.append(
            (
                queries_for(lambda items=items: client.post(items, json={"label": "Charger"})),
                queries_for(
                    lambda items=items, item=item: client.patch(f"{items}/{item['id']}", json={"packed": True})
                ),
            )
        )
    assert costs[0] == costs[1]
    assert max(costs[0]) <= 8
    assert untouched("stays", "routes", "travel_updates", "media_derivatives", "areas", "locations", "trip_tasks")


def test_stay_route_visit_and_update_writes_do_not_pass_over_the_trip() -> None:
    client = TestClient(app)
    small = client.post("/api/trips", json={"title": "Small"}).json()["id"]
    large = client.post("/api/trips", json={"title": "Large"}).json()["id"]
    fill(client, small, 1)
    fill(client, large, 12)
    costs = []
    for trip_id in (small, large):
        base = f"/api/trips/{trip_id}"
        stay = client.get(f"{base}/stays").json()[0]
        update = client.get(f"{base}/travel-updates").json()[0]
        costs.append(
            (
                queries_for(
                    lambda base=base, stay=stay: client.patch(f"{base}/stays/{stay['id']}", json={"notes": "x"})
                ),
                queries_for(lambda base=base, stay=stay: client.get(f"{base}/stays/{stay['id']}")),
                queries_for(
                    lambda base=base, update=update: client.patch(
                        f"{base}/travel-updates/{update['id']}", json={"title": "x"}
                    )
                ),
                queries_for(lambda base=base: client.get(f"{base}/areas")),
            )
        )
    assert costs[0] == costs[1]


def test_the_trip_list_does_not_grow_with_the_updates_of_a_trip() -> None:
    client = TestClient(app)
    trip_id = client.post("/api/trips", json={"title": "Exampleland", "summary": "A trip."}).json()["id"]
    empty = client.get("/api/trips")
    assert empty.status_code == 200
    assert empty.json()[0]["travel_update_count"] == 0 and empty.json()[0]["last_update_at"] is None
    sizes = []
    for batch in range(3):
        for index in range(30):
            response = client.post(
                f"/api/trips/{trip_id}/travel-updates",
                json={
                    "occurred_at": f"2054-04-{batch + 1:02d}T10:00:00Z",
                    "title": f"Update {batch}-{index}",
                    "private_notes": "n" * 200,
                },
            )
            assert response.status_code == 201, response.text
        sizes.append(len(client.get("/api/trips").content))
    listed = client.get("/api/trips").json()[0]
    # More updates change the two figures, never the size of the list: no update is embedded in it.
    assert "travel_updates" not in listed
    assert listed["travel_update_count"] == 90
    assert listed["last_update_at"].startswith("2054-04-03T10:00:00")
    assert len(set(sizes)) == 1
    assert len(empty.content) < sizes[0] <= len(empty.content) + 40
    # Neither the trip nor its writes carry them: they are read from their own list.
    assert "travel_updates" not in client.get(f"/api/trips/{trip_id}").json()
    assert len(client.get(f"/api/trips/{trip_id}/travel-updates").json()) == 90


def test_reading_or_changing_a_trip_costs_the_same_whatever_it_holds() -> None:
    client = TestClient(app)
    small = client.post("/api/trips", json={"title": "Small"}).json()["id"]
    large = client.post("/api/trips", json={"title": "Large"}).json()["id"]
    fill(client, small, 1)
    fill(client, large, 12)
    costs = [
        (
            queries_for(lambda trip_id=trip_id: client.get(f"/api/trips/{trip_id}")),
            queries_for(lambda trip_id=trip_id: client.patch(f"/api/trips/{trip_id}", json={"summary": "x"})),
        )
        for trip_id in (small, large)
    ]
    assert costs[0] == costs[1]
    # The trip row, then its cover: never a pass over the stays, routes, updates or media copies.
    assert max(costs[0]) <= 4
    assert untouched("stays", "routes", "travel_updates", "areas", "locations", "trip_tasks")


def test_travel_updates_list_in_one_chronological_order_and_the_latest_are_its_tail() -> None:
    client = TestClient(app)
    trip_id = client.post("/api/trips", json={"title": "Exampleland"}).json()["id"]
    base = f"/api/trips/{trip_id}/travel-updates"
    # Created out of order.
    for title, at in [("C", "2054-04-03T10:00:00Z"), ("A", "2054-04-01T10:00:00Z"), ("B", "2054-04-02T10:00:00Z")]:
        assert client.post(base, json={"occurred_at": at, "title": title}).status_code == 201
    assert [item["title"] for item in client.get(base).json()] == ["A", "B", "C"]
    assert [item["title"] for item in client.get(base, params={"latest": 2}).json()] == ["B", "C"]
    assert [item["title"] for item in client.get(base, params={"limit": 1, "offset": 1}).json()] == ["B"]
    assert client.get(base, params={"latest": 0}).status_code == 422
    assert client.get(f"/api/trips/{trip_id}/travel-updates", params={"q": "b"}).json()[0]["title"] == "B"


def test_the_trip_list_costs_the_same_for_any_number_of_trips_and_is_bounded() -> None:
    client = TestClient(app)
    for index in range(3):
        client.post("/api/trips", json={"title": f"Trip {index}"})
    few = queries_for(lambda: client.get("/api/trips"))
    for index in range(3, 110):
        client.post("/api/trips", json={"title": f"Trip {index}"})
    many = queries_for(lambda: client.get("/api/trips"))
    assert few == many
    assert len(client.get("/api/trips").json()) == 100
    assert len(client.get("/api/trips", params={"limit": 5, "offset": 105}).json()) == 5
