"""Optional real PostgreSQL test of migration 023 (documents linked to stays); uses a disposable database.

Set ``TRAVEL_TEST_DATABASE_URL`` to a server URL (any database on it); the test creates and drops its own."""

import os
from datetime import date
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.config import settings
from app.models import Area, DocumentAsset, DocumentKind, ObjectState, Stay, StayDocumentAsset, StoredObject, Trip

PREVIOUS = "022_sharing_preset_label"


@pytest.fixture
def database(monkeypatch):
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    name = "stay_documents_" + uuid4().hex
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f"CREATE DATABASE {name}"))
    target = make_url(url).set(database=name).render_as_string(hide_password=False)
    monkeypatch.setattr(settings, "database_url", target)
    engine = create_engine(target)
    try:
        # No ini file: env.py would otherwise reconfigure (and silence) the loggers other tests capture.
        config = Config()
        config.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
        yield engine, config
    finally:
        engine.dispose()
        with admin.connect() as connection:
            connection.execute(text(f"DROP DATABASE {name} WITH (FORCE)"))
        admin.dispose()


def _tables(engine) -> set[str]:
    with engine.connect() as connection:
        return set(
            connection.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"))
            .scalars()
            .all()
        )


def _count(engine, table: str) -> int:
    with engine.connect() as connection:
        return connection.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()  # noqa: S608


def _seed(engine) -> dict[str, str]:
    """A trip with a stay and two documents, written through the head models."""
    with Session(engine) as session:
        trip = Trip(owner_subject="owner-1", title="Exampleland 2054")
        session.add(trip)
        session.flush()
        area = Area(trip_id=trip.id, label="Taipei")
        session.add(area)
        session.flush()
        stay = Stay(trip_id=trip.id, area_id=area.id, check_in_date=date(2054, 4, 1), check_out_date=date(2054, 4, 5))
        session.add(stay)
        documents = []
        for number in range(2):
            stored = StoredObject(
                trip_id=trip.id,
                object_key=f"documents/{uuid4().hex}",
                sha256=uuid4().hex + uuid4().hex,
                byte_size=10,
                content_type="text/plain",
                state=ObjectState.AVAILABLE,
            )
            session.add(stored)
            session.flush()
            document = DocumentAsset(
                trip_id=trip.id, original_object_id=stored.id, document_kind=DocumentKind.BOOKING, title=f"Doc {number}"
            )
            session.add(document)
            documents.append(document)
        session.commit()
        return {"trip": trip.id, "stay": stay.id, "kept": documents[0].id, "removed": documents[1].id}


def test_the_link_table_is_added_removed_and_cascades_from_both_sides(database) -> None:
    engine, config = database
    command.upgrade(config, PREVIOUS)
    assert "stay_document_assets" not in _tables(engine)

    command.upgrade(config, "head")
    assert "stay_document_assets" in _tables(engine)
    assert _count(engine, "stay_document_assets") == 0  # no existing row gains a link, so no audience changes
    ids = _seed(engine)

    with Session(engine) as session:
        session.add_all(
            [
                StayDocumentAsset(stay_id=ids["stay"], document_asset_id=ids["kept"]),
                StayDocumentAsset(stay_id=ids["stay"], document_asset_id=ids["removed"]),
            ]
        )
        session.commit()
        # A document attaches to a stay once.
        session.add(StayDocumentAsset(stay_id=ids["stay"], document_asset_id=ids["kept"]))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

    # Deleting a document removes only its link.
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM document_assets WHERE id = :id"), {"id": ids["removed"]})
    assert _count(engine, "stay_document_assets") == 1
    assert _count(engine, "stays") == 1

    # Deleting the stay removes its links and leaves the documents.
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM stays WHERE id = :id"), {"id": ids["stay"]})
    assert _count(engine, "stay_document_assets") == 0
    assert _count(engine, "document_assets") == 1


def test_the_downgrade_drops_only_the_links_and_the_round_trip_is_clean(database) -> None:
    engine, config = database
    command.upgrade(config, "head")
    ids = _seed(engine)
    with Session(engine) as session:
        session.add(StayDocumentAsset(stay_id=ids["stay"], document_asset_id=ids["kept"]))
        session.commit()

    command.downgrade(config, PREVIOUS)
    assert "stay_document_assets" not in _tables(engine)
    # The stay and both documents survive; only the attachment is gone.
    assert _count(engine, "stays") == 1
    assert _count(engine, "document_assets") == 2

    command.upgrade(config, "head")
    assert _count(engine, "stay_document_assets") == 0
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    assert "stay_document_assets" in _tables(engine)
