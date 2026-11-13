"""Synthetic coordinates; privacy and lifecycle regression coverage."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from test_packing import TestingSessionLocal, client_for, setup_function, teardown_function  # noqa: F401

from app.models import LivePoint, LiveSession
from app.routers import live_location as live_router
from app.services import live_location as live


def start():
    client = client_for("owner")
    trip = client.post("/api/trips", json={"title": "Synthetic"}).json()["id"]
    root = f"/api/trips/{trip}/live-location"
    row = client.post(root, json={"source": "person.synthetic"}).json()
    path = f"{root}/{row['id']}"
    assert not row["enabled"]
    assert client.put(path, json={"enabled": True, "audiences": {"public": "1km"}}).status_code == 200
    return client, trip, root, row["id"], path


def payload(clock):
    return {"latitude": 12.345678, "longitude": 45.678912, "observed_at": clock.isoformat()}


def test_lifecycle_precision_expiry_retention(monkeypatch):
    clock = datetime.now(UTC)
    monkeypatch.setattr(live, "now", lambda: clock)
    client, trip, root, sid, path = start()
    data = payload(clock)
    assert client.post(path + "/positions", json=data).json() == {"accepted": True}
    assert client.post(path + "/positions", json=data).json() == {"accepted": False}
    with TestingSessionLocal() as session:
        result = live.current_for_audience(session, trip, "public")
        assert result == [
            {
                "latitude": 12.35,
                "longitude": 45.68,
                "observed_at": clock.isoformat(),
                "stale": False,
                "precision": "1km",
                "delay_seconds": 0,
                "expires_at": (clock + timedelta(hours=24)).isoformat(),
            }
        ]
        assert not live.current_for_audience(session, trip, "other")
    clock += timedelta(hours=1, microseconds=1)
    with TestingSessionLocal() as session:
        assert live.current_for_audience(session, trip, "public")[0]["stale"]
    clock += timedelta(hours=23)
    with TestingSessionLocal() as session:
        assert not live.current_for_audience(session, trip, "public")
        assert len(list(session.scalars(select(LivePoint)))) == 1
    assert client.post(path + "/positions", json=payload(clock)).status_code == 200
    assert client.put(path, json={"enabled": True, "audiences": {}}).status_code == 200
    clock += timedelta(seconds=31)
    assert client.post(path + "/positions", json=payload(clock)).status_code == 200
    with TestingSessionLocal() as session:
        assert not live.current_for_audience(session, trip, "public")
    assert len(client.get(path + "/tracks").json()["points"]) == 3
    assert client.delete(path + "/tracks").status_code == 204
    assert client.get(path + "/tracks").json() == {"points": [], "next": None}
    assert client.post(path + "/positions", json=payload(clock)).status_code == 409
    assert client.put(path, json={"enabled": False}).status_code == 200
    assert client.post(path + "/positions", json=payload(clock)).status_code == 409
    assert client.get(root).json()[0]["current"] is None


def test_validation_ownership_bounds_and_order(monkeypatch, caplog):
    clock = datetime.now(UTC)
    monkeypatch.setattr(live, "now", lambda: clock)
    client, trip, root, sid, path = start()
    for bad in [
        payload(clock - timedelta(minutes=6)),
        payload(clock + timedelta(seconds=31)),
        {**payload(clock), "latitude": 91},
        {**payload(clock), "secret": "do-not-echo"},
    ]:
        response = client.post(path + "/positions", json=bad)
        assert response.status_code == 422
        assert "do-not-echo" not in response.text and "12.345678" not in response.text
    assert client.post(path + "/positions", content=b" " * 4097).status_code == 413
    assert client.post(path + "/positions", json=payload(clock)).status_code == 200
    assert client.post(path + "/positions", json=payload(clock + timedelta(seconds=1))).status_code == 429
    assert client.post(path + "/positions", json=payload(clock - timedelta(seconds=1))).status_code == 409
    assert client.put(path, json={"enabled": True, "audiences": {"unknown": "exact"}}).status_code == 422
    assert client.put(path, json={"enabled": True, "audiences": {"public": "raw"}}).status_code == 422
    other = client_for("other")
    for route in [root, path + "/tracks"]:
        assert other.get(route).status_code == 404
    assert other.post(path + "/positions", json=payload(clock)).status_code == 404
    assert other.delete(path).status_code == 404
    assert other.put(path, json={"enabled": False}).status_code == 404
    assert other.delete(path + "/tracks").status_code == 404
    assert "12.345678" not in caplog.text and "45.678912" not in caplog.text
    owner = client_for("owner")
    second = owner.post("/api/trips", json={"title": "Other synthetic trip"}).json()["id"]
    assert owner.post(f"/api/trips/{second}/live-location/{sid}/positions", json=payload(clock)).status_code == 404
    assert owner.get(f"/api/trips/{second}/live-location/{sid}/tracks").status_code == 404


def test_projection_and_export_are_separate(monkeypatch):
    clock = datetime.now(UTC)
    monkeypatch.setattr(live, "now", lambda: clock)
    client, trip, root, sid, path = start()
    assert client.post(path + "/positions", json=payload(clock)).status_code == 200
    export = client.get(f"/api/trips/{trip}/export")
    assert export.status_code == 200
    assert "12.345678" not in export.text and "person.synthetic" not in export.text
    with TestingSessionLocal() as session:
        row = session.get(LiveSession, sid)
        assert row is not None
        row.audiences = {"public": "10km"}
        session.commit()
        assert live.current_for_audience(session, trip, "public")[0]["latitude"] == 12.3


def test_real_delivery_link_revocation_and_no_history_in_story_outputs(monkeypatch):
    import json

    from app.models import ShareLink, Trip
    from app.trip_pdf import PdfRequest, pdf_data

    clock = datetime.now(UTC)
    monkeypatch.setattr(live, "now", lambda: clock)
    client, trip, root, sid, path = start()
    assert client.post(path + "/positions", json=payload(clock)).status_code == 200
    base = f"/api/trips/{trip}"
    public = client.post(base + "/public-projection/publish").json()
    public_url = f"/api/public/trips/{public['slug']}"
    response = client.get(public_url)
    assert response.status_code == 200
    assert response.json()["current_locations"][0]["latitude"] == 12.35
    assert "12.345678" not in response.text and "person.synthetic" not in response.text
    assert "12.345678" not in client.get(public_url + "/feed.atom").text
    links = [client.post(base + "/share-links", json={"label": label}).json() for label in ["One", "Two"]]
    tokens = [client.post(base + f"/share-links/{link['id']}/activate", json={}).json()["token"] for link in links]
    assert (
        client.put(path, json={"enabled": True, "audiences": {"public": "10km", links[0]["id"]: "1km"}}).status_code
        == 200
    )
    one, two = [f"/api/shared/{token}" for token in tokens]
    assert client.get(one).json()["current_locations"][0]["latitude"] == 12.35
    assert "current_locations" not in client.get(two).json()
    with TestingSessionLocal() as session:
        for view in [
            PdfRequest(content="both", view="audience", audience="public", locale="en"),
            PdfRequest(content="both", view="private", confirm_private=True, locale="en"),
        ]:
            data, _ = pdf_data(session, session.get(Trip, trip), view)
            assert "12.345678" not in json.dumps(data) and "current_locations" not in data
        link = session.get(ShareLink, links[0]["id"])
        link.expires_at = clock - timedelta(seconds=1)
        session.commit()
    assert client.get(one).status_code == 404
    clock += timedelta(seconds=31)
    assert client.post(path + "/positions", json=payload(clock)).status_code == 200
    assert client.get(one).status_code == 404
    assert client.get(two).status_code == 200 and "current_locations" not in client.get(two).json()
    assert "12.345678" in client.get(path + "/export").text
    assert client.get(path + "/tracks?limit=1").json()["next"]
    next_id = client.get(path + "/tracks?limit=1").json()["next"]
    assert len(client.get(path + f"/tracks?after={next_id}").json()["points"]) == 1
    assert client.delete(base).status_code == 204
    with TestingSessionLocal() as session:
        assert not list(session.scalars(select(LivePoint)))


def test_failed_request_rate_limit_and_session_bound():
    client, trip, root, sid, path = start()
    for _ in range(19):
        assert client.post(root, json={"source": "device_tracker.synthetic"}).status_code == 201
    assert client.post(root, json={"source": "device_tracker.synthetic"}).status_code == 409
    live_router.ingestion_limiter.reset()
    try:
        for _ in range(120):
            assert client.post(path + "/positions", json={}).status_code == 422
        assert client.post(path + "/positions", json={}).status_code == 429
    finally:
        live_router.ingestion_limiter.reset()


def test_delays_cutoffs_audiences_sparse_tracks_and_inactivity(monkeypatch):
    clock = datetime(2026, 11, 9, tzinfo=UTC)
    monkeypatch.setattr(live, "now", lambda: clock)
    client, trip, root, sid, path = start()
    first = clock
    assert client.post(path + "/positions", json=payload(clock)).status_code == 200
    for delay in [0, 900, 1800, 3600, 7200, 86400]:
        response = client.put(path, json={"enabled": True, "audiences": {"public": "1km"}, "delays": {"public": delay}})
        assert response.status_code == 200
        assert response.json()["delays"] == {"public": delay}
        with TestingSessionLocal() as session:
            assert bool(live.current_for_audience(session, trip, "public")) == (delay == 0)
    # Keep the source active while the day-old point becomes eligible.
    clock = first + timedelta(hours=23)
    assert client.post(path + "/positions", json={**payload(clock), "latitude": 66.123456}).status_code == 200
    clock = first + timedelta(hours=24) - timedelta(microseconds=1)
    with TestingSessionLocal() as session:
        assert not live.current_for_audience(session, trip, "public")
    clock += timedelta(microseconds=1)
    with TestingSessionLocal() as session:
        result = live.current_for_audience(session, trip, "public")
        assert result[0]["observed_at"] == first.isoformat()
        assert result[0]["latitude"] == 12.35 and not result[0]["stale"]
        assert "66.123456" not in str(result) and "session_id" not in str(result)
        assert not live.current_for_audience(session, trip, "other")
    # Omitted delays preserve the configured delay.
    assert client.put(path, json={"enabled": True, "audiences": {"public": "10km"}}).json()["delays"] == {
        "public": 86400
    }
    clock = first + timedelta(hours=25)
    with TestingSessionLocal() as session:
        assert not live.current_for_audience(session, trip, "public")[0]["stale"]
    clock += timedelta(microseconds=1)
    with TestingSessionLocal() as session:
        assert live.current_for_audience(session, trip, "public")[0]["stale"]
    clock = first + timedelta(hours=47)
    with TestingSessionLocal() as session:
        assert not live.current_for_audience(session, trip, "public")  # latest observation is 24h old
    assert client.post(path + "/positions", json=payload(clock)).status_code == 200
    with TestingSessionLocal() as session:
        assert (
            live.current_for_audience(session, trip, "public")[0]["observed_at"]
            == (first + timedelta(hours=23)).isoformat()
        )
    assert client.delete(path + "/tracks").status_code == 204
    with TestingSessionLocal() as session:
        assert not live.current_for_audience(session, trip, "public")
    for delays in [{"public": -1}, {"public": 1}, {"other": 900}, {"public": "900"}]:
        assert (
            client.put(path, json={"enabled": True, "audiences": {"public": "exact"}, "delays": delays}).status_code
            == 422
        )


def test_delayed_public_and_links_revoke_disable_and_clock_order(monkeypatch):
    clock = datetime.now(UTC)
    monkeypatch.setattr(live, "now", lambda: clock)
    client, trip, root, sid, path = start()
    base = f"/api/trips/{trip}"
    links = [client.post(base + "/share-links", json={"label": label}).json() for label in ["One", "Two"]]
    tokens = [client.post(base + f"/share-links/{link['id']}/activate", json={}).json()["token"] for link in links]
    audiences = {"public": "10km", links[0]["id"]: "1km", links[1]["id"]: "exact"}
    delays = {"public": 1800, links[0]["id"]: 900, links[1]["id"]: 0}
    assert client.put(path, json={"enabled": True, "audiences": audiences, "delays": delays}).status_code == 200
    # Partial maps must never remove another audience's privacy delay.
    changed = client.put(path, json={"enabled": True, "audiences": audiences, "delays": {"public": 7200}})
    assert changed.status_code == 200
    assert changed.json()["delays"] == {**delays, "public": 7200}
    assert (
        client.put(path, json={"enabled": True, "audiences": audiences, "delays": {"public": 1800}}).status_code == 200
    )
    first = clock
    # Accepted future skew must not leak ahead of server time, even at zero delay.
    assert client.post(path + "/positions", json=payload(clock + timedelta(seconds=30))).status_code == 200
    public = client.post(base + "/public-projection/publish").json()
    urls = [f"/api/public/trips/{public['slug']}", *[f"/api/shared/{token}" for token in tokens]]
    assert all("current_locations" not in client.get(url).json() for url in urls)
    clock += timedelta(seconds=30)
    assert client.get(urls[2]).json()["current_locations"][0]["latitude"] == 12.345678
    clock = first + timedelta(seconds=930)
    assert client.post(path + "/positions", json={**payload(clock), "latitude": 66.123456}).status_code == 200
    assert client.get(urls[1]).json()["current_locations"][0]["latitude"] == 12.35
    assert "current_locations" not in client.get(urls[0]).json()
    clock = first + timedelta(seconds=1830)
    response = client.get(urls[0])
    assert response.json()["current_locations"][0]["latitude"] == 12.3
    assert response.headers["cache-control"] == "no-store"
    preview = client.post(base + "/public-projection/preview").json()["current_locations"][0]
    assert preview["latitude"] == 12.3 and preview["delay_seconds"] == 1800
    preview = client.post(base + f"/share-links/{links[0]['id']}/preview").json()["current_locations"][0]
    assert preview["latitude"] == 66.12 and preview["delay_seconds"] == 900
    assert client.post(base + f"/share-links/{links[0]['id']}/revoke").status_code == 200
    assert client.get(urls[1]).status_code == 404
    assert client.put(path, json={"enabled": False, "audiences": audiences}).status_code == 200
    assert all("current_locations" not in client.get(url).json() for url in [urls[0], urls[2]])
    assert client.put(path, json={"enabled": True, "audiences": audiences}).status_code == 200
    assert "current_locations" not in client.get(urls[0]).json()
    assert client.post(path + "/positions", json=payload(clock)).status_code == 200
    assert client.get(urls[1]).status_code == 404


def test_sparse_delay_freshness_exact_24h_boundary(monkeypatch):
    clock = datetime(2026, 11, 9, tzinfo=UTC)
    monkeypatch.setattr(live, "now", lambda: clock)
    client, trip, root, sid, path = start()
    first = clock
    assert client.post(path + "/positions", json=payload(clock)).status_code == 200
    assert (
        client.put(path, json={"enabled": True, "audiences": {"public": "1km"}, "delays": {"public": 7200}}).status_code
        == 200
    )
    clock = first + timedelta(hours=26)
    assert client.post(path + "/positions", json={**payload(clock), "latitude": 66.123456}).status_code == 200
    with TestingSessionLocal() as session:
        point = live.current_for_audience(session, trip, "public")[0]
        assert point["observed_at"] == first.isoformat() and point["stale"]
    clock += timedelta(microseconds=1)
    with TestingSessionLocal() as session:
        assert not live.current_for_audience(session, trip, "public")
    clock = first + timedelta(hours=28)
    with TestingSessionLocal() as session:
        assert live.current_for_audience(session, trip, "public")[0]["latitude"] == 66.12
