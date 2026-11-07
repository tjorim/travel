"""Private per-trip JSON export (#119): inclusion, exclusion canaries, isolation, audit."""

import json
from collections.abc import Generator
from datetime import UTC, date, datetime, time

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.capability import generate_token, verifier_for
from app.database import Base, get_session
from app.export import EXPORT_AUDIT_ACTION, EXPORT_SCHEMA_VERSION
from app.main import app
from app.models import (
    Area,
    AuditEvent,
    DatePrecision,
    DerivativeProcessingState,
    DerivativePurpose,
    DerivativeReviewState,
    DocumentAsset,
    DocumentKind,
    EmergencyInfoEntry,
    EmergencyInfoKind,
    ImportProvider,
    ImportRecord,
    LinkState,
    Location,
    McpAuditEvent,
    MediaAsset,
    MediaDerivative,
    MediaKind,
    ObjectState,
    PackingBag,
    PackingItem,
    PackingList,
    PublicSurface,
    Route,
    RouteDocumentAsset,
    RouteMode,
    ShareLink,
    Stay,
    StoredObject,
    SurfaceState,
    TravelUpdate,
    TravelUpdateMediaAsset,
    Trip,
    TripTask,
    Visit,
)

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

# Values that must never appear anywhere in an export.
CANARIES = {
    "object_key": "canary-object-key/original-0001.bin",
    "poster_key": "canary-object-key/poster-0001.bin",
    "bucket": "canary-bucket-name",
    "token": generate_token(),
    "provider_session": "canary-provider-session-handle",
    "audit_note": "canary-audit-payload",
    "other_owner": "canary-other-owner-private-trip",
    "library": "canary-library-document-title",
    "emergency": "canary-emergency-contact-value",
    "worker": "canary-worker-source-key",
    "alert_error": "canary-alert-mail-error",
}
CANARIES["verifier"] = verifier_for(CANARIES["token"])


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


def _stored(session: Session, trip_id: str, key: str, *, sha: str) -> StoredObject:
    stored = StoredObject(
        trip_id=trip_id,
        bucket=CANARIES["bucket"],
        object_key=key,
        sha256=sha * 64,
        byte_size=12,
        content_type="image/jpeg",
        state=ObjectState.AVAILABLE,
    )
    session.add(stored)
    session.flush()
    return stored


def build_rich_trip(owner: str = "owner-1") -> dict[str, str]:
    """A synthetic trip with every exported record kind; returns the interesting ids."""
    with TestingSessionLocal() as session:
        trip = Trip(owner_subject=owner, title="Exampleland 2054", summary="Private plan", starts_on=date(2054, 5, 1))
        session.add(trip)
        session.flush()
        area = Area(trip_id=trip.id, label="Example City", timezone="Europe/Brussels")
        session.add(area)
        session.flush()
        location = Location(
            trip_id=trip.id,
            area_id=area.id,
            label="Hotel Example",
            address_line1="1 Synthetic Street",
            notes="private location note",
        )
        session.add(location)
        session.flush()
        visit = Visit(trip_id=trip.id, position=1, area_id=area.id, title="Museum", notes="private visit note")
        stay = Stay(
            trip_id=trip.id,
            area_id=area.id,
            location_id=location.id,
            check_in_date=date(2054, 5, 1),
            check_out_date=date(2054, 5, 3),
            check_in_time=time(15, 0),
            booking_reference="SYNTH-123",
        )
        route = Route(
            trip_id=trip.id,
            mode=RouteMode.TRAIN,
            departure_area_id=area.id,
            arrival_area_id=area.id,
            notes="private route note",
        )
        update = TravelUpdate(
            trip_id=trip.id,
            area_id=area.id,
            occurred_at=datetime(2054, 5, 2, 9, tzinfo=UTC),
            date_precision=DatePrecision.DAY,
            title="Arrived",
            body="Public body",
            private_notes="private update note",
        )
        session.add_all([visit, stay, route, update])
        session.flush()

        original = _stored(session, trip.id, CANARIES["object_key"], sha="a")
        poster = _stored(session, trip.id, CANARIES["poster_key"], sha="b")
        record = ImportRecord(
            trip_id=trip.id, provider=ImportProvider.GOOGLE_PHOTOS_PICKER, provider_item_id="item-1", state="completed"
        )
        session.add(record)
        session.flush()
        asset = MediaAsset(
            trip_id=trip.id,
            original_object_id=original.id,
            media_kind=MediaKind.PHOTO,
            import_id=record.id,
            raw_metadata={"camera": "Synthetic Cam"},
        )
        session.add(asset)
        session.flush()
        derivative = MediaDerivative(
            trip_id=trip.id,
            media_asset_id=asset.id,
            object_id=poster.id,
            purpose=DerivativePurpose.SHARE,
            review_state=DerivativeReviewState.APPROVED,
            processing_state=DerivativeProcessingState.READY,
            caption="A caption",
            travel_update_id=update.id,
        )
        session.add_all([derivative, TravelUpdateMediaAsset(travel_update_id=update.id, media_asset_id=asset.id)])

        doc_object = _stored(session, trip.id, "canary-object-key/doc.bin", sha="c")
        document = DocumentAsset(
            trip_id=trip.id,
            original_object_id=doc_object.id,
            document_kind=DocumentKind.BOOKING,
            title="Booking confirmation",
            owner_metadata={"note": "synthetic"},
        )
        session.add(document)
        session.flush()
        session.add(RouteDocumentAsset(route_id=route.id, document_asset_id=document.id))

        # Soft-deleted records are not live content.
        gone_object = _stored(session, trip.id, "canary-object-key/gone.bin", sha="d")
        session.add(
            MediaAsset(
                trip_id=trip.id,
                original_object_id=gone_object.id,
                media_kind=MediaKind.PHOTO,
                deleted_at=datetime(2054, 5, 4, tzinfo=UTC),
                raw_metadata={"camera": "deleted-asset-canary"},
            )
        )

        task = TripTask(trip_id=trip.id, title="Book the train", notes="private task note")
        session.add(task)
        session.flush()
        packing = PackingList(trip_id=trip.id, name="Carry-on")
        session.add(packing)
        session.flush()
        bag = PackingBag(list_id=packing.id, name="Daypack", position=0)
        session.add(bag)
        session.flush()
        session.add(PackingItem(list_id=packing.id, bag_id=bag.id, label="Charger", position=0))

        session.add(PublicSurface(trip_id=trip.id, state=SurfaceState.PUBLISHED, scope={"items": []}))
        link = ShareLink(
            trip_id=trip.id,
            label="Family",
            series_id="a" * 32,
            state=LinkState.ACTIVE,
            scope={"items": []},
            token=CANARIES["token"],
            token_verifier=CANARIES["verifier"],
        )
        session.add(link)
        session.flush()
        session.add(
            AuditEvent(
                trip_id=trip.id,
                actor_subject=owner,
                kind="share_link.create",
                target_type="share_link",
                target_id=link.id,
                details={"note": CANARIES["audit_note"]},
            )  # fmt: skip
        )
        session.add(
            McpAuditEvent(
                owner_subject=owner,
                action="trip.get",
                resource_type="trip",
                trip_id=trip.id,
                result="success",
                details={"note": CANARIES["audit_note"]},
            )  # fmt: skip
        )
        session.add(
            EmergencyInfoEntry(
                owner_subject=owner, kind=EmergencyInfoKind.CONTACT, label="x", value=CANARIES["emergency"]
            )
        )
        # Another owner's trip, with its own canary.
        session.add(Trip(owner_subject="owner-2", title=CANARIES["other_owner"]))
        session.commit()
        return {
            "trip": trip.id,
            "area": area.id,
            "location": location.id,
            "visit": visit.id,
            "stay": stay.id,
            "route": route.id,
            "update": update.id,
            "asset": asset.id,
            "derivative": derivative.id,
            "document": document.id,
            "task": task.id,
            "packing": packing.id,
            "link": link.id,
        }


def export(client: TestClient, trip_id: str):
    return client.get(f"/api/trips/{trip_id}/export")


def test_export_contains_every_canonical_record_kind_with_relationships() -> None:
    ids = build_rich_trip()
    response = export(client_for("owner-1"), ids["trip"])

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/json")
    assert "attachment" in response.headers["content-disposition"]
    assert response.headers["cache-control"] == "private, no-store"
    document = json.loads(response.text)

    assert document["schema_version"] == EXPORT_SCHEMA_VERSION == "travel/trip-export@1"
    assert datetime.fromisoformat(document["exported_at"]).tzinfo is not None
    assert document["trip"]["id"] == ids["trip"]
    assert "owner_subject" not in document["trip"]
    assert [row["id"] for row in document["areas"]] == [ids["area"]]
    assert document["locations"][0]["id"] == ids["location"]
    assert document["locations"][0]["area_id"] == ids["area"]
    assert document["locations"][0]["address_line1"] == "1 Synthetic Street"
    assert document["visits"][0]["notes"] == "private visit note"
    assert document["stays"][0]["location_id"] == ids["location"]
    assert document["stays"][0]["area_id"] == ids["area"]
    assert document["stays"][0]["booking_reference"] == "SYNTH-123"
    assert document["routes"][0]["document_ids"] == [ids["document"]]
    assert document["routes"][0]["notes"] == "private route note"
    assert document["travel_updates"][0]["private_notes"] == "private update note"
    assert document["travel_updates"][0]["media_asset_ids"] == [ids["asset"]]
    assert [row["id"] for row in document["media_assets"]] == [ids["asset"]]
    assert document["media_assets"][0]["raw_metadata"] == {"camera": "Synthetic Cam"}
    assert document["media_assets"][0]["original"]["sha256"] == "a" * 64
    assert document["media_derivatives"][0]["media_asset_id"] == ids["asset"]
    assert document["media_derivatives"][0]["travel_update_id"] == ids["update"]
    assert document["media_derivatives"][0]["file"]["sha256"] == "b" * 64
    assert document["documents"][0]["title"] == "Booking confirmation"
    assert document["tasks"][0]["notes"] == "private task note"
    packing = document["packing_lists"][0]
    assert packing["items"][0]["bag_id"] == packing["bags"][0]["id"]
    assert document["publication"]["public_surface"]["state"] == "published"
    link = document["publication"]["share_links"][0]
    assert link["id"] == ids["link"] and link["label"] == "Family"
    # Soft-deleted media is not live content.
    assert "deleted-asset-canary" not in response.text
    assert len(document["media_assets"]) == 1


def test_export_never_contains_files_keys_capabilities_or_other_data() -> None:
    ids = build_rich_trip()
    text = export(client_for("owner-1"), ids["trip"]).text

    for name, canary in CANARIES.items():
        assert canary not in text, name
    document = json.loads(text)
    banned = {"object_key", "bucket", "token", "token_verifier", "owner_subject", "source_key", "poster_object_id"}

    def walk(value: object) -> None:
        if isinstance(value, dict):
            assert not banned & value.keys(), banned & value.keys()
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(document)
    assert set(document) == {
        "schema_version", "exported_at", "trip", "areas", "locations", "visits", "stays", "routes",
        "alternative_groups", "travel_updates", "media_assets", "media_derivatives", "import_records", "documents", "tasks",
        "packing_lists", "publication",
    }  # fmt: skip
    assert set(document["publication"]) == {"public_surface", "share_links"}


def test_other_owners_trip_is_not_found_and_not_audited() -> None:
    ids = build_rich_trip()
    stranger = client_for("owner-2")
    assert export(stranger, ids["trip"]).status_code == 404
    assert export(stranger, "0" * 32).status_code == 404
    with TestingSessionLocal() as session:
        actions = list(session.scalars(select(McpAuditEvent.action).where(McpAuditEvent.action == EXPORT_AUDIT_ACTION)))
    assert actions == []


def test_each_export_is_audited_without_a_payload() -> None:
    ids = build_rich_trip()
    owner = client_for("owner-1")
    assert export(owner, ids["trip"]).status_code == 200
    assert export(owner, ids["trip"]).status_code == 200
    with TestingSessionLocal() as session:
        events = list(session.scalars(select(McpAuditEvent).where(McpAuditEvent.action == EXPORT_AUDIT_ACTION)))
    assert len(events) == 2
    for event in events:
        assert (event.owner_subject, event.trip_id, event.result) == ("owner-1", ids["trip"], "success")
        assert event.details == {"schema_version": EXPORT_SCHEMA_VERSION, "transport": "http"}


def test_export_is_read_only_and_requires_authentication() -> None:
    ids = build_rich_trip()
    owner = client_for("owner-1")
    assert owner.post(f"/api/trips/{ids['trip']}/export").status_code == 405
    app.dependency_overrides.pop(current_subject)
    assert TestClient(app).get(f"/api/trips/{ids['trip']}/export").status_code in {401, 403}
