"""Small, non-HTTP maintenance commands bundled with the Travel API image."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from datetime import timedelta

from .audit import purge_expired_audit_events
from .database import SessionLocal
from .media.service import purge_deleted_media
from .storage import get_storage


def _arguments(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Travel maintenance tasks")
    commands = parser.add_subparsers(dest="command", required=True)
    purge = commands.add_parser("purge-deleted-media", help="permanently remove expired soft-deleted media")
    purge.add_argument("--retention-days", type=int, required=True, help="soft-delete retention window in days")
    commands.add_parser(
        "purge-expired-audit-events", help="permanently remove audit events past their retention window"
    )
    arguments = parser.parse_args(argv)
    if arguments.command == "purge-deleted-media" and arguments.retention_days <= 0:
        parser.error("--retention-days must be greater than zero")
    return arguments


def main(argv: Sequence[str] | None = None) -> int:
    """Run one bounded maintenance command without exposing storage details."""
    arguments = _arguments(argv)
    session = SessionLocal()
    try:
        if arguments.command == "purge-deleted-media":
            purged = purge_deleted_media(
                session,
                get_storage(),
                older_than=timedelta(days=arguments.retention_days),
            )
            completed = f"Travel media purge completed: objects_purged={purged}"
        elif arguments.command == "purge-expired-audit-events":
            # The application-owned default is the sharing policy's fixed
            # 24-month retention window; the scheduler must not duplicate it.
            purged = purge_expired_audit_events(session)
            completed = f"Travel audit purge completed: events_purged={purged}"
        else:  # pragma: no cover - argparse enforces the choices above.
            return 64
    except Exception:
        session.rollback()
        # Object keys and filesystem paths are private implementation details;
        # systemd already records this command's non-zero exit for operators.
        print("Travel maintenance purge failed", file=sys.stderr)
        return 1
    finally:
        session.close()

    print(completed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
