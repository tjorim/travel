"""HA lifecycle and actual client-contract tests without production credentials."""

from datetime import date, datetime
from unittest.mock import AsyncMock, patch

import pytest
from custom_components.travel.config_flow import TravelFlow, TravelOptions
from custom_components.travel.coordinator import TravelCoordinator
from custom_components.travel.diagnostics import async_get_config_entry_diagnostics
from custom_components.travel.todo import TravelTodo
from homeassistant.components.todo import TodoItem, TodoItemStatus
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
from homeassistant.helpers import entity_registry
from homeassistant.helpers.update_coordinator import UpdateFailed


async def coordinator_for(hass, api):
    _state, _client, entry = api
    coordinator = TravelCoordinator(hass, entry, _client)
    await coordinator.async_refresh()
    entry.runtime_data = coordinator
    return coordinator


async def test_task_dates_partial_updates_and_refresh(hass, api):
    coordinator = await coordinator_for(hass, api)
    entity = TravelTodo(coordinator, ("trip-one", "tasks"))
    item = entity.todo_items[0]
    assert item.uid == "task-one"
    assert item.due == date(2027, 3, 28) and not isinstance(item.due, datetime)
    await entity.async_update_todo_item(TodoItem(uid=item.uid, status=TodoItemStatus.COMPLETED))
    assert api[0]["writes"][-1][2] == {"completed": True}
    assert entity.todo_items[0].status == TodoItemStatus.COMPLETED
    assert api[0]["task"]["remind_at"] == "2027-03-27T23:30:00+01:00"
    await entity.async_update_todo_item(TodoItem(uid=item.uid, status=TodoItemStatus.NEEDS_ACTION))
    await entity.async_update_todo_item(TodoItem(uid=item.uid, due=date(2027, 10, 31)))
    assert api[0]["writes"][-1][2] == {"due_date": "2027-10-31"}
    with pytest.raises(HomeAssistantError):
        await entity.async_update_todo_item(TodoItem(uid=item.uid, due=datetime(2027, 3, 28, 12)))
    await entity.async_create_todo_item(TodoItem(summary="New synthetic task"))
    await entity.async_delete_todo_items([item.uid])
    assert api[0]["writes"][-1][0] == "DELETE"


async def test_packing_preserves_fields_and_failures(hass, api):
    coordinator = await coordinator_for(hass, api)
    entity = TravelTodo(coordinator, ("trip-one", "list-one"))
    await entity.async_update_todo_item(TodoItem(uid="item-one", status=TodoItemStatus.COMPLETED))
    assert api[0]["writes"][-1][2] == {"packed": True}
    assert api[0]["item"]["quantity"] == 3 and api[0]["item"]["essential"]
    for status in (403, 429, 500):
        api[0]["status"] = status
        count = len(api[0]["requests"])
        with pytest.raises(HomeAssistantError) as error:
            await entity.async_update_todo_item(TodoItem(uid="item-one", summary="Changed"))
        assert "private text" not in str(error.value)
        assert len(api[0]["requests"]) == count + 1
        assert entity.todo_items[0].summary == "Synthetic socks"
    api[0]["status"] = 401
    with patch.object(type(api[2]), "async_start_reauth") as reauth:
        with pytest.raises(HomeAssistantError):
            await entity.async_update_todo_item(TodoItem(uid="item-one", summary="Changed"))
        reauth.assert_called_once()


async def test_identity_rotation_owner_and_diagnostics(hass, api):
    coordinator = await coordinator_for(hass, api)
    uid = coordinator.unique_id(("trip-one", "tasks"))
    api[0]["token"] = "rotated-token"
    await coordinator.async_refresh()
    assert api[0]["requests"][-1][2] == "Bearer rotated-token"
    assert uid == coordinator.unique_id(("trip-one", "tasks"))
    assert uid == TravelCoordinator(hass, api[2], api[1]).unique_id(("trip-one", "tasks"))
    assert await async_get_config_entry_diagnostics(hass, api[2]) == {
        "integration_version": "0.2.0",
        "last_update_success": True,
    }
    api[0]["owner"] = "another-owner"
    with pytest.raises(ConfigEntryAuthFailed):
        await coordinator._async_update_data()
    api[0]["status"] = 500
    with pytest.raises(UpdateFailed):
        await coordinator._async_update_data()


async def test_setup_dynamic_removal_options_and_unload(hass, api):
    state, _client, entry = api
    with (
        patch(
            "custom_components.travel.config_entry_oauth2_flow.async_get_config_entry_implementation", new=AsyncMock()
        ),
        patch("custom_components.travel.config_entry_oauth2_flow.OAuth2Session") as oauth,
    ):
        oauth.return_value.async_ensure_token_valid = AsyncMock()
        oauth.return_value.token = {"access_token": "synthetic-token"}
        assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    registry = entity_registry.async_get(hass)
    entries = entity_registry.async_entries_for_config_entry(registry, entry.entry_id)
    assert len(entries) == 2
    state["packing"] = False
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    assert len(entity_registry.async_entries_for_config_entry(registry, entry.entry_id)) == 1
    state["packing"] = True
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    assert len(entity_registry.async_entries_for_config_entry(registry, entry.entry_id)) == 2
    options = TravelOptions()
    options.hass = hass
    with (
        patch.object(TravelOptions, "config_entry", new=property(lambda self: entry)),
        patch("custom_components.travel.async_client_for_entry", new=AsyncMock(return_value=_client)),
    ):
        result = await options.async_step_init({"trips": []})
        assert result["data"] == {"trips": []}
    coordinator = entry.runtime_data
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert not coordinator.async_update_listeners()


async def test_config_selection_and_cross_owner_reauth(hass, api):
    state, _client, entry = api
    flow = TravelFlow()
    flow.hass = hass
    flow.context = {"source": "user"}
    flow.origin = entry.data["origin"]
    with (
        patch.object(flow, "async_set_unique_id", new=AsyncMock()),
        patch.object(flow, "_abort_if_unique_id_configured"),
    ):
        result = await flow.async_oauth_create_entry(entry.data)
    assert result["step_id"] == "trips"
    result = await flow.async_step_trips({"trips": ["trip-one"]})
    assert result["data"]["owner"] == "owner-one"
    flow.context = {"source": "reauth", "entry_id": entry.entry_id}
    state["owner"] = "different-owner"
    result = await flow.async_oauth_create_entry(entry.data)
    assert result["reason"] == "owner_changed"
    state["owner"] = "owner-one"
    with patch.object(flow, "async_update_reload_and_abort") as update:
        await flow.async_oauth_create_entry({**entry.data, "token": {"access_token": "rotated-token"}})
        update.assert_called_once()


async def test_application_credentials_pkce_and_validation(hass):
    from custom_components.travel.application_credentials import async_get_auth_implementation
    from homeassistant.components.application_credentials import ClientCredential

    implementation = await async_get_auth_implementation(
        hass,
        "realm",
        ClientCredential("synthetic-client", "synthetic-secret", "https://auth.example.test/realms/travel"),
    )
    assert implementation.extra_authorize_data["code_challenge_method"] == "S256"
    assert implementation.extra_token_resolve_data["code_verifier"]
    assert implementation.client_secret == "synthetic-secret"
    for issuer in (
        "http://auth.example.test/realms/travel",
        "https://u:p@auth.example.test/realms/travel",
        "https://auth.example.test/not-a-realm",
    ):
        with pytest.raises(ValueError):
            await async_get_auth_implementation(hass, "realm", ClientCredential("c", "s", issuer))


async def test_options_reload_deselect_restart_identity(hass, api):
    _state, _client, entry = api
    with (
        patch(
            "custom_components.travel.config_entry_oauth2_flow.async_get_config_entry_implementation", new=AsyncMock()
        ),
        patch("custom_components.travel.config_entry_oauth2_flow.OAuth2Session") as oauth,
    ):
        oauth.return_value.async_ensure_token_valid = AsyncMock()
        oauth.return_value.token = {"access_token": "synthetic-token"}
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        registry = entity_registry.async_get(hass)
        before = {x.unique_id for x in entity_registry.async_entries_for_config_entry(registry, entry.entry_id)}
        old = entry.runtime_data
        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        assert before == {x.unique_id for x in entity_registry.async_entries_for_config_entry(registry, entry.entry_id)}
        assert not old.async_update_listeners()
        hass.config_entries.async_update_entry(entry, options={"trips": []})
        await hass.async_block_till_done()
        assert not entity_registry.async_entries_for_config_entry(registry, entry.entry_id)
        assert not entry.runtime_data.scopes
        assert entry.runtime_data.update_interval is None
        assert await hass.config_entries.async_unload(entry.entry_id)


async def test_confirmed_write_refresh_failure_and_unknown_uid(hass, api):
    coordinator = await coordinator_for(hass, api)
    entity = TravelTodo(coordinator, ("trip-one", "tasks"))
    with pytest.raises(HomeAssistantError):
        await entity.async_update_todo_item(TodoItem(uid="foreign-task", summary="Changed"))
    assert not api[0]["writes"]

    async def confirmed():
        api[0]["status"] = 500

    with pytest.raises(HomeAssistantError) as error:
        await coordinator.write(confirmed)
    assert error.value.translation_key == "refresh_failed"
    assert not coordinator.last_update_success


async def test_packing_crud_reopen_and_date_rejection(hass, api):
    coordinator = await coordinator_for(hass, api)
    entity = TravelTodo(coordinator, ("trip-one", "list-one"))
    await entity.async_create_todo_item(TodoItem(summary="Synthetic scarf", description="Synthetic note"))
    assert api[0]["writes"][-1][2] == {"label": "Synthetic scarf", "notes": "Synthetic note"}
    await entity.async_update_todo_item(TodoItem(uid="item-one", status=TodoItemStatus.COMPLETED))
    await entity.async_update_todo_item(TodoItem(uid="item-one", status=TodoItemStatus.NEEDS_ACTION))
    assert api[0]["writes"][-1][2] == {"packed": False}
    assert api[0]["item"]["weight_g"] == 100
    with pytest.raises(HomeAssistantError):
        await entity.async_update_todo_item(TodoItem(uid="item-one", due=date(2027, 3, 28)))
    await entity.async_delete_todo_items(["item-one"])
    assert api[0]["writes"][-1][0] == "DELETE"


async def test_user_origin_and_reauth_steps(hass, api):
    flow = TravelFlow()
    flow.hass = hass
    flow.context = {"source": "user"}
    result = await flow.async_step_user({"origin": "https://user:secret@example.test/private"})
    assert result["errors"] == {"base": "invalid_origin"}
    with patch.object(flow, "async_step_pick_implementation", new=AsyncMock(return_value={"type": "form"})) as pick:
        await flow.async_step_user({"origin": api[2].data["origin"] + "/"})
        assert flow.origin == api[2].data["origin"]
        pick.assert_awaited_once()
    result = await flow.async_step_reauth(api[2].data)
    assert result["step_id"] == "reauth_confirm"
    with patch.object(flow, "async_step_pick_implementation", new=AsyncMock()) as pick:
        await flow.async_step_reauth_confirm({})
        pick.assert_awaited_once()
