"""Bounded single-range delivery for owner and visitor video playback.

Files are streamed from storage in chunks, so a player's many range requests
never load the whole video into memory.
"""

import os
import re
from collections.abc import Iterator
from typing import BinaryIO

from fastapi import HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from ..models import StoredObject
from ..storage import ObjectStorage

CHUNK_BYTES = 64 * 1024


def _chunks(handle: BinaryIO, start: int, length: int) -> Iterator[bytes]:
    with handle:
        handle.seek(start)
        while length > 0:
            chunk = handle.read(min(CHUNK_BYTES, length))
            if not chunk:
                return
            length -= len(chunk)
            yield chunk


def media_response(storage: ObjectStorage, stored: StoredObject, request: Request, headers: dict[str, str]) -> Response:
    content_type = stored.content_type
    common = {**headers, "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff"}
    handle = storage.open(stored.object_key)
    size = handle.seek(0, os.SEEK_END)
    requested = request.headers.get("range") if content_type == "video/mp4" else None
    if not requested:
        return StreamingResponse(
            _chunks(handle, 0, size), media_type=content_type, headers={**common, "Content-Length": str(size)}
        )
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested)
    unsatisfiable = HTTPException(status_code=416, headers={**common, "Content-Range": f"bytes */{size}"})
    if not match or not size or not any(match.groups()):
        handle.close()
        raise unsatisfiable
    first, last = match.groups()
    if first:
        start, end = int(first), min(int(last), size - 1) if last else size - 1
    else:
        start, end = max(0, size - int(last)), size - 1
    if start >= size or end < start:
        handle.close()
        raise unsatisfiable
    length = end - start + 1
    return StreamingResponse(
        _chunks(handle, start, length),
        status_code=206,
        media_type=content_type,
        headers={**common, "Content-Range": f"bytes {start}-{end}/{size}", "Content-Length": str(length)},
    )
