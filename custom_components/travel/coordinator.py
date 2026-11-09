"""Read selected scopes atomically; never replay writes."""

import hashlib
import json
import logging
from datetime import timedelta

from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from travel_client import AuthenticationError, TravelError

from .const import DOMAIN


class TravelCoordinator(DataUpdateCoordinator):
    def __init__(self, hass, entry, client):
        selected = entry.options.get("trips", entry.data["trips"])
        super().__init__(
            hass,
            logging.getLogger(__name__),
            name=DOMAIN,
            config_entry=entry,
            update_interval=timedelta(minutes=5) if selected else None,
        )
        self.entry = entry
        self.client = client
        self.scopes = {}

    def unique_id(self, key):
        # Tuple serialization avoids delimiter collisions; tokens and titles are absent.
        return hashlib.sha256(
            json.dumps([self.entry.data["origin"], self.entry.data["owner"], *key]).encode()
        ).hexdigest()

    async def _async_update_data(self):
        try:
            identity = await self.client.identity()
            if identity.subject != self.entry.data["owner"]:
                raise ConfigEntryAuthFailed(translation_domain=DOMAIN, translation_key="owner_changed")
            if identity.contract_version != 1 or not {"trip-tasks:read-write", "packing:read-write"} <= set(
                identity.capabilities
            ):
                raise UpdateFailed(translation_domain=DOMAIN, translation_key="unsupported_contract")
            trips = {trip.id: trip.title for trip in await self.client.trips()}
            result = {}
            scopes = {}
            for trip_id in self.entry.options.get("trips", self.entry.data["trips"]):
                scope = await self.client.select_trip(trip_id)
                scopes[trip_id] = scope
                result[(trip_id, "tasks")] = (trips[trip_id], await scope.tasks())
                for packing in await scope.packing_lists():
                    result[(trip_id, packing.id)] = (
                        f"{trips[trip_id]}: {packing.name}",
                        await scope.packing_items(packing.id),
                    )
            self.scopes = scopes
            return result
        except AuthenticationError:
            raise ConfigEntryAuthFailed(translation_domain=DOMAIN, translation_key="authentication") from None
        except TravelError:
            raise UpdateFailed(translation_domain=DOMAIN, translation_key="cannot_connect") from None

    async def write(self, operation):
        try:
            await operation()
        except AuthenticationError:
            self.entry.async_start_reauth(self.hass)
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="authentication") from None
        except TravelError:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="write_failed") from None
        await self.async_refresh()
        if not self.last_update_success:
            raise HomeAssistantError(translation_domain=DOMAIN, translation_key="refresh_failed")
