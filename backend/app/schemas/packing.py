"""Packing list, bag, item and template schemas."""

from datetime import datetime

from pydantic import ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from app.models import INTEGER_MAX
from app.schemas.base import Identifier, InputModel, ResponseModel


class PackingListCreate(InputModel):
    name: str = Field(default="Packing list", min_length=1, max_length=160)
    copy_from_list_id: Identifier | None = None
    template_ids: list[Identifier] = Field(default_factory=list, max_length=10)


class PackingListUpdate(InputModel):
    name: str = Field(min_length=1, max_length=160)


class PackingListResponse(ResponseModel):
    id: str
    trip_id: str
    name: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class PackingTemplateCreate(InputModel):
    name: str = Field(min_length=1, max_length=160)


class PackingTemplateResponse(ResponseModel):
    id: str
    name: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class PackingBagCreate(InputModel):
    name: str = Field(min_length=1, max_length=160)
    type: str | None = Field(default=None, max_length=80)
    position: int | None = Field(default=None, ge=0, le=INTEGER_MAX)
    weight_limit_g: int | None = Field(default=None, gt=0, le=INTEGER_MAX)


class PackingBagUpdate(InputModel):
    non_nullable_fields = frozenset(["name"])

    name: str | None = Field(default=None, min_length=1, max_length=160)
    type: str | None = Field(default=None, max_length=80)
    position: int | None = Field(default=None, ge=0, le=INTEGER_MAX)
    weight_limit_g: int | None = Field(default=None, gt=0, le=INTEGER_MAX)


class PackingBagResponse(ResponseModel):
    id: str
    list_id: str
    name: str
    type: str | None
    position: int
    weight_limit_g: int | None
    model_config = ConfigDict(from_attributes=True)


class PackingItemCreate(InputModel):
    label: str = Field(min_length=1, max_length=160)
    quantity: int = Field(default=1, ge=1, le=99)
    category: str | None = Field(default=None, max_length=80)
    bag_id: Identifier | None = None
    position: int | None = Field(default=None, ge=0, le=INTEGER_MAX)
    packed: bool = False
    essential: bool = False
    last_minute: bool = False
    valuable: bool = False
    cabin_only: bool = False
    checked_only: bool = False
    notes: str | None = Field(default=None, max_length=4000)
    weight_g: int | None = Field(default=None, ge=0, le=INTEGER_MAX)

    @model_validator(mode="after")
    def one_baggage_constraint(self):
        if self.cabin_only and self.checked_only:
            raise PydanticCustomError(
                "an_item_cannot_be_both_cabin_only_and_checked_only",
                "An item cannot be both cabin-only and checked-only",
            )
        return self


class PackingItemUpdate(InputModel):
    non_nullable_fields = frozenset(
        ["label", "quantity", "packed", "essential", "last_minute", "valuable", "cabin_only", "checked_only"]
    )

    label: str | None = Field(default=None, min_length=1, max_length=160)
    quantity: int | None = Field(default=None, ge=1, le=99)
    category: str | None = Field(default=None, max_length=80)
    bag_id: Identifier | None = None
    position: int | None = Field(default=None, ge=0, le=INTEGER_MAX)
    packed: bool | None = None
    essential: bool | None = None
    last_minute: bool | None = None
    valuable: bool | None = None
    cabin_only: bool | None = None
    checked_only: bool | None = None
    notes: str | None = Field(default=None, max_length=4000)
    weight_g: int | None = Field(default=None, ge=0, le=INTEGER_MAX)


class PackingItemResponse(ResponseModel):
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
    model_config = ConfigDict(from_attributes=True)


class PackingSuggestionResponse(ResponseModel):
    label: str
    category: str | None
    prior_trips: int = Field(description="How many earlier trips had this item.")
    usually_cabin: bool
    usually_essential: bool


class PackingListSourceResponse(ResponseModel):
    id: str
    name: str
    trip_id: str
    trip_title: str
