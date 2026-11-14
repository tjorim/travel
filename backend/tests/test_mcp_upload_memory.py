"""Fresh-process RSS of a 150 MiB base64 MCP upload (#84): JSON parsing, decoding, staging and the durable write.

Only the stdio server can receive such a body; over HTTP the transport refuses a request above 4 MiB (see
``test_mcp_server.py``). The encoded JSON string is the one unavoidable allocation. Everything after it must stay
bounded by the chunk size.
"""

import json
import subprocess
import sys

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
