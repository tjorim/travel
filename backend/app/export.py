"""Private per-trip owner export: canonical records as one JSON document (#119).

Every record kind lists the exported columns explicitly. A column added to a
model later is therefore *not* exported until it is reviewed and added here,
so credentials, capability verifiers or storage keys cannot leak by accident.
The document is generated section by section from a single database snapshot
(``stream_trip_export``) so a large trip is never materialised at once.
"""

import json
import logging
from collections.abc import Iterator
from datetime import UTC, date, datetime, time
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from .models import (
    AlternativeGroup,
    AlternativeGroupMember,
    Area,
    DocumentAsset,
    ImportRecord,
    Location,
    McpAuditEvent,
    MediaAsset,
    MediaDerivative,
    PackingBag,
    PackingItem,
    PackingList,
    PublicSurface,
    Route,
    RouteDocumentAsset,
    ShareLink,
    Stay,
    StoredObject,
    TravelUpdate,
    TravelUpdateMediaAsset,
    Trip,
    TripTask,
    Visit,
)

logger = logging.getLogger("travel.export")

EXPORT_SCHEMA_VERSION = "travel/trip-export@1"
EXPORT_AUDIT_ACTION = "trip.export"
_BATCH = 200

TRIP = ("id", "title", "summary", "starts_on", "ends_on", "created_at", "updated_at")
AREA = (
    "id", "visibility", "label", "region", "country_code", "latitude", "longitude", "timezone",
    "created_at", "updated_at",
)  # fmt: skip
LOCATION = (
    "id", "visibility", "area_id", "label", "share_address", "osm_element_type", "osm_element_id", "osm_url",
    "display_name", "address_line1", "address_line2", "locality", "admin_area", "postal_code", "country_code",
    "latitude", "longitude", "viewport_north", "viewport_south", "viewport_east", "viewport_west",
    "navigation_provider", "navigation_provider_place_id", "notes", "created_at", "updated_at",
)  # fmt: skip
VISIT = (
    "id", "visibility", "position", "area_id", "location_id", "title", "kind", "status", "starts_on", "ends_on",
    "start_time", "end_time", "notes", "summary", "share_time", "share_date_precision", "created_at", "updated_at",
)  # fmt: skip
STAY = (
    "id", "visibility", "area_id", "location_id", "check_in_date", "check_out_date", "check_in_time", "check_out_time",
    "status", "property_name", "website_url", "booking_reference", "contact_details", "notes",
    "share_date_precision", "created_at", "updated_at",
)  # fmt: skip
ROUTE = (
    "id", "visibility", "mode", "status", "label", "departure_area_id", "arrival_area_id", "departure_location_id",
    "arrival_location_id", "departs_on", "departs_at", "arrives_at", "departure_timezone", "arrival_timezone",
    "carrier", "service_reference", "travel_class", "booking_reference", "notes", "geometry", "created_at",
    "updated_at",
)  # fmt: skip
TRAVEL_UPDATE = (
    "id", "visibility", "share_id", "area_id", "location_id", "occurred_at", "date_precision", "title", "body",
    "private_notes", "created_at", "updated_at",
)  # fmt: skip
MEDIA_ASSET = (
    "id", "media_kind", "captured_at", "captured_local", "import_id", "raw_metadata", "created_at", "updated_at",
)  # fmt: skip
MEDIA_DERIVATIVE = (
    "id", "visibility", "media_asset_id", "processing_state", "processing_backend", "processing_started_at",
    "remove_audio", "duration_seconds", "purpose", "metadata_stripped_at", "review_state", "width", "height",
    "travel_update_id", "caption", "alt_text", "focal_x", "focal_y", "is_cover", "created_at",
)  # fmt: skip
IMPORT_RECORD = ("id", "provider", "provider_item_id", "state", "media_asset_id", "requested_at", "completed_at", "failure_code")  # fmt: skip
DOCUMENT = ("id", "document_kind", "title", "owner_metadata", "created_at", "updated_at")
TASK = (
    "id", "title", "notes", "due_date", "remind_at", "reminded_at", "links", "completed_at", "created_at",
    "updated_at",
)  # fmt: skip
PACKING_LIST = ("id", "name", "created_at")
PACKING_BAG = ("id", "name", "type", "position", "weight_limit_g")
PACKING_ITEM = (
    "id", "bag_id", "label", "quantity", "category", "packed", "position", "essential", "last_minute", "valuable",
    "cabin_only", "checked_only", "notes", "weight_g",
)  # fmt: skip
ALTERNATIVE_GROUP = ("id", "kind", "label", "created_at", "updated_at")
PUBLIC_SURFACE = ("slug", "state", "revision", "scope", "created_at", "updated_at")
SHARE_LINK = (
    "id", "label", "series_id", "state", "revision", "scope", "expires_at", "created_at", "updated_at",
    "activated_at", "revoked_at",
)  # fmt: skip
# Checksum metadata only; the bucket and object key never leave the server.
FILE_METADATA = {"sha256": "sha256", "byte_size": "byte_size", "content_type": "content_type", "state": "state"}


def _default(value: Any) -> Any:
    if isinstance(value, datetime | date | time):
        return value.isoformat()
    raise TypeError(f"Cannot export {type(value).__name__}")


def _dump(value: Any) -> str:
    return json.dumps(value, default=_default, ensure_ascii=False, separators=(",", ":"))


def _record(row: Any, columns: tuple[str, ...]) -> dict[str, Any]:
    return {column: getattr(row, column) for column in columns}


def _file(stored: StoredObject | None) -> dict[str, Any] | None:
    if stored is None:
        return None
    return {name: getattr(stored, column) for name, column in FILE_METADATA.items()}


def _array(name: str, rows: Iterator[dict[str, Any]]) -> Iterator[str]:
    yield f",{_dump(name)}:["
    for index, row in enumerate(rows):
        yield ("," if index else "") + _dump(row)
    yield "]"


def _batched(session: Session, statement: Any) -> Any:
    return session.execute(statement.execution_options(yield_per=_BATCH))


def record_export(session: Session, *, subject: str, trip_id: str) -> None:
    """Record that an export happened, without any payload, then commit."""
    session.add(
        McpAuditEvent(
            owner_subject=subject,
            action=EXPORT_AUDIT_ACTION,
            resource_type="trip",
            resource_id=trip_id,
            trip_id=trip_id,
            result="success",
            details={"schema_version": EXPORT_SCHEMA_VERSION, "transport": "http"},
        )
    )
    session.commit()
    logger.info("trip export requested trip_id=%s schema=%s", trip_id, EXPORT_SCHEMA_VERSION)


def _sections(session: Session, trip: Trip) -> Iterator[Iterator[str]]:
    trip_id = trip.id
    owned = lambda model: select(model).where(model.trip_id == trip_id)  # noqa: E731

    def plain(model: Any, columns: tuple[str, ...], *order: Any) -> Iterator[dict[str, Any]]:
        for (row,) in _batched(session, owned(model).order_by(*order, model.id)):
            yield _record(row, columns)

    def updates() -> Iterator[dict[str, Any]]:
        links = {}
        for link in session.scalars(
            select(TravelUpdateMediaAsset)
            .join(TravelUpdate, TravelUpdate.id == TravelUpdateMediaAsset.travel_update_id)
            .where(TravelUpdate.trip_id == trip_id)
            .order_by(TravelUpdateMediaAsset.created_at, TravelUpdateMediaAsset.media_asset_id)
        ):
            links.setdefault(link.travel_update_id, []).append(link.media_asset_id)
        for (row,) in _batched(session, owned(TravelUpdate).order_by(TravelUpdate.occurred_at, TravelUpdate.id)):
            yield _record(row, TRAVEL_UPDATE) | {"media_asset_ids": links.get(row.id, [])}

    def routes() -> Iterator[dict[str, Any]]:
        documents = {}
        for link in session.scalars(
            select(RouteDocumentAsset)
            .join(Route, Route.id == RouteDocumentAsset.route_id)
            .join(DocumentAsset, DocumentAsset.id == RouteDocumentAsset.document_asset_id)
            .where(Route.trip_id == trip_id, DocumentAsset.deleted_at.is_(None))
            .order_by(RouteDocumentAsset.created_at, RouteDocumentAsset.document_asset_id)
        ):
            documents.setdefault(link.route_id, []).append(link.document_asset_id)
        for (row,) in _batched(session, owned(Route).order_by(Route.created_at, Route.id)):
            yield _record(row, ROUTE) | {"document_ids": documents.get(row.id, [])}

    def media_assets() -> Iterator[dict[str, Any]]:
        statement = (
            select(MediaAsset, StoredObject)
            .join(StoredObject, StoredObject.id == MediaAsset.original_object_id)
            .where(MediaAsset.trip_id == trip_id, MediaAsset.deleted_at.is_(None))
            .order_by(MediaAsset.created_at, MediaAsset.id)
        )
        for asset, stored in _batched(session, statement):
            yield _record(asset, MEDIA_ASSET) | {"original": _file(stored)}

    def derivatives() -> Iterator[dict[str, Any]]:
        main, poster = aliased(StoredObject), aliased(StoredObject)
        statement = (
            select(MediaDerivative, main, poster)
            .join(MediaAsset, MediaAsset.id == MediaDerivative.media_asset_id)
            .outerjoin(main, main.id == MediaDerivative.object_id)
            .outerjoin(poster, poster.id == MediaDerivative.poster_object_id)
            .where(MediaDerivative.trip_id == trip_id, MediaAsset.deleted_at.is_(None))
            .order_by(MediaDerivative.created_at, MediaDerivative.id)
        )
        for derivative, stored, poster_stored in _batched(session, statement):
            yield _record(derivative, MEDIA_DERIVATIVE) | {"file": _file(stored), "poster": _file(poster_stored)}

    def documents() -> Iterator[dict[str, Any]]:
        statement = (
            select(DocumentAsset, StoredObject)
            .join(StoredObject, StoredObject.id == DocumentAsset.original_object_id)
            .where(DocumentAsset.trip_id == trip_id, DocumentAsset.deleted_at.is_(None))
            .order_by(DocumentAsset.created_at, DocumentAsset.id)
        )
        for document, stored in _batched(session, statement):
            yield _record(document, DOCUMENT) | {"original": _file(stored)}

    def packing() -> Iterator[dict[str, Any]]:
        lists = list(session.scalars(owned(PackingList).order_by(PackingList.created_at, PackingList.id)))
        for packing_list in lists:
            bags = session.scalars(
                select(PackingBag)
                .where(PackingBag.list_id == packing_list.id)
                .order_by(PackingBag.position, PackingBag.id)
            )
            items = session.scalars(
                select(PackingItem)
                .where(PackingItem.list_id == packing_list.id)
                .order_by(PackingItem.position, PackingItem.id)
            )
            yield _record(packing_list, PACKING_LIST) | {
                "bags": [_record(bag, PACKING_BAG) for bag in bags],
                "items": [_record(item, PACKING_ITEM) for item in items],
            }

    def alternative_groups() -> Iterator[dict[str, Any]]:
        members: dict[str, list[dict[str, Any]]] = {}
        for member in session.scalars(
            select(AlternativeGroupMember)
            .join(AlternativeGroup, AlternativeGroup.id == AlternativeGroupMember.group_id)
            .where(AlternativeGroup.trip_id == trip_id)
            .order_by(AlternativeGroupMember.created_at, AlternativeGroupMember.id)
        ):
            members.setdefault(member.group_id, []).append({"record_id": member.record_id, "chosen": member.chosen})
        for (row,) in _batched(
            session, owned(AlternativeGroup).order_by(AlternativeGroup.created_at, AlternativeGroup.id)
        ):
            yield _record(row, ALTERNATIVE_GROUP) | {"members": members.get(row.id, [])}

    def publication() -> Iterator[str]:
        surface = session.get(PublicSurface, trip_id)
        yield f',"publication":{{"public_surface":{_dump(_record(surface, PUBLIC_SURFACE) if surface else None)}'
        links = (
            _record(link, SHARE_LINK)
            for (link,) in _batched(session, owned(ShareLink).order_by(ShareLink.created_at, ShareLink.id))
        )
        yield from _array("share_links", links)
        yield "}"

    yield _array("areas", plain(Area, AREA, Area.created_at))
    yield _array("locations", plain(Location, LOCATION, Location.created_at))
    yield _array("visits", plain(Visit, VISIT, Visit.position))
    yield _array("stays", plain(Stay, STAY, Stay.check_in_date))
    yield _array("routes", routes())
    yield _array("alternative_groups", alternative_groups())
    yield _array("travel_updates", updates())
    yield _array("media_assets", media_assets())
    yield _array("media_derivatives", derivatives())
    yield _array("import_records", plain(ImportRecord, IMPORT_RECORD, ImportRecord.requested_at))
    yield _array("documents", documents())
    yield _array("tasks", plain(TripTask, TASK, TripTask.created_at))
    yield _array("packing_lists", packing())
    yield publication()


def stream_trip_export(session: Session, trip: Trip) -> Iterator[str]:
    """Yield the export document in chunks; the caller owns ``session``'s snapshot."""
    exported_at = datetime.now(UTC)
    yield (
        f'{{"schema_version":{_dump(EXPORT_SCHEMA_VERSION)},"exported_at":{_dump(exported_at)},'
        f'"trip":{_dump(_record(trip, TRIP))}'
    )
    for section in _sections(session, trip):
        yield from section
    yield "}"
