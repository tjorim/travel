"""Synthetic owner API served to the actual python-travel client."""

import pytest
from aiohttp import web
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from pytest_homeassistant_custom_component.common import MockConfigEntry
from travel_client import TravelClient

pytest_plugins = ["pytest_homeassistant_custom_component"]

OIDC = {
    "authorization_url": "https://auth.example.test/realms/travel/protocol/openid-connect/auth",
    "token_url": "https://auth.example.test/realms/travel/protocol/openid-connect/token",
    "client_id": "travel-home-assistant",
}


@pytest.fixture(autouse=True)
def custom(enable_custom_integrations):
    yield


@pytest.fixture
async def api(hass, aiohttp_server, socket_enabled):
    state = {"owner": "owner-one", "status": 200, "packing": True, "writes": [], "requests": []}
    state["oidc"] = OIDC
    state["oidc_status"] = 200
    task = {
        "id": "task-one",
        "title": "Synthetic task",
        "notes": "Private synthetic note",
        "due_date": "2027-03-28",
        "remind_at": "2027-03-27T23:30:00+01:00",
        "reminded_at": None,
        "links": [],
        "completed_at": None,
        "created_at": "2026-11-09T00:00:00Z",
    }
    packing = {
        "id": "item-one",
        "list_id": "list-one",
        "bag_id": None,
        "label": "Synthetic socks",
        "quantity": 3,
        "category": None,
        "packed": False,
        "position": 1,
        "essential": True,
        "last_minute": False,
        "valuable": False,
        "cabin_only": False,
        "checked_only": False,
        "notes": None,
        "weight_g": 100,
    }
    state.update(task=task, item=packing)

    async def handler(request):
        path = request.path
        if path == "/api/auth/oidc-config":
            return web.json_response(state["oidc"], status=state["oidc_status"])
        state["requests"].append((request.method, path, request.headers.get("Authorization")))
        if state["status"] != 200:
            return web.json_response({"detail": "never expose this private text"}, status=state["status"])
        if request.method != "GET":
            body = await request.json() if request.can_read_body else None
            state["writes"].append((request.method, path, body))
            if request.method == "DELETE":
                return web.Response(status=204)
            record = packing if "packing-lists" in path else task
            if body:
                record.update({k: v for k, v in body.items() if k != "completed"})
                if "completed" in body:
                    record["completed_at"] = "2026-11-09T01:00:00Z" if body["completed"] else None
            return web.json_response(record)
        if path == "/api/identity":
            return web.json_response(
                {
                    "subject": state["owner"],
                    "contract_version": 1,
                    "capabilities": ["trip-tasks:read-write", "packing:read-write"],
                }
            )
        if path == "/api/trips":
            return web.json_response([{"id": "trip-one", "title": "Synthetic trip"}])
        if path.endswith("/trip-one"):
            return web.json_response({"id": "trip-one", "title": "Synthetic trip"})
        if path.endswith("/trip-tasks"):
            return web.json_response([task])
        if path.endswith("/packing-lists"):
            return web.json_response(
                [
                    {
                        "id": "list-one",
                        "trip_id": "trip-one",
                        "name": "Synthetic packing",
                        "created_at": "2026-11-09T00:00:00Z",
                    }
                ]
                if state["packing"]
                else []
            )
        if path.endswith("/items"):
            return web.json_response([packing])
        raise AssertionError(path)

    app = web.Application()
    app.router.add_route("*", "/{path:.*}", handler)
    server = await aiohttp_server(app)
    origin = str(server.make_url("/")).rstrip("/")
    state["token"] = "synthetic-token"

    async def token():
        return state["token"]

    client = TravelClient(origin, token, session=async_get_clientsession(hass))
    entry = MockConfigEntry(
        domain="travel",
        data={
            "origin": origin,
            "owner": "owner-one",
            "trips": ["trip-one"],
            **OIDC,
            "auth_implementation": "travel",
            "token": {"access_token": "synthetic-token", "expires_at": 9999999999},
        },
    )
    entry.add_to_hass(hass)
    return state, client, entry
