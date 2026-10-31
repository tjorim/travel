"""Fresh-process RSS regression, including staging, durable write and read-back."""

import json
import subprocess
import sys

import pytest

SCRIPT = """
import json, tempfile, tracemalloc
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from app.media.service import read_bounded_upload
from app.storage import CHUNK_SIZE, LocalObjectStorage, sha256_hex, verify_object

count = int(__import__('sys').argv[1])
barrier = Barrier(count)
class Source:
    remaining = 150 * 1024 * 1024
    def read(self, size):
        size = min(size, self.remaining)
        self.remaining -= size
        return b'x' * size

with tempfile.TemporaryDirectory() as root:
    storage = LocalObjectStorage(root)
    Path("/proc/self/clear_refs").write_text("5")
    def rss():
        return int(next(line.split()[1] for line in Path("/proc/self/status").read_text().splitlines() if line.startswith("VmHWM:")))
    baseline = rss()
    tracemalloc.start()
    def upload(index):
        barrier.wait()
        with read_bounded_upload(Source()) as data:
            storage.put(str(index), data)
            assert verify_object(storage, str(index), sha256_hex(data))
    with ThreadPoolExecutor(count) as executor:
        list(executor.map(upload, range(count)))
    peak = rss()
    assert tracemalloc.get_traced_memory()[1] < 8 * count * CHUNK_SIZE
    print(json.dumps(dict(count=count, baseline_kib=baseline, peak_kib=peak)))
"""


@pytest.mark.parametrize("count", [1, 3])
def test_upload_rss_is_bounded_by_chunk_size(count):
    result = subprocess.run([sys.executable, "-c", SCRIPT, str(count)], check=True, capture_output=True, text=True)
    measurement = json.loads(result.stdout)
    print(measurement)
    # Two live chunks per writer plus interpreter/allocator allowance.
    assert measurement["peak_kib"] - measurement["baseline_kib"] < 8 * count * 1024
