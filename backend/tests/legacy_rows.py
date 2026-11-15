"""Rows for the migration tests that run at an old revision.

The models describe the head schema, so an ORM insert names columns an older revision does not have yet (the
Dutch and English text columns of revision 034). These helpers insert with the single text columns those revisions
have, and answer the new row's id."""

from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

# NOT NULL columns without a server default, which the ORM fills in Python.
_DEFAULTS: dict[str, dict] = {
    "trips": {},
    "areas": {"visibility": "private"},
    "locations": {"visibility": "private", "share_address": False},
    "routes": {"mode": "other", "status": "planned", "visibility": "private"},
    "collections": {"state": "draft", "rotations": 0},
}


def _insert(session: Session, table: str, **values) -> SimpleNamespace:
    row = {"id": uuid4().hex, **_DEFAULTS[table], **values}
    columns = ", ".join(f'"{name}"' for name in row)
    binds = ", ".join(f":{name}" for name in row)
    session.execute(text(f"INSERT INTO {table} ({columns}) VALUES ({binds})"), row)  # noqa: S608
    return SimpleNamespace(**row)


def trip(session: Session, title: str = "Exampleland 2054", owner: str = "owner-1", **fields) -> SimpleNamespace:
    return _insert(session, "trips", owner_subject=owner, title=title, **fields)


def area(session: Session, trip_id: str, label: str | None = None, **fields) -> SimpleNamespace:
    return _insert(session, "areas", trip_id=trip_id, label=label, **fields)


def location(session: Session, trip_id: str, area_id: str, **fields) -> SimpleNamespace:
    return _insert(session, "locations", trip_id=trip_id, area_id=area_id, **fields)


def route(session: Session, trip_id: str, departure_area_id: str, arrival_area_id: str, **fields) -> SimpleNamespace:
    return _insert(
        session,
        "routes",
        trip_id=trip_id,
        departure_area_id=departure_area_id,
        arrival_area_id=arrival_area_id,
        **fields,
    )


def collection(session: Session, label: str, owner: str = "owner-1", **fields) -> SimpleNamespace:
    return _insert(session, "collections", owner_subject=owner, label=label, **fields)
