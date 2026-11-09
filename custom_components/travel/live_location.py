"""Optional selected-source forwarding. No queue, replay, or coordinate logging."""

import asyncio
import math
from datetime import timedelta

from homeassistant.core import callback
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_interval
from homeassistant.util import dt as dt_util
from travel_client import AuthenticationError, TravelError


class LocationForwarder:
    def __init__(self, hass, entry, client):
        self.hass, self.entry, self.client = hass, entry, client
        self.stopped = False
        self.unsubscribers = []
        self.task = None
        self.scope = None
        self.source = None
        self.dirty = False

    async def start(self):
        trip = self.entry.options.get("location_trip")
        self.session_id = self.entry.options.get("location_session")
        if not trip or not self.session_id:
            return
        try:
            self.scope = await self.client.select_trip(trip)
            sessions = await self.scope.live_sessions()
        except AuthenticationError:
            self.entry.async_start_reauth(self.hass)
            return
        except TravelError:
            return
        selected = next((s for s in sessions if s.id == self.session_id and s.enabled), None)
        if selected is None:
            return
        self.source = selected.source
        if not self.source.startswith(("person.", "device_tracker.")):
            return
        self.unsubscribers = [
            async_track_state_change_event(self.hass, [self.source], self.changed),
            async_track_time_interval(self.hass, self.tick, timedelta(seconds=45)),
        ]
        # Fresh current state only; never enumerate HA history or replay a queue.
        self.dirty = True
        self.tick(None)

    @callback
    def changed(self, event):
        if event.data.get("new_state") is None:
            self.stop()
            return
        self.dirty = True

    @callback
    def tick(self, _):
        if not self.stopped and (self.task is None or self.task.done()):
            self.task = self.entry.async_create_background_task(self.hass, self.send(), "Travel current location")

    async def send(self):
        dirty, self.dirty = self.dirty, False
        if self.stopped or self.scope is None or self.source is None:
            return
        try:
            # Poll control state even with no GPS event, so revocation cleans up listeners.
            sessions = await self.scope.live_sessions()
            selected = next((s for s in sessions if s.id == self.session_id), None)
            if selected is None or not selected.enabled or selected.source != self.source:
                self.stop()
                return
            if self.stopped or not dirty:
                return
            state = self.hass.states.get(self.source)
            if state is None or state.state in {"unknown", "unavailable"}:
                return
            timestamp = state.last_updated
            if not timedelta(seconds=-30) <= dt_util.utcnow() - timestamp <= timedelta(minutes=5):
                return
            lat, lon = state.attributes.get("latitude"), state.attributes.get("longitude")
            if type(lat) not in (float, int) or type(lon) not in (float, int):
                return
            if not math.isfinite(lat) or not math.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
                return
            await self.scope.push_position(self.session_id, observed_at=timestamp, latitude=lat, longitude=lon)
        except AuthenticationError:
            self.stop()
            self.entry.async_start_reauth(self.hass)
        except TravelError:
            # Failed data is discarded. A later source event supplies fresh data.
            pass

    @callback
    def stop(self):
        self.stopped = True
        for unsubscribe in self.unsubscribers:
            unsubscribe()
        self.unsubscribers.clear()
        if self.task is not None and self.task is not asyncio.current_task() and not self.task.done():
            self.task.cancel()

    async def shutdown(self):
        self.stop()
        if self.task is not None and not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
