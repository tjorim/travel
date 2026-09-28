"""Owner-only packing data; never used by visitor projections."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..models import PackingBag, PackingItem, PackingList
from ..schemas import (
    PackingBagCreate,
    PackingBagResponse,
    PackingBagUpdate,
    PackingItemCreate,
    PackingItemResponse,
    PackingItemUpdate,
    PackingListCreate,
    PackingListResponse,
    PackingListUpdate,
)
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}/packing-lists", tags=["packing"])
SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def owned_list(trip_id: str, list_id: str, session: Session, subject: str) -> PackingList:
    owned_trip(session, trip_id, subject)
    result = session.scalar(select(PackingList).where(PackingList.id == list_id, PackingList.trip_id == trip_id))
    if result is None:
        raise HTTPException(404, "Packing list not found")
    return result


def owned_bag(trip_id: str, list_id: str, bag_id: str, session: Session, subject: str) -> PackingBag:
    owned_list(trip_id, list_id, session, subject)
    result = session.scalar(select(PackingBag).where(PackingBag.id == bag_id, PackingBag.list_id == list_id))
    if result is None:
        raise HTTPException(404, "Packing bag not found")
    return result


def owned_item(trip_id: str, list_id: str, item_id: str, session: Session, subject: str) -> PackingItem:
    owned_list(trip_id, list_id, session, subject)
    result = session.scalar(select(PackingItem).where(PackingItem.id == item_id, PackingItem.list_id == list_id))
    if result is None:
        raise HTTPException(404, "Packing item not found")
    return result


def _bags(session: Session, list_id: str) -> list[PackingBag]:
    return list(
        session.scalars(
            select(PackingBag).where(PackingBag.list_id == list_id).order_by(PackingBag.position, PackingBag.id)
        )
    )


def _items(session: Session, list_id: str, bag_id: str | None) -> list[PackingItem]:
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


@router.get("", response_model=list[PackingListResponse])
def list_packing_lists(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[PackingList]:
    owned_trip(session, trip_id, subject)
    return list(
        session.scalars(
            select(PackingList).where(PackingList.trip_id == trip_id).order_by(PackingList.created_at, PackingList.id)
        )
    )


@router.post("", response_model=PackingListResponse, status_code=201)
def create_packing_list(
    trip_id: str, payload: PackingListCreate, session: SessionDep, subject: SubjectDep
) -> PackingList:
    owned_trip(session, trip_id, subject)
    result = PackingList(trip_id=trip_id, name=payload.name)
    session.add(result)
    session.commit()
    session.refresh(result)
    return result


@router.get("/{list_id}", response_model=PackingListResponse)
def get_packing_list(trip_id: str, list_id: str, session: SessionDep, subject: SubjectDep) -> PackingList:
    return owned_list(trip_id, list_id, session, subject)


@router.patch("/{list_id}", response_model=PackingListResponse)
def update_packing_list(
    trip_id: str, list_id: str, payload: PackingListUpdate, session: SessionDep, subject: SubjectDep
) -> PackingList:
    result = owned_list(trip_id, list_id, session, subject)
    result.name = payload.name
    session.commit()
    return result


@router.delete("/{list_id}", status_code=204)
def delete_packing_list(trip_id: str, list_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    result = owned_list(trip_id, list_id, session, subject)
    session.delete(result)
    session.commit()
    return Response(status_code=204)


@router.get("/{list_id}/bags", response_model=list[PackingBagResponse])
def list_packing_bags(trip_id: str, list_id: str, session: SessionDep, subject: SubjectDep) -> list[PackingBag]:
    owned_list(trip_id, list_id, session, subject)
    return _bags(session, list_id)


@router.post("/{list_id}/bags", response_model=PackingBagResponse, status_code=201)
def create_packing_bag(
    trip_id: str, list_id: str, payload: PackingBagCreate, session: SessionDep, subject: SubjectDep
) -> PackingBag:
    owned_list(trip_id, list_id, session, subject)
    rows = _bags(session, list_id)
    result = PackingBag(
        list_id=list_id, name=payload.name, type=payload.type, weight_limit_g=payload.weight_limit_g, position=len(rows)
    )
    session.add(result)
    _place(rows, result, payload.position)
    session.commit()
    session.refresh(result)
    return result


@router.get("/{list_id}/bags/{bag_id}", response_model=PackingBagResponse)
def get_packing_bag(trip_id: str, list_id: str, bag_id: str, session: SessionDep, subject: SubjectDep) -> PackingBag:
    return owned_bag(trip_id, list_id, bag_id, session, subject)


@router.patch("/{list_id}/bags/{bag_id}", response_model=PackingBagResponse)
def update_packing_bag(
    trip_id: str, list_id: str, bag_id: str, payload: PackingBagUpdate, session: SessionDep, subject: SubjectDep
) -> PackingBag:
    result = owned_bag(trip_id, list_id, bag_id, session, subject)
    values = payload.model_dump(exclude_unset=True, exclude={"position"})
    if values.get("name", result.name) is None:
        raise HTTPException(422, "name is required")
    for field, value in values.items():
        setattr(result, field, value)
    if payload.position is not None:
        _place(_bags(session, list_id), result, payload.position)
    session.commit()
    return result


@router.delete("/{list_id}/bags/{bag_id}", status_code=204)
def delete_packing_bag(trip_id: str, list_id: str, bag_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    result = owned_bag(trip_id, list_id, bag_id, session, subject)
    unassigned = _items(session, list_id, None)
    for item in _items(session, list_id, bag_id):
        item.bag_id = None
        item.position = len(unassigned)
        unassigned.append(item)
    session.flush()
    session.delete(result)
    _renumber([row for row in _bags(session, list_id) if row.id != bag_id])
    session.commit()
    return Response(status_code=204)


@router.get("/{list_id}/items", response_model=list[PackingItemResponse])
def list_packing_items(trip_id: str, list_id: str, session: SessionDep, subject: SubjectDep) -> list[PackingItem]:
    owned_list(trip_id, list_id, session, subject)
    return list(
        session.scalars(
            select(PackingItem)
            .where(PackingItem.list_id == list_id)
            .order_by(PackingItem.bag_id, PackingItem.position, PackingItem.id)
        )
    )


def _new_item(list_id: str, payload: PackingItemCreate, session: Session) -> PackingItem:
    if (
        payload.bag_id is not None
        and session.scalar(select(PackingBag.id).where(PackingBag.id == payload.bag_id, PackingBag.list_id == list_id))
        is None
    ):
        raise HTTPException(422, "Bag must belong to this packing list")
    values = payload.model_dump(exclude={"position"})
    result = PackingItem(list_id=list_id, position=0, **values)
    session.add(result)
    _place(_items(session, list_id, payload.bag_id), result, payload.position)
    session.flush()
    return result


@router.post("/{list_id}/items", response_model=PackingItemResponse, status_code=201)
def create_packing_item(
    trip_id: str, list_id: str, payload: PackingItemCreate, session: SessionDep, subject: SubjectDep
) -> PackingItem:
    owned_list(trip_id, list_id, session, subject)
    result = _new_item(list_id, payload, session)
    session.commit()
    return result


@router.post("/{list_id}/items/batch", response_model=list[PackingItemResponse], status_code=201)
def batch_create_packing_items(
    trip_id: str, list_id: str, payload: list[PackingItemCreate], session: SessionDep, subject: SubjectDep
) -> list[PackingItem]:
    owned_list(trip_id, list_id, session, subject)
    if not 1 <= len(payload) <= 100:
        raise HTTPException(422, "Batch must contain 1 to 100 items")
    result = [_new_item(list_id, item, session) for item in payload]
    session.commit()
    return result


@router.get("/{list_id}/items/{item_id}", response_model=PackingItemResponse)
def get_packing_item(trip_id: str, list_id: str, item_id: str, session: SessionDep, subject: SubjectDep) -> PackingItem:
    return owned_item(trip_id, list_id, item_id, session, subject)


@router.patch("/{list_id}/items/{item_id}", response_model=PackingItemResponse)
def update_packing_item(
    trip_id: str, list_id: str, item_id: str, payload: PackingItemUpdate, session: SessionDep, subject: SubjectDep
) -> PackingItem:
    result = owned_item(trip_id, list_id, item_id, session, subject)
    values = payload.model_dump(exclude_unset=True, exclude={"bag_id", "position"})
    for field in ("label", "quantity", "packed", "essential", "valuable", "cabin_only", "checked_only"):
        if field in values and values[field] is None:
            raise HTTPException(422, f"{field} is required")
    if values.get("cabin_only", result.cabin_only) and values.get("checked_only", result.checked_only):
        raise HTTPException(422, "An item cannot be both cabin-only and checked-only")
    target_bag = payload.bag_id if "bag_id" in payload.model_fields_set else result.bag_id
    if (
        target_bag is not None
        and session.scalar(select(PackingBag.id).where(PackingBag.id == target_bag, PackingBag.list_id == list_id))
        is None
    ):
        raise HTTPException(422, "Bag must belong to this packing list")
    if target_bag != result.bag_id:
        previous = _items(session, list_id, result.bag_id)
        result.bag_id = target_bag
        _renumber([row for row in previous if row.id != item_id])
        _place(_items(session, list_id, target_bag), result, payload.position)
    elif payload.position is not None:
        _place(_items(session, list_id, target_bag), result, payload.position)
    for field, value in values.items():
        setattr(result, field, value)
    session.commit()
    return result


@router.delete("/{list_id}/items/{item_id}", status_code=204)
def delete_packing_item(trip_id: str, list_id: str, item_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    result = owned_item(trip_id, list_id, item_id, session, subject)
    remaining = [row for row in _items(session, list_id, result.bag_id) if row.id != item_id]
    session.delete(result)
    _renumber(remaining)
    session.commit()
    return Response(status_code=204)
