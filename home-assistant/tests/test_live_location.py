"""Synthetic source lifecycle; no recorder/history dependency."""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from custom_components.travel.live_location import LocationForwarder
from homeassistant.util import dt as dt_util
from travel_client import AuthenticationError, TravelError


@pytest.mark.parametrize("entity", ["person.synthetic", "device_tracker.synthetic"])
async def test_selected_source_changes_stop_unload_and_no_backlog(hass, entity):
    entry = Mock(options={"location_trip": "trip", "location_session": "session"})
    selected = SimpleNamespace(id="session", source=entity, enabled=True)
    scope = SimpleNamespace(live_sessions=AsyncMock(return_value=[selected]), push_position=AsyncMock())
    client = SimpleNamespace(select_trip=AsyncMock(return_value=scope))
    forwarder = LocationForwarder(hass, entry, client)
    unsub = Mock()
    with (
        patch("custom_components.travel.live_location.async_track_state_change_event", return_value=unsub) as listen,
        patch("custom_components.travel.live_location.async_track_time_interval", return_value=Mock()),
    ):
        # Avoid spawning background tasks: exercise the same send callback explicitly.
        with patch.object(forwarder, "tick"):
            await forwarder.start()
        listen.assert_called_once()
        assert listen.call_args.args[1] == [entity]
        hass.states.async_set(
            entity, "home", {"latitude": 12.345678, "longitude": 45.678912, "source": "device_tracker.one"}
        )
        forwarder.dirty = True
        await forwarder.send()
        assert scope.push_position.call_count == 1
        # Stable person identity; a different underlying tracker stays selected.
        hass.states.async_set(
            entity, "home", {"latitude": 12.345679, "longitude": 45.678912, "source": "device_tracker.two"}
        )
        scope.push_position.side_effect = TravelError("unavailable")
        forwarder.dirty = True
        await forwarder.send()
        assert not forwarder.dirty
        scope.push_position.side_effect = None
        assert scope.push_position.call_count == 2  # no retry queue
        # Missing coordinates and unavailable states produce no update.
        hass.states.async_set(entity, "unavailable")
        forwarder.dirty = True
        await forwarder.send()
        assert scope.push_position.call_count == 2
        hass.states.async_set(entity, "home", {"latitude": 12, "longitude": 45})
        selected.enabled = False
        forwarder.dirty = True
        await forwarder.send()
        assert forwarder.stopped
        unsub.assert_called_once()
        await forwarder.shutdown()
        assert not forwarder.unsubscribers


async def test_off_by_default_auth_revocation_and_stale(hass):
    entry = Mock(options={})
    client = SimpleNamespace(select_trip=AsyncMock())
    forwarder = LocationForwarder(hass, entry, client)
    await forwarder.start()
    client.select_trip.assert_not_called()
    entry.options = {"location_trip": "trip", "location_session": "session"}
    source = SimpleNamespace(id="session", source="person.synthetic", enabled=True)
    scope = SimpleNamespace(live_sessions=AsyncMock(return_value=[source]), push_position=AsyncMock())
    client.select_trip.return_value = scope
    with patch.object(forwarder, "tick"):
        await forwarder.start()
    hass.states.async_set("person.synthetic", "home", {"latitude": 12, "longitude": 45})
    with patch(
        "custom_components.travel.live_location.dt_util.utcnow", return_value=dt_util.utcnow() + timedelta(minutes=6)
    ):
        forwarder.dirty = True
        await forwarder.send()
    scope.push_position.assert_not_called()
    scope.push_position.side_effect = AuthenticationError("revoked")
    forwarder.dirty = True
    await forwarder.send()
    assert forwarder.stopped
    entry.async_start_reauth.assert_called_once_with(hass)
    await forwarder.shutdown()


async def test_actual_task_cancellation_and_renamed_source_cleanup(hass, api):
    import asyncio

    entry = api[2]
    hass.config_entries.async_update_entry(entry, options={"location_trip": "trip", "location_session": "session"})
    selected = SimpleNamespace(id="session", source="device_tracker.synthetic", enabled=True)
    scope = SimpleNamespace(live_sessions=AsyncMock(return_value=[selected]), push_position=AsyncMock())
    client = SimpleNamespace(select_trip=AsyncMock(return_value=scope))
    hass.states.async_set(selected.source, "home", {"latitude": 12, "longitude": 45})
    forwarder = LocationForwarder(hass, entry, client)
    gate = asyncio.Event()

    async def pending(*args, **kwargs):
        await gate.wait()

    scope.push_position.side_effect = pending
    await forwarder.start()
    await hass.async_block_till_done()
    assert forwarder.task is not None and not forwarder.task.done()
    await forwarder.shutdown()
    assert forwarder.task.cancelled() and not forwarder.unsubscribers
    scope.push_position.side_effect = None
    renamed = LocationForwarder(hass, entry, client)
    await renamed.start()
    await hass.async_block_till_done()
    hass.states.async_remove(selected.source)
    await hass.async_block_till_done()
    assert renamed.stopped and not renamed.unsubscribers
    await renamed.shutdown()


async def test_location_options_are_independent_of_task_trips(hass, api):
    from custom_components.travel.config_flow import TravelOptions

    entry = api[2]
    selected = SimpleNamespace(id="session", source="person.synthetic", enabled=True)
    scope = SimpleNamespace(live_sessions=AsyncMock(return_value=[selected]))
    client = SimpleNamespace(
        trips=AsyncMock(return_value=[SimpleNamespace(id="trip-one", title="Synthetic")]),
        select_trip=AsyncMock(return_value=scope),
    )
    options = TravelOptions()
    options.hass = hass
    with (
        patch.object(TravelOptions, "config_entry", new=property(lambda self: entry)),
        patch("custom_components.travel.async_client_for_entry", new=AsyncMock(return_value=client)),
    ):
        result = await options.async_step_init({"trips": [], "location_trip": "trip-one"})
        assert result["step_id"] == "location"
        invalid = await options.async_step_location({"location_session": "unknown"})
        assert invalid["step_id"] == "location"
        result = await options.async_step_location({"location_session": "session"})
        assert result["data"] == {"trips": [], "location_trip": "trip-one", "location_session": "session"}
        disabled = await options.async_step_init({"trips": ["trip-one"], "location_trip": ""})
        assert disabled["data"] == {"trips": ["trip-one"], "location_trip": ""}
