"""Create a local SQLite development database from the models.

The Alembic migrations target PostgreSQL (production) and do not run on SQLite. A SQLite dev
database is disposable, so it is built straight from the models instead:

    uv run python -m app.dev_schema          # create missing tables
    uv run python -m app.dev_schema --reset  # drop every table first

``create_all`` never alters an existing table, so after a model change run it with ``--reset``
to rebuild. It refuses to touch any other database.
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy.engine import Engine

from .database import Base


def create_dev_schema(engine: Engine, *, reset: bool = False) -> None:
    if engine.dialect.name != "sqlite":
        raise SystemExit(
            f"Refusing to create the schema on {engine.dialect.name}: this is for the SQLite dev database. "
            "Use `uv run alembic upgrade head` for PostgreSQL."
        )
    from . import models  # noqa: F401  (registers every model on Base.metadata)

    if reset:
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--reset", action="store_true", help="drop every table first")
    args = parser.parse_args(argv)

    from .database import engine

    create_dev_schema(engine, reset=args.reset)
    print(f"Schema ready on {engine.url.render_as_string(hide_password=True)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
