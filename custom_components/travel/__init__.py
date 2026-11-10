"""Owner-only Travel to-do integration."""

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.helpers import config_entry_oauth2_flow, entity_registry
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from travel_client import TravelClient

from .coordinator import TravelCoordinator
from .oidc import implementation, validated_config

PLATFORMS = [Platform.TODO]
type TravelEntry = ConfigEntry[TravelCoordinator]


async def async_client_for_entry(hass, entry: TravelEntry):
    oauth = config_entry_oauth2_flow.OAuth2Session(hass, entry, implementation(hass, validated_config(entry.data)))

    async def token():
        await oauth.async_ensure_token_valid()
        return oauth.token["access_token"]

    return TravelClient(entry.data["origin"], token, session=async_get_clientsession(hass))


async def async_setup_entry(hass, entry: TravelEntry) -> bool:
    client = await async_client_for_entry(hass, entry)
    coordinator = TravelCoordinator(hass, entry, client)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await coordinator.location.start()
    registry = entity_registry.async_get(hass)
    valid = {coordinator.unique_id(key) for key in coordinator.data}
    for entity in entity_registry.async_entries_for_config_entry(registry, entry.entry_id):
        if entity.unique_id not in valid:
            registry.async_remove(entity.entity_id)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(async_reload))
    return True


async def async_reload(hass, entry):
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass, entry: TravelEntry) -> bool:
    if await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        await entry.runtime_data.location.shutdown()
        await entry.runtime_data.async_shutdown()
        return True
    return False
