"""Wire models only. Validation and domain policy remain on the server."""

from datetime import date, datetime
from typing import Literal, TypedDict

from pydantic import BaseModel, ConfigDict


class WireModel(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True, hide_input_in_errors=True)


class Identity(WireModel):
    subject: str
    contract_version: int
    capabilities: list[str]


class Trip(WireModel):
    id: str
    title: str


class TaskLink(WireModel):
    url: str
    label: str


class Task(WireModel):
    id: str
    title: str
    notes: str | None
    due_date: date | None
    remind_at: datetime | None
    reminded_at: datetime | None
    links: list[TaskLink]
    completed_at: datetime | None
    created_at: datetime


class TaskLinkInput(TypedDict):
    label: str
    url: str


class TaskFields(TypedDict, total=False):
    notes: str | None
    due_date: str | None
    remind_at: str | None
    links: list[TaskLinkInput]


class TaskUpdate(TaskFields, total=False):
    title: str
    completed: bool


class PackingList(WireModel):
    id: str
    trip_id: str
    name: str
    created_at: datetime


class PackingItem(WireModel):
    id: str
    list_id: str
    bag_id: str | None
    label: str
    quantity: int
    category: str | None
    packed: bool
    position: int
    essential: bool
    last_minute: bool
    valuable: bool
    cabin_only: bool
    checked_only: bool
    notes: str | None
    weight_g: int | None


class PackingItemFields(TypedDict, total=False):
    quantity: int
    category: str | None
    bag_id: str | None
    position: int | None
    packed: bool
    essential: bool
    last_minute: bool
    valuable: bool
    cabin_only: bool
    checked_only: bool
    notes: str | None
    weight_g: int | None


class PackingItemUpdate(PackingItemFields, total=False):
    label: str


Operation = Literal["GET", "POST", "PATCH", "DELETE"]
