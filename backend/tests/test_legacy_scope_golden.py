"""A stored scope that predates the audience date precision delivers exactly what it always did (#236).

This file deliberately imports nothing that was added with the audience setting, so it runs unchanged on the
code before that change; both produce the same golden output."""

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_publication import (  # noqa: F401
    client_for,
    create_trip,
    engine,
    setup_function,
    share,
    teardown_function,
)

from app.main import app
from app.models import PublicSurface, SurfaceState


def _rich_trip(owner: TestClient) -> dict:
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}"
    owner.patch(base, json={"starts_on": "2054-04-01", "ends_on": "2054-04-20"})
    area = owner.post(f"{base}/areas", json={"label": "Taipei", "country_code": "TW"}).json()
    records = {}
    for index, precision in enumerate(("day", "month", "year")):
        visit = owner.post(
            f"{base}/visits",
            json={
                "area_id": area["id"],
                "title": f"Visit {precision}",
                "starts_on": f"2054-04-0{index + 4}",
                "ends_on": f"2054-04-0{index + 6}",
                "start_time": "18:30",
                "share_time": True,
                "share_date_precision": precision,
            },
        ).json()
        stay = owner.post(
            f"{base}/stays",
            json={
                "area_id": area["id"],
                "check_in_date": f"2054-04-0{index + 1}",
                "check_out_date": f"2054-04-0{index + 3}",
                "share_date_precision": precision,
            },
        ).json()
        update = owner.post(
            f"{base}/travel-updates",
            json={
                "occurred_at": f"2054-04-0{index + 4}T10:00:00Z",
                "date_precision": precision,
                "title": f"Update {precision}",
                "body": "Landed.",
                "area_id": area["id"],
            },
        ).json()
        for kind, record in (("visit", visit), ("stay", stay), ("travel_update", update)):
            share(owner, trip["id"], kind, record["id"], "everyone")
        records[precision] = (visit, stay, update)
    return trip


def test_a_legacy_scope_delivers_exactly_what_it_delivered_before_audiences_set_a_precision() -> None:
    owner = client_for("owner-1")
    trip = _rich_trip(owner)
    # The stored scope of a live audience from before ``defaults`` existed: no such key at all.
    with Session(engine) as session:
        session.add(
            PublicSurface(
                trip_id=trip["id"],
                state=SurfaceState.PUBLISHED,
                scope={
                    "schema_version": "travel/share-scope@1",
                    "trip": {"title": True, "summary": True, "dates": "month"},
                    "items": [],
                },
            )
        )
        session.commit()
        slug = session.scalar(select(PublicSurface.slug))

    document = TestClient(app).get(f"/api/public/trips/{slug}").json()

    assert document["dates"] == {"starts_on": "2054-04", "ends_on": "2054-04", "date_precision": "month"}
    assert [
        (v["title"], v["starts_on"], v["ends_on"], v["date_precision"], v.get("start_time")) for v in document["visits"]
    ] == [
        ("Visit day", "2054-04-04", "2054-04-06", "day", "18:30"),
        ("Visit month", "2054-04", "2054-04", "month", None),
        ("Visit year", "2054", "2054", "year", None),
    ]
    assert [(s["starts_on"], s["ends_on"], s["date_precision"]) for s in document["stays"]] == [
        ("2054-04-01", "2054-04-03", "day"),
        ("2054-04", "2054-04", "month"),
        ("2054", "2054", "year"),
    ]
    assert [(u["title"], u["story_date"], u["date_precision"]) for u in document["updates"]] == [
        ("Update day", "2054-04-04", "day"),
        ("Update month", "2054-04", "month"),
        ("Update year", "2054", "year"),
    ]
