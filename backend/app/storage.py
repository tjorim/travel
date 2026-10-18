"""Application-controlled object storage for media originals and derivatives.

Every imported or uploaded file is copied here; a provider URL or a device's
local file handle is never the durable, servable copy. `LocalObjectStorage` is
a filesystem adapter for local/test environments; production points
`TRAVEL_MEDIA_STORAGE_ROOT` at the backed-up VPS media volume, not Git.
"""

import hashlib
import os
from pathlib import Path
from typing import BinaryIO, Protocol

from .config import settings


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class ObjectStorage(Protocol):
    def put(self, key: str, data: bytes) -> None: ...

    def get(self, key: str) -> bytes: ...

    def open(self, key: str) -> BinaryIO: ...

    def delete(self, key: str) -> None: ...

    def exists(self, key: str) -> bool: ...


class LocalObjectStorage:
    """Filesystem-backed storage rooted at `TRAVEL_MEDIA_STORAGE_ROOT`.

    Object keys are opaque and never contain the original filename; they are
    written with a temp-file-then-rename so a reader never observes a
    partially written object.
    """

    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root if root is not None else settings.media_storage_root)

    def _path_for(self, key: str) -> Path:
        segments = key.split("/") if key else []
        if not segments or any(not segment or segment in {".", ".."} or "\\" in segment for segment in segments):
            raise ValueError("Invalid object key")
        return self.root.joinpath(*segments)

    def put(self, key: str, data: bytes) -> None:
        path = self._path_for(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        with tmp_path.open("wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(tmp_path, path)
        # A database commit/remote ACK must not outlive an unflushed rename.
        # Sync each newly possible directory entry through the storage root.
        directory = path.parent
        while True:
            descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            if directory == self.root.parent:
                break
            directory = directory.parent

    def get(self, key: str) -> bytes:
        return self._path_for(key).read_bytes()

    def open(self, key: str) -> BinaryIO:
        return self._path_for(key).open("rb")

    def delete(self, key: str) -> None:
        self._path_for(key).unlink(missing_ok=True)

    def exists(self, key: str) -> bool:
        return self._path_for(key).exists()


_default_storage = LocalObjectStorage()


def get_storage() -> ObjectStorage:
    return _default_storage
