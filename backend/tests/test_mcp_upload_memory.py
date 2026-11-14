"""Fresh-process RSS of a 150 MiB base64 MCP upload (#84): JSON parsing, decoding, staging and the durable write.

Only the stdio server can receive such a body; over HTTP the transport refuses a request above
``MCP_MAX_REQUEST_BODY_BYTES`` (see ``test_mcp_server.py``), which is measured below through a real uvicorn server. The
encoded JSON string is the one unavoidable allocation. Everything after it must stay bounded by the chunk size.
"""

import base64
import json
import socket
import subprocess
import sys
import textwrap
from pathlib import Path

import httpx

from app.mcp_server.server import MCP_MAX_REQUEST_BODY_BYTES

SCRIPT = """
import base64, json, tempfile
from pathlib import Path
from app.mcp_server.core import BinaryUpload
from app.media.service import read_bounded_upload
from app.storage import LocalObjectStorage, sha256_hex, verify_object

RAW = 150 * 1024 * 1024
MIB = 1024 * 1024

def status(field):
    return int(next(line.split()[1] for line in Path("/proc/self/status").read_text().splitlines() if line.startswith(field)))

def reset_peak():
    Path("/proc/self/clear_refs").write_text("5")

# What the transport hands the tool: the JSON text of the call, with the encoded file inside it.
block = base64.b64encode(b"x" * (3 * MIB))
encoded = b"".join(block for _ in range(RAW // (3 * MIB)))
body = b'{"filename":"big.bin","content_type":"application/octet-stream","data_base64":"' + encoded + b'"}'
encoded_kib = len(encoded) // 1024
del encoded, block

with tempfile.TemporaryDirectory() as root:
    storage = LocalObjectStorage(root)
    reset_peak()
    before_parse = status("VmHWM:")
    arguments = json.loads(body)
    del body
    upload = BinaryUpload.model_validate(arguments)
    after_parse = status("VmHWM:")
    held_kib = status("VmRSS:")

    reset_peak()
    before_decode = status("VmHWM:")
    def store(received):
        with read_bounded_upload(received.file) as data:
            storage.put("object", data)
            assert verify_object(storage, "object", sha256_hex(data))
            return len(data)
    size = upload.apply(store)
    after_decode = status("VmHWM:")
    assert size == RAW
    print(json.dumps(dict(
        encoded_kib=encoded_kib,
        parse_growth_kib=after_parse - before_parse,
        decode_growth_kib=after_decode - before_decode,
        held_kib=held_kib,
    )))
"""


def test_a_150_mib_stdio_upload_costs_the_encoded_json_and_a_few_chunks():
    result = subprocess.run([sys.executable, "-c", SCRIPT], check=True, capture_output=True, text=True)
    measurement = json.loads(result.stdout)
    print(measurement)
    encoded = measurement["encoded_kib"]
    # The JSON bytes the transport already holds, then json.loads: a decoded text and the parsed string, so parsing
    # alone adds about twice the encoded size on top of the body. This is the allocation #84 cannot remove.
    assert measurement["parse_growth_kib"] < encoded * 2.2 + 16 * 1024
    # Decoding, staging, the durable copy and the read-back add only a few chunks, never a decoded copy (150 MiB).
    assert measurement["decode_growth_kib"] < 16 * 1024


SERVER = textwrap.dedent(
    """
    import json, os, sys, tempfile, threading, time
    os.environ["TRAVEL_ENVIRONMENT"] = "development"
    import uvicorn
    from fastapi import FastAPI
    from fastmcp.server.auth.providers.jwt import RSAKeyPair
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.config import settings
    from app.database import Base
    from app.mcp_server import create_mcp_http_app, mount_mcp
    from app.mcp_server import core
    from app.storage import LocalObjectStorage

    issuer, url = "https://identity.example.test/realms/travel", "https://travel.example.test/mcp"
    settings.environment, settings.oidc_audience, settings.oidc_issuer_url = "production", "travel-api", issuer
    settings.mcp_base_url, settings.mcp_audience = url, None
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    root = tempfile.mkdtemp()
    core.get_storage = lambda: LocalObjectStorage(root=root)
    server, http_app = create_mcp_http_app(sessionmaker(bind=engine, autocommit=False, autoflush=False))
    pair = RSAKeyPair.generate()
    server.auth.token_verifier.public_key = pair.public_key
    app = FastAPI(lifespan=http_app.lifespan)
    mount_mcp(app, server, http_app)
    token = pair.create_token(subject="owner-9", issuer=issuer, audience=url, scopes=["openid"])
    uvicorn_server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=int(sys.argv[1]), log_level="warning"))
    threading.Thread(target=uvicorn_server.run, daemon=True).start()
    while not uvicorn_server.started:
        time.sleep(0.05)
    print(json.dumps({"pid": os.getpid(), "token": token}), flush=True)
    sys.stdin.read()  # the server lives until the test closes its stdin
    """
)


def _message(data: str) -> dict:
    return json.loads(next((line[6:] for line in data.splitlines() if line.startswith("data: ")), data))


def test_a_document_upload_at_the_http_request_limit_costs_about_three_times_its_body():
    """Measured through uvicorn and the production mount: the server process is separate from the client's body."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = subprocess.Popen(
        [sys.executable, "-c", SERVER, str(port)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True
    )
    try:
        info = json.loads(server.stdout.readline())
        proc = Path(f"/proc/{info['pid']}")

        def hwm_kib() -> int:
            lines = (proc / "status").read_text().splitlines()
            return int(next(line.split()[1] for line in lines if line.startswith("VmHWM:")))

        headers = {
            "Authorization": f"Bearer {info['token']}",
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
        }
        url = f"http://127.0.0.1:{port}/mcp/"
        created = {"jsonrpc": "2.0", "id": 1, "method": "tools/call"} | {
            "params": {"name": "create_trip", "arguments": {"payload": {"title": "Big"}}}
        }
        trip_id = _message(httpx.post(url, json=created, headers=headers, timeout=120).text)["result"][
            "structuredContent"
        ]["id"]

        # The largest body the endpoint accepts: the call's JSON filled with base64 up to exactly the limit.
        prefix = (
            b'{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"upload_document","arguments":{"trip_id":"'
            + trip_id.encode()
            + b'","title":"Big","document_kind":"other","file":{"filename":"big.bin",'
            b'"content_type":"application/octet-stream","data_base64":"'
        )
        suffix = b'"}}}}'
        encoded_size = MCP_MAX_REQUEST_BODY_BYTES - len(prefix) - len(suffix)
        encoded_size -= encoded_size % 4
        block = base64.b64encode(b"x" * 3072)
        body = prefix + (block * (encoded_size // len(block) + 1))[:encoded_size] + suffix
        assert MCP_MAX_REQUEST_BODY_BYTES - 4 <= len(body) <= MCP_MAX_REQUEST_BODY_BYTES

        (proc / "clear_refs").write_text("5")  # restart the peak from the idle server
        before = hwm_kib()
        response = httpx.post(url, content=body, headers=headers, timeout=120)
        growth = hwm_kib() - before
        stored = _message(response.text)["result"]

        assert response.status_code == 200 and not stored.get("isError"), response.text[:300]
        assert json.loads(stored["content"][0]["text"])["byte_size"] == encoded_size // 4 * 3
        print({"body_kib": len(body) // 1024, "growth_kib": growth})
        # One request in flight: the SDK's buffered body and its copy, the parsed JSON text and string, and a few
        # decode chunks come to about 3.1 times the body (148 MiB for 48 MiB). Several in flight add up, because
        # nothing gates the endpoint before the body is read; docs/object-storage.md states the worst case.
        assert growth < len(body) // 1024 * 3.6 + 16 * 1024
    finally:
        server.stdin.close()
        server.wait(timeout=30)
