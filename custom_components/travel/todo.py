"""Native lists; item content is exposed only through HA's to-do API."""

from datetime import datetime
from functools import partial

from homeassistant.components.todo import TodoItem, TodoItemStatus, TodoListEntity, TodoListEntityFeature
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import TravelCoordinator

PARALLEL_UPDATES = 1
BASE_FEATURES = (
    TodoListEntityFeature.CREATE_TODO_ITEM
    | TodoListEntityFeature.UPDATE_TODO_ITEM
    | TodoListEntityFeature.DELETE_TODO_ITEM
    | TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM
)


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = entry.runtime_data
    known = set()

    def reconcile():
        if not coordinator.last_update_success:
            return
        current = set(coordinator.data)
        registry = entity_registry.async_get(hass)
        for key in known - current:
            entity_id = registry.async_get_entity_id("todo", DOMAIN, coordinator.unique_id(key))
            if entity_id:
                registry.async_remove(entity_id)
        new = current - known
        known.clear()
        known.update(current)
        async_add_entities([TravelTodo(coordinator, key) for key in sorted(new)])

    entry.async_on_unload(coordinator.async_add_listener(reconcile))
    reconcile()


class TravelTodo(CoordinatorEntity[TravelCoordinator], TodoListEntity):
    _attr_has_entity_name = True

    def __init__(self, coordinator, key):
        super().__init__(coordinator)
        self.key = key
        self._attr_unique_id = coordinator.unique_id(key)
        self._attr_supported_features = BASE_FEATURES
        if key[1] == "tasks":
            self._attr_supported_features |= TodoListEntityFeature.SET_DUE_DATE_ON_ITEM

    @property
    def name(self):
        return self.coordinator.data.get(self.key, ("Travel", []))[0]

    @property
    def todo_items(self):
        items = self.coordinator.data.get(self.key, (None, []))[1]
        if self.key[1] == "tasks":
            return [
                TodoItem(
                    uid=x.id,
                    summary=x.title,
                    description=x.notes,
                    due=x.due_date,
                    status=TodoItemStatus.COMPLETED if x.completed_at else TodoItemStatus.NEEDS_ACTION,
                )
                for x in items
            ]
        return [
            TodoItem(
                uid=x.id,
                summary=x.label,
                description=x.notes,
                status=TodoItemStatus.COMPLETED if x.packed else TodoItemStatus.NEEDS_ACTION,
            )
            for x in items
        ]

    def fields(self, item):
        fields = {}
        if item.summary is not None:
            fields["title" if self.key[1] == "tasks" else "label"] = item.summary
        if item.description is not None:
            fields["notes"] = item.description
        if item.due is not None:
            if self.key[1] != "tasks" or isinstance(item.due, datetime):
                raise HomeAssistantError(translation_domain=DOMAIN, translation_key="unsupported_date")
            fields["due_date"] = item.due.isoformat()
        if item.status is not None:
            fields["completed" if self.key[1] == "tasks" else "packed"] = item.status == TodoItemStatus.COMPLETED
        return fields

    async def async_create_todo_item(self, item):
        fields = self.fields(item)
        scope = self.coordinator.scopes[self.key[0]]
        if self.key[1] == "tasks":
            if fields.pop("completed", False):
                raise HomeAssistantError(translation_domain=DOMAIN, translation_key="unsupported_create_status")
            operation = partial(scope.create_task, **fields)
        else:
            operation = partial(scope.create_packing_item, self.key[1], **fields)
        await self.coordinator.write(operation)

    async def async_update_todo_item(self, item):
        if item.uid not in {x.uid for x in self.todo_items}:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="missing_item")
        fields = self.fields(item)
        scope = self.coordinator.scopes[self.key[0]]
        await self.coordinator.write(
            lambda: (
                scope.update_task(item.uid, fields)
                if self.key[1] == "tasks"
                else scope.update_packing_item(self.key[1], item.uid, fields)
            )
        )

    async def async_delete_todo_items(self, uids):
        scope = self.coordinator.scopes[self.key[0]]
        for uid in uids:
            if uid not in {x.uid for x in self.todo_items}:
                raise HomeAssistantError(translation_domain=DOMAIN, translation_key="missing_item")
            await self.coordinator.write(
                lambda uid=uid: (
                    scope.delete_task(uid) if self.key[1] == "tasks" else scope.delete_packing_item(self.key[1], uid)
                )
            )
