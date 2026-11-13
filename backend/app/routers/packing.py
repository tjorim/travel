"""Owner-only packing data; never used by visitor projections."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..models import PackingBag, PackingItem, PackingList, PackingTemplate
from ..schemas import (
    Identifier,
    PackingBagCreate,
    PackingBagResponse,
    PackingBagUpdate,
    PackingItemCreate,
    PackingItemResponse,
    PackingItemUpdate,
    PackingListCreate,
    PackingListResponse,
    PackingListSourceResponse,
    PackingListUpdate,
    PackingSuggestionResponse,
    PackingTemplateCreate,
    PackingTemplateResponse,
)
from ..services import packing as service

router = APIRouter(prefix="/trips/{trip_id}/packing-lists", tags=["packing"])
templates_router = APIRouter(prefix="/packing-templates", tags=["packing"])
sources_router = APIRouter(prefix="/packing-list-sources", tags=["packing"])
SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


@router.get("", response_model=list[PackingListResponse])
def list_packing_lists(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> list[PackingList]:
    return service.list_packing_lists(session, subject, trip_id)


@router.post("", response_model=PackingListResponse, status_code=201)
def create_packing_list(
    trip_id: Identifier, payload: PackingListCreate, session: SessionDep, subject: SubjectDep
) -> PackingList:
    result = service.create_packing_list(session, subject, trip_id, payload)
    session.commit()
    session.refresh(result)
    return result


@router.post("/{list_id}/templates", response_model=PackingTemplateResponse, status_code=201)
def save_packing_template(
    trip_id: Identifier, list_id: Identifier, payload: PackingTemplateCreate, session: SessionDep, subject: SubjectDep
) -> PackingTemplate:
    template = service.save_packing_template(session, subject, trip_id, list_id, payload)
    session.commit()
    session.refresh(template)
    return template


@templates_router.get("", response_model=list[PackingTemplateResponse])
def list_packing_templates(session: SessionDep, subject: SubjectDep) -> list[PackingTemplate]:
    return service.list_packing_templates(session, subject)


@sources_router.get("", response_model=list[PackingListSourceResponse])
def list_packing_sources(session: SessionDep, subject: SubjectDep) -> list[dict[str, str]]:
    return service.list_packing_sources(session, subject)


@router.get("/{list_id}/suggestions", response_model=list[PackingSuggestionResponse])
def packing_suggestions(
    trip_id: Identifier, list_id: Identifier, session: SessionDep, subject: SubjectDep
) -> list[dict]:
    return service.packing_suggestions(session, subject, trip_id, list_id)


@templates_router.delete("/{template_id}", status_code=204)
def delete_packing_template(template_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    service.delete_packing_template(session, subject, template_id)
    session.commit()
    return Response(status_code=204)


@router.get("/{list_id}", response_model=PackingListResponse)
def get_packing_list(trip_id: Identifier, list_id: Identifier, session: SessionDep, subject: SubjectDep) -> PackingList:
    return service.get_packing_list(session, subject, trip_id, list_id)


@router.patch("/{list_id}", response_model=PackingListResponse)
def update_packing_list(
    trip_id: Identifier, list_id: Identifier, payload: PackingListUpdate, session: SessionDep, subject: SubjectDep
) -> PackingList:
    result = service.update_packing_list(session, subject, trip_id, list_id, payload)
    session.commit()
    return result


@router.delete("/{list_id}", status_code=204)
def delete_packing_list(trip_id: Identifier, list_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    service.delete_packing_list(session, subject, trip_id, list_id)
    session.commit()
    return Response(status_code=204)


@router.get("/{list_id}/bags", response_model=list[PackingBagResponse])
def list_packing_bags(
    trip_id: Identifier, list_id: Identifier, session: SessionDep, subject: SubjectDep
) -> list[PackingBag]:
    return service.list_packing_bags(session, subject, trip_id, list_id)


@router.post("/{list_id}/bags", response_model=PackingBagResponse, status_code=201)
def create_packing_bag(
    trip_id: Identifier, list_id: Identifier, payload: PackingBagCreate, session: SessionDep, subject: SubjectDep
) -> PackingBag:
    result = service.create_packing_bag(session, subject, trip_id, list_id, payload)
    session.commit()
    session.refresh(result)
    return result


@router.get("/{list_id}/bags/{bag_id}", response_model=PackingBagResponse)
def get_packing_bag(
    trip_id: Identifier, list_id: Identifier, bag_id: Identifier, session: SessionDep, subject: SubjectDep
) -> PackingBag:
    return service.get_packing_bag(session, subject, trip_id, list_id, bag_id)


@router.patch("/{list_id}/bags/{bag_id}", response_model=PackingBagResponse)
def update_packing_bag(
    trip_id: Identifier,
    list_id: Identifier,
    bag_id: Identifier,
    payload: PackingBagUpdate,
    session: SessionDep,
    subject: SubjectDep,
) -> PackingBag:
    result = service.update_packing_bag(session, subject, trip_id, list_id, bag_id, payload)
    session.commit()
    return result


@router.delete("/{list_id}/bags/{bag_id}", status_code=204)
def delete_packing_bag(
    trip_id: Identifier, list_id: Identifier, bag_id: Identifier, session: SessionDep, subject: SubjectDep
) -> Response:
    service.delete_packing_bag(session, subject, trip_id, list_id, bag_id)
    session.commit()
    return Response(status_code=204)


@router.get("/{list_id}/items", response_model=list[PackingItemResponse])
def list_packing_items(
    trip_id: Identifier, list_id: Identifier, session: SessionDep, subject: SubjectDep
) -> list[PackingItem]:
    return service.list_packing_items(session, subject, trip_id, list_id)


@router.post("/{list_id}/items", response_model=PackingItemResponse, status_code=201)
def create_packing_item(
    trip_id: Identifier, list_id: Identifier, payload: PackingItemCreate, session: SessionDep, subject: SubjectDep
) -> PackingItem:
    result = service.create_packing_item(session, subject, trip_id, list_id, payload)
    session.commit()
    return result


@router.post("/{list_id}/items/batch", response_model=list[PackingItemResponse], status_code=201)
def batch_create_packing_items(
    trip_id: Identifier, list_id: Identifier, payload: list[PackingItemCreate], session: SessionDep, subject: SubjectDep
) -> list[PackingItem]:
    result = service.batch_create_packing_items(session, subject, trip_id, list_id, payload)
    session.commit()
    return result


@router.get("/{list_id}/items/{item_id}", response_model=PackingItemResponse)
def get_packing_item(
    trip_id: Identifier, list_id: Identifier, item_id: Identifier, session: SessionDep, subject: SubjectDep
) -> PackingItem:
    return service.get_packing_item(session, subject, trip_id, list_id, item_id)


@router.patch("/{list_id}/items/{item_id}", response_model=PackingItemResponse)
def update_packing_item(
    trip_id: Identifier,
    list_id: Identifier,
    item_id: Identifier,
    payload: PackingItemUpdate,
    session: SessionDep,
    subject: SubjectDep,
) -> PackingItem:
    result = service.update_packing_item(session, subject, trip_id, list_id, item_id, payload)
    session.commit()
    return result


@router.delete("/{list_id}/items/{item_id}", status_code=204)
def delete_packing_item(
    trip_id: Identifier, list_id: Identifier, item_id: Identifier, session: SessionDep, subject: SubjectDep
) -> Response:
    service.delete_packing_item(session, subject, trip_id, list_id, item_id)
    session.commit()
    return Response(status_code=204)
