"""Application-controlled object storage for media originals and derivatives.

Every imported or uploaded file is copied here; a provider URL or a device's
local file handle is never the durable, servable copy. `LocalObjectStorage` is
a filesystem adapter for local/test environments; production points
`TRAVEL_MEDIA_STORAGE_ROOT` at the backed-up VPS media volume, not Git.
"""

import hashlib
import io
import os
import tempfile
from collections.abc import Iterator
from pathlib import Path
from threading import BoundedSemaphore
from typing import BinaryIO, Protocol

from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import settings

# PostgreSQL advisory lock held by every removal of a stored object's bytes,
# and by the apps backup while it pins a database snapshot and hardlinks the
# media volume (apps#245).  See docs/object-storage.md.
OBJECT_DELETION_LOCK = 245


CHUNK_SIZE = 1024 * 1024
_upload_slots = BoundedSemaphore(settings.media_max_concurrent_uploads)


class StagedUpload:
    """Own a disk-backed payload and its admission slot until explicitly closed."""

    def __init__(self) -> None:
        from fastapi import HTTPException

        if not _upload_slots.acquire(blocking=False):
            raise HTTPException(503, "Upload capacity exhausted", headers={"Retry-After": "5"})
        try:
            self.file = tempfile.TemporaryFile("w+b")  # noqa: SIM115 -- owned until close()
        except BaseException:
            _upload_slots.release()
            raise
        self.size = 0
        self.hasher = hashlib.sha256()
        self.closed = False

    def write(self, chunk: bytes) -> None:
        self.file.write(chunk)
        self.hasher.update(chunk)
        self.size += len(chunk)

    def __len__(self) -> int:
        return self.size

    def close(self) -> None:
        if not self.closed:
            self.closed = True
            self.file.close()
            _upload_slots.release()

    def __enter__(self):
        return self

    def __exit__(self, *args) -> None:
        self.close()


def payload_file(data: bytes | StagedUpload) -> BinaryIO:
    if isinstance(data, StagedUpload):
        data.file.seek(0)
        return data.file
    return io.BytesIO(data)


def stream_digest(source: BinaryIO) -> str:
    digest = hashlib.sha256()
    while chunk := source.read(CHUNK_SIZE):
        digest.update(chunk)
    return digest.hexdigest()


def sha256_hex(data: bytes | StagedUpload) -> str:
    return data.hasher.hexdigest() if isinstance(data, StagedUpload) else hashlib.sha256(data).hexdigest()


def verify_object(storage: ObjectStorage, key: str, digest: str) -> bool:
    with storage.open(key) as source:
        return stream_digest(source) == digest


def lock_object_deletion(session: Session) -> None:
    """Wait until no backup is capturing the object set; released at commit.

    Take it after the row lock and before deleting the bytes, so a backup's
    snapshot never references a file that is gone before it is linked.
    """
    if session.get_bind().dialect.name == "postgresql":
        session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": OBJECT_DELETION_LOCK})


class ObjectStorage(Protocol):
    def put(self, key: str, data: bytes | StagedUpload) -> None: ...

    def get(self, key: str) -> bytes: ...

    def open(self, key: str) -> BinaryIO: ...

    def delete(self, key: str) -> None: ...

    def exists(self, key: str) -> bool: ...

    def objects(self) -> Iterator[tuple[str, float]]: ...


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
        if not segments or any(not segment or segment.startswith(".") or "\\" in segment for segment in segments):
            raise ValueError("Invalid object key")
        return self.root.joinpath(*segments)

    def put(self, key: str, data: bytes | StagedUpload) -> None:
        path = self._path_for(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        try:
            with tmp_path.open("wb") as output:
                source = payload_file(data)
                while chunk := source.read(CHUNK_SIZE):
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            os.replace(tmp_path, path)
        finally:
            tmp_path.unlink(missing_ok=True)
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

    def objects(self) -> Iterator[tuple[str, float]]:
        """Yield every stored file as ``(key, modification time)``.

        Dot-entries are skipped: no key starts with a dot, and the backup's
        temporary hardlinks live in ``.backup-snapshot``.
        """
        for directory, subdirectories, files in os.walk(self.root):
            subdirectories[:] = [name for name in subdirectories if not name.startswith(".")]
            for name in files:
                if name.startswith("."):
                    continue
                path = Path(directory, name)
                try:
                    modified = path.stat().st_mtime
                except FileNotFoundError:  # removed while listing
                    continue
                yield path.relative_to(self.root).as_posix(), modified


_default_storage = LocalObjectStorage()


def get_storage() -> ObjectStorage:
    return _default_storage
