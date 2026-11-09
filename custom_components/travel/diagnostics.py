"""Allowlist diagnostics; never serialize config entries or API records."""


async def async_get_config_entry_diagnostics(hass, entry):
    return {"integration_version": "0.1.0", "last_update_success": entry.runtime_data.last_update_success}
