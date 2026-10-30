"""Accent-insensitive, wildcard-safe substring matching for owner search boxes.

Both sides are folded the same way: accents removed, then lowercased. PostgreSQL uses ``translate`` and SQLite
(local development) nested ``replace``, so no ``unaccent`` extension is needed.
"""

import unicodedata

from sqlalchemy import ColumnElement, String, func
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import QueryableAttribute
from sqlalchemy.sql.expression import FunctionElement

_ESCAPE = "\\"


def _accent_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for code in range(0xC0, 0x250):
        char = chr(code)
        base = unicodedata.normalize("NFD", char)[0]
        if base != char and base.isascii() and base.isalpha():
            mapping[char] = base
    return mapping


_ACCENTS = _accent_map()


def fold(text: str) -> str:
    return "".join(_ACCENTS.get(char, char) for char in text).lower()


class _Fold(FunctionElement):
    type = String()
    inherit_cache = True


@compiles(_Fold)
def _fold_postgresql(element: _Fold, compiler, **kw) -> str:  # noqa: ANN001, ANN003
    return f"lower({_translate(compiler.process(element.clauses, **kw))})"


@compiles(_Fold, "sqlite")
def _fold_sqlite(element: _Fold, compiler, **kw) -> str:  # noqa: ANN001, ANN003
    sql = compiler.process(element.clauses, **kw)
    for char, base in _ACCENTS.items():
        sql = f"replace({sql}, '{char}', '{base}')"
    return f"lower({sql})"


def _translate(sql: str) -> str:
    source = "".join(_ACCENTS)
    target = "".join(_ACCENTS.values())
    return f"translate({sql}, '{source}', '{target}')"


def contains(column: QueryableAttribute[str] | QueryableAttribute[str | None], query: str) -> ColumnElement[bool]:
    """Match ``query`` literally (``%`` and ``_`` included) anywhere in ``column``, ignoring accents and case."""
    escaped = fold(query).replace(_ESCAPE, _ESCAPE * 2).replace("%", f"{_ESCAPE}%").replace("_", f"{_ESCAPE}_")
    return func.coalesce(_Fold(column), "").like(f"%{escaped}%", escape=_ESCAPE)
