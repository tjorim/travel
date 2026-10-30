"""Accent-insensitive, wildcard-safe substring matching for owner search boxes.

Column and query are folded the same way inside the database: PostgreSQL uses one ``translate(lower(...))`` and
SQLite (local development) a Python function registered on every connection. No ``unaccent`` extension is needed.
"""

import sqlite3
import unicodedata

from sqlalchemy import Engine, String, event, func
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import QueryableAttribute
from sqlalchemy.sql.expression import FunctionElement

_ESCAPE = "\\"


def _accent_map() -> dict[str, str]:
    """Lowercase accented Latin letters mapped to their ASCII base, for PostgreSQL's ``translate``."""
    mapping: dict[str, str] = {}
    for code in range(0xC0, 0x250):
        char = chr(code)
        if char.lower() != char:
            continue
        base = unicodedata.normalize("NFD", char)[0]
        if base != char and base.isascii() and base.isalpha():
            mapping[char] = base
    return mapping


_ACCENTS = _accent_map()
_FROM = "".join(_ACCENTS)
_TO = "".join(_ACCENTS.values())


def unaccent_fold(value: str | None) -> str | None:
    if value is None:
        return None
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(char for char in decomposed if not unicodedata.combining(char)).casefold()


@event.listens_for(Engine, "connect")
def _register_sqlite_fold(dbapi_connection: object, _: object) -> None:
    if isinstance(dbapi_connection, sqlite3.Connection):
        dbapi_connection.create_function("unaccent_fold", 1, unaccent_fold, deterministic=True)


class _Fold(FunctionElement):
    type = String()
    inherit_cache = True


@compiles(_Fold)
def _fold_postgresql(element: _Fold, compiler, **kw) -> str:  # noqa: ANN001, ANN003
    return f"translate(lower({compiler.process(element.clauses, **kw)}), '{_FROM}', '{_TO}')"


@compiles(_Fold, "sqlite")
def _fold_sqlite(element: _Fold, compiler, **kw) -> str:  # noqa: ANN001, ANN003
    return f"unaccent_fold({compiler.process(element.clauses, **kw)})"


def contains(column: QueryableAttribute[str] | QueryableAttribute[str | None], query: str):  # noqa: ANN201
    """Match ``query`` literally (``%`` and ``_`` included) anywhere in ``column``, ignoring accents and case."""
    escaped = query.replace(_ESCAPE, _ESCAPE * 2).replace("%", f"{_ESCAPE}%").replace("_", f"{_ESCAPE}_")
    return func.coalesce(_Fold(column), "").like(_Fold(f"%{escaped}%"), escape=_ESCAPE)
