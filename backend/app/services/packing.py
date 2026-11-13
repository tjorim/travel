"""Packing lists, bags, items and templates. Owner-only; never used by visitor projections."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import RecordNotFound, Refusal
from ..models import PackingBag, PackingItem, PackingList, PackingTemplate, Trip
from ..schemas import (
    Identifier,
    PackingBagCreate,
    PackingBagUpdate,
    PackingItemCreate,
    PackingItemUpdate,
    PackingListCreate,
    PackingListUpdate,
    PackingTemplateCreate,
)
from .trips import owned_trip

MAX_BATCH_ITEMS = 100


def owned_list(session: Session, subject: str, trip_id: Identifier, list_id: Identifier) -> PackingList:
    owned_trip(session, trip_id, subject)
    result = session.scalar(select(PackingList).where(PackingList.id == list_id, PackingList.trip_id == trip_id))
    if result is None:
        raise RecordNotFound("Packing list not found")
    return result


def owned_bag(
    session: Session, subject: str, trip_id: Identifier, list_id: Identifier, bag_id: Identifier
) -> PackingBag:
    owned_list(session, subject, trip_id, list_id)
    result = session.scalar(select(PackingBag).where(PackingBag.id == bag_id, PackingBag.list_id == list_id))
    if result is None:
        raise RecordNotFound("Packing bag not found")
    return result


def owned_item(
    session: Session, subject: str, trip_id: Identifier, list_id: Identifier, item_id: Identifier
) -> PackingItem:
    owned_list(session, subject, trip_id, list_id)
    result = session.scalar(select(PackingItem).where(PackingItem.id == item_id, PackingItem.list_id == list_id))
    if result is None:
        raise RecordNotFound("Packing item not found")
    return result


def _bags(session: Session, list_id: Identifier) -> list[PackingBag]:
    return list(
        session.scalars(
            select(PackingBag).where(PackingBag.list_id == list_id).order_by(PackingBag.position, PackingBag.id)
        )
    )


def _items(session: Session, list_id: Identifier, bag_id: Identifier | None) -> list[PackingItem]:
    return list(
        session.scalars(
            select(PackingItem)
            .where(PackingItem.list_id == list_id, PackingItem.bag_id == bag_id)
            .order_by(PackingItem.position, PackingItem.id)
        )
    )


def _place(rows: list, row, position: int | None) -> None:
    rows = [existing for existing in rows if existing.id != row.id]
    rows.insert(min(position if position is not None else len(rows), len(rows)), row)
    for index, existing in enumerate(rows):
        existing.position = index


def _renumber(rows: list) -> None:
    for index, row in enumerate(rows):
        row.position = index


def _snapshot(session: Session, list_id: Identifier) -> dict:
    bags = _bags(session, list_id)
    items = list(session.scalars(select(PackingItem).where(PackingItem.list_id == list_id)))
    return {
        "bags": [
            {
                "id": bag.id,
                "name": bag.name,
                "type": bag.type,
                "position": bag.position,
                "weight_limit_g": bag.weight_limit_g,
            }
            for bag in bags
        ],
        "items": [
            {
                field: getattr(item, field)
                for field in (
                    "bag_id",
                    "label",
                    "quantity",
                    "category",
                    "position",
                    "essential",
                    "last_minute",
                    "valuable",
                    "cabin_only",
                    "checked_only",
                    "notes",
                    "weight_g",
                )
            }
            for item in items
        ],
    }


def _apply_snapshot(session: Session, list_id: Identifier, snapshot: dict, bag_offset: int) -> int:
    bag_ids = {}
    for bag in sorted(snapshot["bags"], key=lambda row: row["position"]):
        copy = PackingBag(
            list_id=list_id,
            name=bag["name"],
            type=bag["type"],
            position=bag_offset,
            weight_limit_g=bag["weight_limit_g"],
        )
        session.add(copy)
        session.flush()
        bag_ids[bag["id"]] = copy.id
        bag_offset += 1
    positions: dict[str | None, int] = {None: len(_items(session, list_id, None))}
    for item in sorted(snapshot["items"], key=lambda row: (row["bag_id"] or "", row["position"])):
        bag_id = bag_ids.get(item["bag_id"])
        position = positions.get(bag_id, 0)
        positions[bag_id] = position + 1
        session.add(
            PackingItem(
                list_id=list_id,
                bag_id=bag_id,
                position=position,
                packed=False,
                **{
                    field: item.get(field)
                    for field in (
                        "label",
                        "quantity",
                        "category",
                        "essential",
                        "last_minute",
                        "valuable",
                        "cabin_only",
                        "checked_only",
                        "notes",
                        "weight_g",
                    )
                },
            )
        )
    return bag_offset


def list_packing_lists(session: Session, subject: str, trip_id: Identifier) -> list[PackingList]:
    owned_trip(session, trip_id, subject)
    return list(
        session.scalars(
            select(PackingList).where(PackingList.trip_id == trip_id).order_by(PackingList.created_at, PackingList.id)
        )
    )


def create_packing_list(session: Session, subject: str, trip_id: Identifier, payload: PackingListCreate) -> PackingList:
    owned_trip(session, trip_id, subject)
    if payload.copy_from_list_id and payload.template_ids:
        raise Refusal("Choose a source list or templates", code="choose_a_source_list_or_templates")
    snapshots = []
    if payload.copy_from_list_id:
        source = session.scalar(
            select(PackingList)
            .join(Trip)
            .where(PackingList.id == payload.copy_from_list_id, Trip.owner_subject == subject)
        )
        if source is None:
            raise RecordNotFound("Source packing list not found")
        snapshots.append(_snapshot(session, source.id))
    if len(set(payload.template_ids)) != len(payload.template_ids):
        raise Refusal("Choose each template once", code="choose_each_template_once")
    for template_id in payload.template_ids:
        template = session.scalar(
            select(PackingTemplate).where(PackingTemplate.id == template_id, PackingTemplate.owner_subject == subject)
        )
        if template is None:
            raise RecordNotFound("Packing template not found")
        snapshots.append(template.snapshot)
    result = PackingList(trip_id=trip_id, name=payload.name)
    session.add(result)
    session.flush()
    offset = 0
    for snapshot in snapshots:
        offset = _apply_snapshot(session, result.id, snapshot, offset)
    session.flush()
    return result


def save_packing_template(
    session: Session, subject: str, trip_id: Identifier, list_id: Identifier, payload: PackingTemplateCreate
) -> PackingTemplate:
    owned_list(session, subject, trip_id, list_id)
    template = PackingTemplate(owner_subject=subject, name=payload.name, snapshot=_snapshot(session, list_id))
    session.add(template)
    session.flush()
    return template


def list_packing_templates(session: Session, subject: str) -> list[PackingTemplate]:
    return list(
        session.scalars(
            select(PackingTemplate)
            .where(PackingTemplate.owner_subject == subject)
            .order_by(PackingTemplate.created_at, PackingTemplate.id)
        )
    )


def list_packing_sources(session: Session, subject: str) -> list[dict[str, str]]:
    rows = session.execute(
        select(PackingList.id, PackingList.name, Trip.title, Trip.id)
        .join(Trip)
        .where(Trip.owner_subject == subject)
        .order_by(Trip.title, PackingList.name, PackingList.id)
    )
    return [
        {"id": list_id, "name": name, "trip_title": title, "trip_id": trip_id} for list_id, name, title, trip_id in rows
    ]


def packing_suggestions(session: Session, subject: str, trip_id: Identifier, list_id: Identifier) -> list[dict]:
    owned_list(session, subject, trip_id, list_id)
    present = {
        item.label.strip().casefold()
        for item in session.scalars(select(PackingItem).where(PackingItem.list_id == list_id))
    }
    history = session.execute(
        select(PackingItem, PackingBag.type, PackingList.trip_id)
        .join(PackingList, PackingItem.list_id == PackingList.id)
        .join(Trip, PackingList.trip_id == Trip.id)
        .outerjoin(PackingBag, PackingItem.bag_id == PackingBag.id)
        .where(Trip.owner_subject == subject, PackingList.trip_id != trip_id)
    )
    groups: dict[str, dict] = {}
    for item, bag_type, prior_trip_id in history:
        key = item.label.strip().casefold()
        if not key or key in present:
            continue
        group = groups.setdefault(
            key, {"label": item.label, "trip_ids": set(), "cabin": 0, "essential": 0, "category": item.category}
        )
        if prior_trip_id in group["trip_ids"]:
            continue
        group["trip_ids"].add(prior_trip_id)
        group["cabin"] += bag_type == "cabin"
        group["essential"] += item.essential
    return [
        {
            "label": group["label"],
            "category": group["category"],
            "prior_trips": len(group["trip_ids"]),
            "usually_cabin": group["cabin"] > len(group["trip_ids"]) / 2,
            "usually_essential": group["essential"] > len(group["trip_ids"]) / 2,
        }
        for group in sorted(groups.values(), key=lambda row: (-len(row["trip_ids"]), row["label"]))
        if len(group["trip_ids"]) >= 3
    ][:8]


def delete_packing_template(session: Session, subject: str, template_id: Identifier) -> None:
    template = session.scalar(
        select(PackingTemplate).where(PackingTemplate.id == template_id, PackingTemplate.owner_subject == subject)
    )
    if template is None:
        raise RecordNotFound("Packing template not found")
    session.delete(template)
    session.flush()


def get_packing_list(session: Session, subject: str, trip_id: Identifier, list_id: Identifier) -> PackingList:
    return owned_list(session, subject, trip_id, list_id)


def update_packing_list(
    session: Session, subject: str, trip_id: Identifier, list_id: Identifier, payload: PackingListUpdate
) -> PackingList:
    result = owned_list(session, subject, trip_id, list_id)
    result.name = payload.name
    session.flush()
    return result


def delete_packing_list(session: Session, subject: str, trip_id: Identifier, list_id: Identifier) -> None:
    session.delete(owned_list(session, subject, trip_id, list_id))
    session.flush()


def list_packing_bags(session: Session, subject: str, trip_id: Identifier, list_id: Identifier) -> list[PackingBag]:
    owned_list(session, subject, trip_id, list_id)
    return _bags(session, list_id)


def create_packing_bag(
    session: Session, subject: str, trip_id: Identifier, list_id: Identifier, payload: PackingBagCreate
) -> PackingBag:
    owned_list(session, subject, trip_id, list_id)
    rows = _bags(session, list_id)
    result = PackingBag(
        list_id=list_id, name=payload.name, type=payload.type, weight_limit_g=payload.weight_limit_g, position=len(rows)
    )
    session.add(result)
    _place(rows, result, payload.position)
    session.flush()
    return result


def get_packing_bag(
    session: Session, subject: str, trip_id: Identifier, list_id: Identifier, bag_id: Identifier
) -> PackingBag:
    return owned_bag(session, subject, trip_id, list_id, bag_id)


def update_packing_bag(
    session: Session,
    subject: str,
    trip_id: Identifier,
    list_id: Identifier,
    bag_id: Identifier,
    payload: PackingBagUpdate,
) -> PackingBag:
    result = owned_bag(session, subject, trip_id, list_id, bag_id)
    values = payload.model_dump(exclude_unset=True, exclude={"position"})
    if values.get("name", result.name) is None:
        raise Refusal("name is required", code="missing", field="name")
    for field, value in values.items():
        setattr(result, field, value)
    if payload.position is not None:
        _place(_bags(session, list_id), result, payload.position)
    session.flush()
    return result


def delete_packing_bag(
    session: Session, subject: str, trip_id: Identifier, list_id: Identifier, bag_id: Identifier
) -> None:
    result = owned_bag(session, subject, trip_id, list_id, bag_id)
    unassigned = _items(session, list_id, None)
    for item in _items(session, list_id, bag_id):
        item.bag_id = None
        item.position = len(unassigned)
        unassigned.append(item)
    session.flush()
    session.delete(result)
    _renumber([row for row in _bags(session, list_id) if row.id != bag_id])
    session.flush()


def list_packing_items(session: Session, subject: str, trip_id: Identifier, list_id: Identifier) -> list[PackingItem]:
    owned_list(session, subject, trip_id, list_id)
    return list(
        session.scalars(
            select(PackingItem)
            .where(PackingItem.list_id == list_id)
            .order_by(PackingItem.bag_id, PackingItem.position, PackingItem.id)
        )
    )


def _require_bag_in_list(session: Session, list_id: Identifier, bag_id: Identifier | None) -> None:
    if (
        bag_id is not None
        and session.scalar(select(PackingBag.id).where(PackingBag.id == bag_id, PackingBag.list_id == list_id)) is None
    ):
        raise Refusal("Bag must belong to this packing list", code="bag_must_belong_to_this_packing_list")


def _new_item(list_id: Identifier, payload: PackingItemCreate, session: Session) -> PackingItem:
    _require_bag_in_list(session, list_id, payload.bag_id)
    values = payload.model_dump(exclude={"position"})
    result = PackingItem(list_id=list_id, position=0, **values)
    session.add(result)
    _place(_items(session, list_id, payload.bag_id), result, payload.position)
    session.flush()
    return result


def create_packing_item(
    session: Session, subject: str, trip_id: Identifier, list_id: Identifier, payload: PackingItemCreate
) -> PackingItem:
    owned_list(session, subject, trip_id, list_id)
    return _new_item(list_id, payload, session)


def batch_create_packing_items(
    session: Session, subject: str, trip_id: Identifier, list_id: Identifier, payload: list[PackingItemCreate]
) -> list[PackingItem]:
    owned_list(session, subject, trip_id, list_id)
    if not 1 <= len(payload) <= MAX_BATCH_ITEMS:
        raise Refusal("Batch must contain 1 to 100 items", code="batch_must_contain_1_to_100_items")
    return [_new_item(list_id, item, session) for item in payload]


def get_packing_item(
    session: Session, subject: str, trip_id: Identifier, list_id: Identifier, item_id: Identifier
) -> PackingItem:
    return owned_item(session, subject, trip_id, list_id, item_id)


def update_packing_item(
    session: Session,
    subject: str,
    trip_id: Identifier,
    list_id: Identifier,
    item_id: Identifier,
    payload: PackingItemUpdate,
) -> PackingItem:
    result = owned_item(session, subject, trip_id, list_id, item_id)
    values = payload.model_dump(exclude_unset=True, exclude={"bag_id", "position"})
    for field in ("label", "quantity", "packed", "essential", "last_minute", "valuable", "cabin_only", "checked_only"):
        if field in values and values[field] is None:
            raise Refusal(f"{field} is required", code="missing", field=field)
    if values.get("cabin_only", result.cabin_only) and values.get("checked_only", result.checked_only):
        raise Refusal(
            "An item cannot be both cabin-only and checked-only",
            code="an_item_cannot_be_both_cabin_only_and_checked_only",
        )
    target_bag = payload.bag_id if "bag_id" in payload.model_fields_set else result.bag_id
    _require_bag_in_list(session, list_id, target_bag)
    if target_bag != result.bag_id:
        previous = _items(session, list_id, result.bag_id)
        result.bag_id = target_bag
        _renumber([row for row in previous if row.id != item_id])
        _place(_items(session, list_id, target_bag), result, payload.position)
    elif payload.position is not None:
        _place(_items(session, list_id, target_bag), result, payload.position)
    for field, value in values.items():
        setattr(result, field, value)
    session.flush()
    return result


def delete_packing_item(
    session: Session, subject: str, trip_id: Identifier, list_id: Identifier, item_id: Identifier
) -> None:
    result = owned_item(session, subject, trip_id, list_id, item_id)
    remaining = [row for row in _items(session, list_id, result.bag_id) if row.id != item_id]
    session.delete(result)
    _renumber(remaining)
    session.flush()
