"""Allowlist diagnostics; never serialize config entries or API records."""


async def async_get_config_entry_diagnostics(hass, entry):
    return {"integration_version": "2026.11.2", "last_update_success": entry.runtime_data.last_update_success}
