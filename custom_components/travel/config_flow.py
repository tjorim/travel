"""Application credentials OAuth and explicit scope selection."""

import hashlib
import logging

import probatio as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import config_entry_oauth2_flow, selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from travel_client import AuthenticationError, TravelClient, TravelError

from .const import DOMAIN


def trip_schema(trips, selected=(), *, location=False, location_trip=""):
    extra = {}
    if location:
        extra[vol.Optional("location_trip", default=location_trip)] = selector.SelectSelector(
            selector.SelectSelectorConfig(
                options=[selector.SelectOptionDict(value="", label="—")]
                + [selector.SelectOptionDict(value=t.id, label=t.title) for t in trips]
            )
        )
    return vol.Schema(
        {
            **extra,
            vol.Required("trips", default=list(selected)): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    multiple=True, options=[selector.SelectOptionDict(value=t.id, label=t.title) for t in trips]
                )
            ),
        }
    )


class TravelFlow(config_entry_oauth2_flow.AbstractOAuth2FlowHandler, domain=DOMAIN):
    DOMAIN = DOMAIN

    @property
    def logger(self):
        return logging.getLogger(__name__)

    @property
    def extra_authorize_data(self):
        return {"scope": "openid offline_access"}

    async def async_step_user(self, user_input=None):
        errors = {}
        if user_input:
            try:

                async def unused_token():
                    return ""

                TravelClient(user_input["origin"], unused_token, session=async_get_clientsession(self.hass))
                self.origin = user_input["origin"].rstrip("/")
                return await self.async_step_pick_implementation()
            except ValueError:
                errors["base"] = "invalid_origin"
        return self.async_show_form(
            step_id="user", data_schema=vol.Schema({vol.Required("origin"): str}), errors=errors
        )

    async def async_step_reauth(self, entry_data):
        self.origin = entry_data["origin"]
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input=None):
        if user_input is not None:
            return await self.async_step_pick_implementation()
        return self.async_show_form(step_id="reauth_confirm")

    async def async_oauth_create_entry(self, data):
        async def token():
            return data["token"]["access_token"]

        client = TravelClient(self.origin, token, session=async_get_clientsession(self.hass))
        try:
            identity = await client.identity()
            trips = await client.trips()
        except AuthenticationError:
            return self.async_abort(reason="invalid_auth")
        except TravelError:
            return self.async_abort(reason="cannot_connect")
        if self.source == config_entries.SOURCE_REAUTH:
            entry = self._get_reauth_entry()
            if identity.subject != entry.data["owner"]:
                return self.async_abort(reason="owner_changed")
            return self.async_update_reload_and_abort(entry, data_updates=data)
        await self.async_set_unique_id(hashlib.sha256(f"{self.origin}\0{identity.subject}".encode()).hexdigest())
        self._abort_if_unique_id_configured()
        self.pending = {**data, "origin": self.origin, "owner": identity.subject}
        self.trips = trips
        return await self.async_step_trips()

    async def async_step_trips(self, user_input=None):
        if user_input is not None:
            valid = {t.id for t in self.trips}
            if set(user_input["trips"]) <= valid:
                return self.async_create_entry(title="Travel", data={**self.pending, **user_input})
        return self.async_show_form(step_id="trips", data_schema=trip_schema(self.trips))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return TravelOptions()


class TravelOptions(config_entries.OptionsFlow):
    async def async_step_init(self, user_input=None):
        from . import async_client_for_entry

        client = await async_client_for_entry(self.hass, self.config_entry)
        try:
            trips = await client.trips()
        except AuthenticationError:
            self.config_entry.async_start_reauth(self.hass)
            return self.async_abort(reason="invalid_auth")
        except TravelError:
            return self.async_abort(reason="cannot_connect")
        if (
            user_input is not None
            and set(user_input["trips"]) <= {t.id for t in trips}
            and user_input.get("location_trip", "") in {t.id for t in trips} | {""}
        ):
            self.pending = user_input
            if user_input.get("location_trip"):
                self.client = client
                return await self.async_step_location()
            return self.async_create_entry(title="", data=user_input)
        return self.async_show_form(
            step_id="init",
            data_schema=trip_schema(
                trips,
                self.config_entry.options.get("trips", self.config_entry.data["trips"]),
                location=True,
                location_trip=self.config_entry.options.get("location_trip", ""),
            ),
        )

    async def async_step_location(self, user_input=None):
        try:
            scope = await self.client.select_trip(self.pending["location_trip"])
            sessions = [s for s in await scope.live_sessions() if s.enabled]
        except AuthenticationError:
            self.config_entry.async_start_reauth(self.hass)
            return self.async_abort(reason="invalid_auth")
        except TravelError:
            return self.async_abort(reason="cannot_connect")
        if user_input is not None and user_input.get("location_session") in {s.id for s in sessions} | {""}:
            return self.async_create_entry(title="", data={**self.pending, **user_input})
        return self.async_show_form(
            step_id="location",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        "location_session",
                        default=self.config_entry.options.get("location_session", "")
                        if self.config_entry.options.get("location_session") in {s.id for s in sessions}
                        else "",
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=[selector.SelectOptionDict(value="", label="—")]
                            + [selector.SelectOptionDict(value=s.id, label=s.source) for s in sessions]
                        )
                    )
                }
            ),
        )
