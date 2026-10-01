from test_visits import client_for, create_trip, make_area, setup_function, teardown_function  # noqa: F401


def _trip_with_flight(owner):
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}"
    ams = make_area(owner, trip["id"], "Amsterdam Schiphol")
    tpe = make_area(owner, trip["id"], "Taoyuan")
    hotel_area = make_area(owner, trip["id"], "Linkou")
    route = owner.post(
        f"{base}/routes",
        json={
            "mode": "flight",
            "departure_area_id": ams,
            "arrival_area_id": tpe,
            "departs_on": "2054-11-16",
            "carrier": "China Airlines",
            "service_reference": "EX101",
        },
    )
    assert route.status_code == 201, route.text
    return base, ams, tpe, hotel_area, route.json()


def _visit(owner, base, area, **values):
    response = owner.post(f"{base}/visits", json={"area_id": area, **values})
    assert response.status_code == 201, response.text
    return response.json()


def test_a_visit_that_restates_a_route_is_flagged_but_still_saved() -> None:
    owner = client_for("owner-1")
    base, ams, tpe, _, route = _trip_with_flight(owner)
    by_reference = _visit(owner, base, ams, title="Vertrek EX101", starts_on="2054-11-16")
    by_word = _visit(owner, base, ams, title="Vlucht naar Exampleland", starts_on="2054-11-16")
    by_carrier = _visit(owner, base, ams, title="Check-in", summary="China Airlines balie", starts_on="2054-11-16")
    for visit in (by_reference, by_word, by_carrier):
        assert [item["id"] for item in visit["possible_route_duplicates"]] == [route["id"]]
    assert len(owner.get(f"{base}/visits").json()) == 3
    listed = owner.get(f"{base}/visits").json()
    assert all(visit["possible_route_duplicates"] for visit in listed)


def test_legitimate_visits_on_a_travel_day_are_not_flagged() -> None:
    owner = client_for("owner-1")
    base, ams, tpe, linkou, _ = _trip_with_flight(owner)
    cases = [
        # A real stop at the airport, with nothing about the journey.
        _visit(owner, base, ams, title="Lunch bij de lounge", starts_on="2054-11-16"),
        _visit(owner, base, ams, title="Aankomst hotel", starts_on="2054-11-16"),
        # The right journey wording, but another day or another area.
        _visit(owner, base, ams, title="Vertrek EX101", starts_on="2054-11-18"),
        _visit(owner, base, linkou, title="Vertrek EX101", starts_on="2054-11-16"),
        # A work period is never a single journey, even if it mentions one.
        _visit(owner, base, tpe, title="Werken, vlucht EX101 gehad", starts_on="2054-11-16", ends_on="2054-11-20"),
        # No day at all.
        _visit(owner, base, ams, title="Vertrek EX101"),
    ]
    assert [visit["possible_route_duplicates"] for visit in cases] == [[]] * len(cases)


def test_a_cancelled_route_and_the_arrival_day_in_local_time() -> None:
    owner = client_for("owner-1")
    base, ams, tpe, _, route = _trip_with_flight(owner)
    arrival = owner.post(
        f"{base}/routes",
        json={
            "mode": "flight",
            "departure_area_id": tpe,
            "arrival_area_id": ams,
            "departs_at": "2054-12-06T15:15:00Z",
            "arrives_at": "2054-12-07T06:50:00Z",
            "departure_timezone": "Asia/Taipei",
            "arrival_timezone": "Europe/Amsterdam",
            "service_reference": "EX102",
        },
    ).json()
    landed = _visit(owner, base, ams, title="Aankomst EX102", starts_on="2054-12-07")
    assert [item["id"] for item in landed["possible_route_duplicates"]] == [arrival["id"]]

    owner.patch(f"{base}/routes/{arrival['id']}", json={"status": "cancelled"})
    assert owner.get(f"{base}/visits/{landed['id']}").json()["possible_route_duplicates"] == []


def test_the_trip_overview_lists_visits_that_restate_a_route() -> None:
    from sqlalchemy import select
    from test_visits import TestingSessionLocal

    from app.models import Trip
    from app.overview import _visits_restating_routes

    owner = client_for("owner-1")
    base, ams, _, _, _ = _trip_with_flight(owner)
    duplicate = _visit(owner, base, ams, title="Vertrek EX101", starts_on="2054-11-16")
    _visit(owner, base, ams, title="Lunch", starts_on="2054-11-16")
    with TestingSessionLocal() as session:
        trip = session.scalars(select(Trip)).one()
        warnings = _visits_restating_routes(trip)
    assert [(warning["code"], warning["id"]) for warning in warnings] == [("visit_restates_route", duplicate["id"])]


def test_a_draft_visit_is_checked_before_it_is_saved() -> None:
    owner = client_for("owner-1")
    base, ams, tpe, _, route = _trip_with_flight(owner)
    check = f"{base}/visits/route-check"
    hit = owner.post(check, json={"area_id": ams, "title": "Vertrek EX101", "starts_on": "2054-11-16"})
    assert hit.status_code == 200, hit.text
    assert [item["id"] for item in hit.json()] == [route["id"]]
    # Nothing is saved by a check, and an unrelated draft matches nothing.
    assert owner.get(f"{base}/visits").json() == []
    assert owner.post(check, json={"area_id": ams, "title": "Lunch", "starts_on": "2054-11-16"}).json() == []
    assert owner.post(check, json={"area_id": ams, "title": "Vertrek EX101"}).json() == []
    # A location stands for its area; a stranger's or unknown place is refused.
    airport = owner.post(f"{base}/locations", json={"display_name": "Schiphol", "area_id": ams}).json()
    assert owner.post(check, json={"location_id": airport["id"], "title": "EX101", "starts_on": "2054-11-16"}).json()
    assert owner.post(check, json={"location_id": "nope", "title": "EX101"}).status_code == 404
    assert owner.post(check, json={"title": "EX101"}).status_code == 422
    assert client_for("owner-2").post(check, json={"area_id": ams}).status_code == 404


def test_a_route_idea_is_not_a_route_a_visit_restates() -> None:
    owner = client_for("owner-1")
    base, ams, _, _, route = _trip_with_flight(owner)
    landed = _visit(owner, base, ams, title="Vertrek EX101", starts_on="2054-11-16")
    assert [item["id"] for item in landed["possible_route_duplicates"]] == [route["id"]]
    owner.patch(f"{base}/routes/{route['id']}", json={"status": "idea"})
    assert owner.get(f"{base}/visits/{landed['id']}").json()["possible_route_duplicates"] == []
