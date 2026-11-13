"""A stored scope that predates link exclusions delivers exactly what it always did (#237).

This file deliberately imports nothing that was added with exclusions, so it runs unchanged on the code before
that change; both produce the same golden output. The ids a visitor sees are hashes of random canonical ids, so
they are masked before the documents are compared."""

import json
import re
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_publication import (  # noqa: F401
    _photo_copy,
    activate,
    client_for,
    create_trip,
    engine,
    setup_function,
    teardown_function,
)

from app.audit import scope_fingerprint
from app.main import app
from app.models import CollectionMember, PublicSurface, ShareLink, SurfaceState
from app.storage import LocalObjectStorage, get_storage

GOLDEN = Path(__file__).parent / "golden" / "legacy_scope_documents.json"
LEGACY_SCOPE = {"schema_version": "travel/share-scope@1", "trip": {"title": True, "summary": True}, "items": []}


def _mask(document: dict) -> dict:
    text = json.dumps(document, sort_keys=True)
    text = re.sub(r"(visit|stay|route|area|location|media_derivative)-[0-9a-f]{12}(-poster)?", r"\1-ID\2", text)
    text = re.sub(r"update-[0-9a-f]{32}", "update-ID", text)
    return json.loads(text)


def _world(owner: TestClient, tmp_path: Path) -> dict:
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    trip = create_trip(owner)
    base = f"/api/trips/{trip['id']}"
    alpha = owner.post(
        f"{base}/areas", json={"label": "Alpha Town", "country_code": "TW", "latitude": 25.0, "longitude": 121.5}
    ).json()
    beta = owner.post(f"{base}/areas", json={"label": "Beta City", "latitude": 23.0, "longitude": 120.2}).json()
    hotel = owner.post(
        f"{base}/locations",
        json={"area_id": alpha["id"], "label": "Alpha Hotel", "latitude": 25.04, "longitude": 121.51},
    ).json()
    visit = owner.post(
        f"{base}/visits", json={"area_id": alpha["id"], "title": "Visit A", "starts_on": "2054-04-02"}
    ).json()
    stay = owner.post(
        f"{base}/stays",
        json={
            "location": {"existing_location_id": hotel["id"]},
            "check_in_date": "2054-04-01",
            "check_out_date": "2054-04-05",
        },
    ).json()
    route = owner.post(
        f"{base}/routes",
        json={"mode": "train", "label": "Rail", "departure_area_id": alpha["id"], "arrival_area_id": beta["id"]},
    ).json()
    update = owner.post(
        f"{base}/travel-updates",
        json={
            "occurred_at": "2054-04-04T10:00:00Z",
            "share_date_precision": "day",
            "title": "Update A",
            "body": "A safe note.",
            "area_id": alpha["id"],
        },
    ).json()
    custom = owner.post(
        f"{base}/visits", json={"area_id": beta["id"], "title": "Custom visit", "starts_on": "2054-04-12"}
    ).json()
    photo = _photo_copy(owner, trip["id"])
    owner.patch(f"{photo['path']}/presentation", json={"caption": "Photo", "travel_update_id": update["id"]})
    loose = _photo_copy(owner, trip["id"])
    owner.patch(f"{loose['path']}/presentation", json={"caption": "Cover"})
    owner.patch(base, json={"cover_derivative_id": loose["derivative"]["id"]})
    for kind, record in (
        ("area", alpha),
        ("area", beta),
        ("location", hotel),
        ("visit", visit),
        ("stay", stay),
        ("route", route),
        ("travel_update", update),
        ("media_derivative", loose["derivative"]),
    ):
        assert owner.put(f"{base}/visibility/{kind}/{record['id']}", json={"visibility": "everyone"}).status_code == 200
    assert owner.put(f"{base}/visibility/visit/{custom['id']}", json={"visibility": "custom"}).status_code == 200
    return {"trip": trip, "custom": custom}


def test_a_legacy_scope_delivers_the_same_documents_before_and_after_link_exclusions(tmp_path: Path) -> None:
    owner = client_for("owner-1")
    world = _world(owner, tmp_path)
    trip_id, custom = world["trip"]["id"], world["custom"]
    legacy_with_custom = {**LEGACY_SCOPE, "items": [{"kind": "visit", "id": custom["id"]}]}
    # Stored as a scope from before ``defaults`` and ``exclude`` existed: neither key is present.
    with Session(engine) as session:
        session.add(PublicSurface(trip_id=trip_id, state=SurfaceState.PUBLISHED, scope=LEGACY_SCOPE))
        session.commit()
        slug = session.scalar(select(PublicSurface.slug))
    created = owner.post(
        f"/api/trips/{trip_id}/share-links",
        json={"label": "Friends", "scope": {**legacy_with_custom, "defaults": None}},
    ).json()
    token = activate(owner, trip_id, created["id"])["token"]
    collection = owner.post("/api/collections", json={"label": "Family"}).json()
    with Session(engine) as session:
        session.add(CollectionMember(collection_id=collection["id"], trip_id=trip_id, scope=legacy_with_custom))
        session.commit()
        member_id = session.scalar(select(CollectionMember.id))
    owner.post(f"/api/collections/{collection['id']}/activate", json={"expires_in_days": 30})
    collection_token = owner.get(f"/api/collections/{collection['id']}").json()["token"]
    anonymous = TestClient(app)

    documents = {
        "public": anonymous.get(f"/api/public/trips/{slug}").json(),
        "link": anonymous.get(f"/api/shared/{token}").json(),
        "member": anonymous.get(f"/api/shared/{collection_token}/trips/{member_id}").json(),
    }
    masked = {name: _mask(document) for name, document in documents.items()}
    assert masked == json.loads(GOLDEN.read_text())

    # The stored scopes are untouched and fingerprint as they always did.
    with Session(engine) as session:
        assert session.get(PublicSurface, trip_id).scope == LEGACY_SCOPE
        assert scope_fingerprint(session.get(PublicSurface, trip_id).scope) == "34170560d3b78e3c"
        link = session.get(ShareLink, created["id"])
        assert "exclude" not in link.scope
