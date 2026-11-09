import asyncio
from contextlib import asynccontextmanager

import aiohttp
import pytest
from aiohttp import web

from travel_client import AuthenticationError, ProtocolError, RateLimitError, TransportError, TravelClient, TravelError


async def token():
    return "synthetic-secret"


@asynccontextmanager
async def serve(handler):
    app = web.Application()
    app.router.add_route("*", "/{path:.*}", handler)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        await runner.cleanup()


def run(test):
    asyncio.run(test())


def test_owned_and_shared_sessions():
    async def check():
        async with aiohttp.ClientSession() as shared:
            async with TravelClient("https://example.test", token, session=shared):
                pass
            assert not shared.closed
        client = TravelClient("https://example.test", token)
        async with client:
            session = client._session
            assert session is not None and not session.closed
        assert session.closed
        await client.close()

    run(check)


@pytest.mark.parametrize(
    "status,expected", [(401, AuthenticationError), (429, RateLimitError), (503, TravelError), (302, TravelError)]
)
def test_safe_status_no_retries(status, expected, caplog):
    async def check():
        calls = []

        async def handler(request):
            calls.append(request.path)
            return web.json_response(
                {"detail": "private-content"},
                status=status,
                headers={"Retry-After": "30", "Location": "https://external.test"},
            )

        async with serve(handler) as origin, TravelClient(origin, token) as client:
            with pytest.raises(expected) as caught:
                await client.select_trip("trip")
            assert caught.value.status == status
            if status == 429:
                assert caught.value.retry_after == 30
            assert "private-content" not in repr(caught.value)
            assert "synthetic-secret" not in repr(caught.value)
            assert caught.value.__context__ is None
            assert len(calls) == 1

    run(check)
    assert not caplog.records


def test_timeout_cancel_and_ambiguous_write():
    async def check():
        entered = asyncio.Event()
        release = asyncio.Event()
        calls = []

        async def handler(request):
            calls.append(request.method)
            entered.set()
            await release.wait()
            return web.json_response({})

        async with serve(handler) as origin, TravelClient(origin, token, timeout=0.03) as client:
            from travel_client import SelectedTrip

            trip = SelectedTrip(client, "trip")
            with pytest.raises(TransportError) as caught:
                await trip.create_task("private-content")
            assert caught.value.code == "timeout" and caught.value.ambiguous
            assert caught.value.__context__ is None
            request = asyncio.create_task(trip.create_task("private-content"))
            await asyncio.sleep(0.005)
            request.cancel()
            with pytest.raises(asyncio.CancelledError):
                await request
            release.set()
        assert calls == ["POST", "POST"]

    run(check)


def test_bounded_and_malformed_response():
    async def check():
        for body, code in [
            (b"private-content", "invalid_response"),
            (b"x" * (2 * 1024 * 1024 + 1), "response_too_large"),
        ]:

            async def handler(request, body=body):
                return web.Response(body=body)

            async with serve(handler) as origin, TravelClient(origin, token) as client:
                with pytest.raises(ProtocolError) as caught:
                    await client.trips()
                assert caught.value.code == code
                assert caught.value.__context__ is None

    run(check)


def test_token_refresh_supplier_and_failure():
    async def check():
        supplied = []
        observed = []

        async def supplier():
            supplied.append(1)
            return f"token-{len(supplied)}"

        async def handler(request):
            observed.append(request.headers["Authorization"])
            return web.json_response([])

        async with serve(handler) as origin:
            async with TravelClient(origin, supplier) as client:
                await client.trips()
                await client.trips()

            async def broken():
                raise ValueError("synthetic-secret")

            async with TravelClient(origin, broken) as client:
                with pytest.raises(AuthenticationError) as caught:
                    await client.trips()
                assert caught.value.__context__ is None
                assert str(caught.value) == "token_unavailable"
        assert observed == ["Bearer token-1", "Bearer token-2"]

    run(check)


@pytest.mark.parametrize(
    "origin",
    [
        "https://example.test/path",
        "https://user:secret@example.test",
        "https://example.test?x=1",
        "http://external.test",
        "https://example.test#fragment",
    ],
)
def test_origin_rejection(origin):
    with pytest.raises(ValueError):
        TravelClient(origin, token)


@pytest.mark.parametrize("record_id", ["../external", "https://external.test", "//external.test", "x?secret", "x%2Fy"])
def test_path_rejection(record_id):
    async def check():
        async with TravelClient("https://example.test", token) as client:
            with pytest.raises(ValueError):
                await client.select_trip(record_id)

    run(check)


def test_disconnected_write_is_ambiguous_and_not_retried(caplog):
    async def check():
        calls = []

        async def handler(request):
            calls.append(await request.read())
            request.transport.abort()
            return web.Response()

        async with serve(handler) as origin, TravelClient(origin, token) as client:
            from travel_client import SelectedTrip

            with pytest.raises(TransportError) as caught:
                await SelectedTrip(client, "trip").create_task("private-content")
            assert caught.value.ambiguous
            assert caught.value.code == "connection_failed"
            assert caught.value.__context__ is None
        assert len(calls) == 1

    run(check)
    assert not caplog.records


def test_retry_after_date_and_invalid():
    from travel_client.client import _retry_after

    assert _retry_after("Thu, 01 Jan 1970 00:00:00 GMT") == 0
    assert _retry_after("invalid") is None
    assert _retry_after("nan") is None
    assert _retry_after(None) is None
