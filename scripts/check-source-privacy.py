"""Reject operational files and recognizable credentials in tracked source.

This is a prevention check, not a replacement for the human privacy audit.
It prints paths and finding categories, never matched credential values.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path, PurePosixPath

PRIVATE_ROOTS = {"dist", "media", "uploads", "backups", "media-storage"}
PRIVATE_SUFFIXES = {
    ".db",
    ".sqlite",
    ".sqlite3",
    ".dump",
    ".bundle",
    ".zip",
    ".tar",
    ".gz",
    ".7z",
    ".pdf",
    ".doc",
    ".docx",
    ".jpg",
    ".jpeg",
    ".png",
    ".heic",
    ".mp4",
    ".mov",
    ".gpx",
}
CREDENTIAL = re.compile(
    rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
    rb"|\bgh[pousr]_[A-Za-z0-9]{30,}\b"
    rb"|\bgithub_pat_[A-Za-z0-9_]{30,}\b"
    rb"|\bAKIA[A-Z0-9]{16}\b"
)


def findings(path: str, content: bytes) -> list[str]:
    name = PurePosixPath(path)
    result = []
    if name.parts[0] in PRIVATE_ROOTS or name.parts[:2] == ("docs", "screenshots"):
        result.append("operational data or private review evidence")
    if name.suffix.lower() in PRIVATE_SUFFIXES:
        result.append("database, backup, document or uploaded asset")
    if (name.name == ".env" or name.name.endswith(".env")) and not name.name.endswith(".example"):
        result.append("local environment configuration")
    if CREDENTIAL.search(content):
        result.append("credential-shaped content")
    return result


def main() -> int:
    source = Path(__file__).resolve().parents[1]
    root = Path(subprocess.check_output(["git", "-C", str(source), "rev-parse", "--show-toplevel"], text=True).strip())
    paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
    rejected = 0
    for path in filter(None, paths):
        file = root / path
        if not file.is_file():
            continue
        for category in findings(path, file.read_bytes()):
            print(f"{path}: {category}")
            rejected += 1
    if rejected:
        print(f"Source privacy check failed: {rejected} finding(s). Keep operational data outside Git.")
        return 1
    print("Source privacy prevention check passed; human review is still required.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
