"""Client contracts through real HTTP against the synthetic FastAPI test app."""

import asyncio

import aiohttp
import pytest
from aiohttp import web
from test_trip_tasks import Base, client_for, create_trip, engine
from travel_client import TravelClient, TravelError

from app.auth import current_subject
from app.main import app


def test_client_owner_roundtrip(tmp_path):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    owner = client_for("client-owner", tmp_path)
    trip = create_trip(owner, "Synthetic client trip")
    second = create_trip(owner, "Synthetic other trip")
    subject = "client-owner"

    async def check():
        nonlocal subject

        async def bridge(request):
            # Auth subject is synthetic; normal JWT/audience tests remain test_auth.py.
            app.dependency_overrides[current_subject] = lambda: subject
            response = owner.request(
                request.method, request.path, content=await request.read(), headers={"content-type": "application/json"}
            )
            return web.Response(
                status=response.status_code, body=response.content, headers={"Content-Type": "application/json"}
            )

        http = web.Application()
        http.router.add_route("*", "/{path:.*}", bridge)
        runner = web.AppRunner(http)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]

        async def token():
            return "synthetic-api-token"

        try:
            async with aiohttp.ClientSession() as session:
                async with TravelClient(f"http://127.0.0.1:{port}", token, session=session) as client:
                    identity = await client.identity()
                    assert identity.subject == subject
                    assert identity.contract_version == 1
                    assert "packing:read-write" in identity.capabilities
                    assert len(await client.trips()) == 2
                    selected = await client.select_trip(trip["id"])
                    other = await client.select_trip(second["id"])
                    task = await selected.create_task("Synthetic task", due_date="2054-03-01", notes="Synthetic note")
                    assert task.due_date.isoformat() == "2054-03-01"
                    assert (await selected.tasks())[0].id == task.id
                    assert await other.tasks() == []
                    assert (await selected.complete_task(task.id)).completed_at is not None
                    assert (await selected.reopen_task(task.id)).completed_at is None
                    assert (await selected.update_task(task.id, {"notes": None})).notes is None
                    with pytest.raises(TravelError) as missing:
                        await other.complete_task(task.id)
                    assert missing.value.status == 404 and missing.value.code == "not_found"
                    packing = await selected.create_packing_list("Synthetic bag list")
                    assert (await selected.packing_lists())[0].id == packing.id
                    await selected.update_packing_list(packing.id, "Renamed list")
                    with pytest.raises(TravelError) as cross_trip:
                        await other.packing_items(packing.id)
                    assert cross_trip.value.status == 404
                    item = await selected.create_packing_item(packing.id, "Synthetic socks", quantity=2)
                    assert (await selected.packing_items(packing.id))[0].id == item.id
                    assert (await selected.complete_packing_item(packing.id, item.id)).packed
                    assert not (await selected.reopen_packing_item(packing.id, item.id)).packed
                    assert (await selected.update_packing_item(packing.id, item.id, {"quantity": 3})).quantity == 3
                    with pytest.raises(TravelError) as invalid:
                        await selected.create_packing_item(packing.id, "Invalid", quantity=0)
                    assert invalid.value.status == 422 and invalid.value.code == "greater_than_equal"
                    await selected.delete_packing_item(packing.id, item.id)
                    await selected.delete_packing_list(packing.id)
                    await selected.delete_task(task.id)
                    assert await selected.tasks() == []
                    assert await selected.packing_lists() == []
                    subject = "different-owner"
                    with pytest.raises(TravelError) as denied:
                        await client.select_trip(trip["id"])
                    assert denied.value.status == 404
                    with pytest.raises(TravelError):
                        await selected.create_task("Unauthorized synthetic task")
                    with pytest.raises(TravelError):
                        await selected.create_packing_list("Unauthorized synthetic list")
                    with pytest.raises(TravelError):
                        await selected.tasks()
                    with pytest.raises(TravelError):
                        await selected.packing_lists()
                assert not session.closed
        finally:
            await runner.cleanup()

    try:
        asyncio.run(check())
    finally:
        app.dependency_overrides.clear()


def test_identity_requires_ordinary_api_audience(monkeypatch):
    from datetime import UTC, datetime, timedelta

    import jwt
    from cryptography.hazmat.primitives.asymmetric import rsa
    from fastapi.testclient import TestClient
    from test_auth import StaticJwksClient

    from app.config import settings

    app.dependency_overrides.clear()
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr("app.auth.signing_keys", lambda _: StaticJwksClient(key.public_key()))
    monkeypatch.setattr(settings, "oidc_audience", "travel-api")
    monkeypatch.setattr(settings, "oidc_issuer_url", "https://auth.example.test/realms/travel")
    monkeypatch.setattr(settings, "oidc_jwks_url", "https://auth.example.test/keys")
    monkeypatch.setattr(settings, "dev_auth_bypass_token", None)
    client = TestClient(app)
    assert client.get("/api/identity").status_code == 401
    for audience, expired, status in [
        ("travel-api", False, 200),
        ("travel-api", True, 401),
        ("travel-mcp", False, 401),
        ("visitor", False, 401),
    ]:
        token = jwt.encode(
            {
                "sub": "synthetic-owner",
                "aud": audience,
                "iss": settings.oidc_issuer_url,
                "exp": datetime.now(UTC) + timedelta(minutes=-1 if expired else 5),
            },
            key,
            algorithm="RS256",
        )
        response = client.get("/api/identity", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == status
        if status == 200:
            assert response.json()["subject"] == "synthetic-owner"
