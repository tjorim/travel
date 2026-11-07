"""A stay still undecided is delivered exactly as it was when it pointed at a placeholder location (#239).

The golden file was captured on the code before area-only stays existed, where an undecided stay was filed under a
shared city-level placeholder location. This file uses only the HTTP API and makes no assertion about a stay's
location, so it runs unchanged on that code and on the code after; both deliver the same documents for the public
view and for hidden links. The ids a visitor sees are hashes of random canonical ids, so they are masked.

Set ``TRAVEL_UPDATE_GOLDEN=1`` to rewrite the golden file after an intended change of the delivered documents."""

import json
import os
import re
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_publication import (  # noqa: F401
    activate,
    client_for,
    create_trip,
    engine,
    setup_function,
    teardown_function,
)

from app.main import app
from app.models import PublicSurface, SurfaceState

GOLDEN = Path(__file__).parent / "golden" / "area_only_stay_documents.json"
SCOPE = {"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": []}


def _mask(document: dict) -> dict:
    text = json.dumps(document, sort_keys=True)
    text = re.sub(r"(visit|stay|route|area|location|media_derivative)-[0-9a-f]{12}(-poster)?", r"\1-ID\2", text)
    text = re.sub(r"update-[0-9a-f]{32}", "update-ID", text)
    return json.loads(text)


def _world(owner: TestClient) -> dict:
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}"
    owner.patch(base, json={"starts_on": "2054-04-01", "ends_on": "2054-04-30"})
    areas = {
        name: owner.post(
            f"{base}/areas", json={"label": name, "country_code": "TW", "latitude": lat, "longitude": lon}
        ).json()
        for name, lat, lon in (
            ("Alpha", 25.04, 121.5),
            ("Beta", 23.0, 120.2),
            ("Gamma", 22.6, 120.3),
            ("Delta", 23.53, 120.8),
        )
    }
    # The kind of location a shared "stay in <city>" is filed under by an owner who named and shared it.
    stay_in_delta = owner.post(
        f"{base}/locations",
        json={
            "area_id": areas["Delta"]["id"],
            "label": "Verblijf in Delta",
            "display_name": "Verblijf in Delta",
            "latitude": 23.53,
            "longitude": 120.8,
        },
    ).json()
    private_hotel = owner.post(
        f"{base}/locations",
        json={
            "area_id": areas["Alpha"]["id"],
            "label": "Private Hotel",
            "display_name": "Private Hotel",
            "address_line1": "1 Secret Road",
            "latitude": 25.0412,
            "longitude": 121.5012,
        },
    ).json()

    def stay(name, day, **place):
        return owner.post(
            f"{base}/stays",
            json={
                **place,
                "check_in_date": f"2054-04-{day:02d}",
                "check_out_date": f"2054-04-{day + 2:02d}",
                "property_name": f"Property {name}",
                "booking_reference": f"BOOKING-{name}",
                "notes": f"private note {name}",
                **({"share_date_precision": "day"} if day % 2 else {"share_date_precision": "month"}),
            },
        ).json()

    stays = {
        "undecided_alpha": stay("A", 1, area_id=areas["Alpha"]["id"]),
        "undecided_beta": stay("B", 4, area_id=areas["Beta"]["id"]),
        "undecided_gamma": stay("C", 7, area_id=areas["Gamma"]["id"]),
        "undecided_alpha_again": stay("D", 10, area_id=areas["Alpha"]["id"]),
        "shared_place": stay("E", 13, location={"existing_location_id": stay_in_delta["id"]}),
        "private_hotel": stay("F", 16, location={"existing_location_id": private_hotel["id"]}),
        "undecided_private": stay("G", 19, area_id=areas["Alpha"]["id"]),
        "undecided_custom": stay("H", 22, area_id=areas["Beta"]["id"]),
    }
    for name in ("Alpha", "Beta", "Delta"):
        assert (
            owner.put(f"{base}/visibility/area/{areas[name]['id']}", json={"visibility": "everyone"}).status_code == 200
        )
    assert (
        owner.put(f"{base}/visibility/location/{stay_in_delta['id']}", json={"visibility": "everyone"}).status_code
        == 200
    )
    for name in (
        "undecided_alpha",
        "undecided_beta",
        "undecided_gamma",
        "undecided_alpha_again",
        "shared_place",
        "private_hotel",
    ):
        response = owner.put(f"{base}/visibility/stay/{stays[name]['id']}", json={"visibility": "everyone"})
        assert response.status_code == 200, response.text
    assert (
        owner.put(
            f"{base}/visibility/stay/{stays['undecided_custom']['id']}", json={"visibility": "custom"}
        ).status_code
        == 200
    )
    return {"trip": trip, "areas": areas, "stays": stays, "base": base}


def test_undecided_stays_are_delivered_exactly_as_when_they_pointed_at_a_placeholder() -> None:
    owner = client_for("owner-1")
    world = _world(owner)
    trip_id, base = world["trip"]["id"], world["base"]
    areas, stays = world["areas"], world["stays"]
    with Session(engine) as session:
        session.add(
            PublicSurface(
                trip_id=trip_id,
                state=SurfaceState.PUBLISHED,
                scope={**SCOPE, "trip": {**SCOPE["trip"], "dates": "month"}},
            )
        )
        session.commit()
        slug = session.scalar(select(PublicSurface.slug))

    def link(label: str, scope: dict) -> str:
        created = owner.post(f"{base}/share-links", json={"label": label, "scope": scope})
        assert created.status_code == 201, created.text
        return activate(owner, trip_id, created.json()["id"])["token"]

    custom = [{"kind": "stay", "id": stays["undecided_custom"]["id"]}]
    tokens = {
        "link_custom": link("Custom", {**SCOPE, "defaults": None, "items": custom}),
        "link_without_beta": link(
            "Without Beta",
            {**SCOPE, "defaults": None, "items": custom, "exclude": [{"kind": "area", "id": areas["Beta"]["id"]}]},
        ),
        "link_year": link("Year", {**SCOPE, "defaults": {"date_precision": "year"}, "items": custom}),
        "link_without_stay": link(
            "Without a stay",
            {**SCOPE, "defaults": None, "exclude": [{"kind": "stay", "id": stays["undecided_alpha"]["id"]}]},
        ),
    }
    anonymous = TestClient(app)
    documents = {"public": anonymous.get(f"/api/public/trips/{slug}").json()} | {
        name: anonymous.get(f"/api/shared/{token}").json() for name, token in tokens.items()
    }
    masked = {name: _mask(document) for name, document in documents.items()}
    rendered = json.dumps(masked, sort_keys=True, indent=1, ensure_ascii=False) + "\n"

    # Nothing private about any stay or its accommodation is ever delivered.
    for private_value in ("Property", "BOOKING-", "private note", "Private Hotel", "Secret Road", "25.0412"):
        assert private_value not in json.dumps(documents)
    assert all(len(document["stays"]) for name, document in documents.items() if name != "link_without_stay")

    if os.environ.get("TRAVEL_UPDATE_GOLDEN"):
        GOLDEN.write_text(rendered)
    assert rendered == GOLDEN.read_text()
