"""Optional real PostgreSQL test of migration 033 (one document model, #368); uses a disposable database.

Set ``TRAVEL_TEST_DATABASE_URL`` to a server URL (any database on it); the test creates and drops its own."""

import os
from datetime import date, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from alembic import command
from app.core.config import settings
from app.models import MediaAsset, MediaKind, Stay, Trip
from app.services.media.ingest import _purge_pending_objects
from app.services.storage import LocalObjectStorage
from app.services.storage_reconcile import unreferenced_objects
from tests import legacy_rows

PREVIOUS = "032_live_audiences"
DIGESTS = {name: f"{number}" * 64 for number, name in enumerate(["booking", "policy", "photo", "passport", "other"])}


@pytest.fixture
def database(monkeypatch):
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    name = "one_document_" + uuid4().hex
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


def _object(connection, table: str, key: str, digest: str, owner: str, *, trip: str | None = None) -> str:
    identifier = uuid4().hex
    columns = "id, bucket, object_key, sha256, byte_size, content_type, state"
    values = ":id, 'media', :key, :sha, 7, 'application/pdf', 'available'"
    if table == "stored_objects":
        columns += ", trip_id"
        values += ", :trip"
    else:
        columns += ", owner_subject"
        values += ", :owner"
    connection.execute(
        text(f"INSERT INTO public.{table} ({columns}) VALUES ({values})"),  # noqa: S608
        {"id": identifier, "key": key, "sha": digest, "trip": trip, "owner": owner},
    )
    return identifier


def _trip_document(connection, trip: str, object_id: str, title: str, *, deleted: bool = False) -> str:
    identifier = uuid4().hex
    connection.execute(
        text(
            "INSERT INTO public.document_assets (id, trip_id, original_object_id, document_kind, title, owner_metadata, "
            "deleted_at) VALUES (:id, :trip, :object, 'booking', :title, '{}', "
            + ("now()" if deleted else "NULL")
            + ")"
        ),
        {"id": identifier, "trip": trip, "object": object_id, "title": title},
    )
    return identifier


def _library_document(connection, owner: str, object_id: str, title: str, linked: str | None = None) -> str:
    identifier = uuid4().hex
    connection.execute(
        text(
            "INSERT INTO public.owner_documents (id, owner_subject, original_object_id, document_kind, title, "
            "owner_metadata, linked_trip_id) VALUES (:id, :owner, :object, 'other', :title, '{}', :linked)"
        ),
        {"id": identifier, "owner": owner, "object": object_id, "title": title, "linked": linked},
    )
    return identifier


def _seed(engine, storage: LocalObjectStorage) -> dict[str, str]:
    """Documents of two trips and the library as the previous revision stored them, with every shared case."""
    ids: dict[str, str] = {}
    with Session(engine) as session:
        for name, owner in (("a", "owner-1"), ("b", "owner-1"), ("c", "owner-2")):
            trip = legacy_rows.trip(session, f"Exampleland {name}", owner)
            ids[f"trip_{name}"] = trip.id
        area = legacy_rows.area(session, ids["trip_a"], "Taipei")
        other = legacy_rows.area(session, ids["trip_a"], "Kaohsiung")
        stay = Stay(
            trip_id=ids["trip_a"], area_id=area.id, check_in_date=date(2054, 4, 1), check_out_date=date(2054, 4, 5)
        )
        route = legacy_rows.route(session, ids["trip_a"], area.id, other.id)
        session.add(stay)
        session.commit()
        ids["stay"], ids["route"] = stay.id, route.id

    with engine.begin() as connection:
        # The same file as a document of two trips (and of another owner, who is never merged with them).
        first = _object(connection, "stored_objects", "trip-a/booking", DIGESTS["booking"], "", trip=ids["trip_a"])
        second = _object(connection, "stored_objects", "trip-b/booking", DIGESTS["booking"], "", trip=ids["trip_b"])
        foreign = _object(connection, "stored_objects", "trip-c/booking", DIGESTS["booking"], "", trip=ids["trip_c"])
        ids["booking_a"] = _trip_document(connection, ids["trip_a"], first, "Booking A")
        ids["booking_b"] = _trip_document(connection, ids["trip_b"], second, "Booking B")
        ids["booking_c"] = _trip_document(connection, ids["trip_c"], foreign, "Booking C")
        # A library copy of the same file, unfiled, and one linked to a trip that already holds the same file.
        library = _object(connection, "owner_stored_objects", "owner/booking", DIGESTS["booking"], "owner-1")
        ids["library_booking"] = _library_document(connection, "owner-1", library, "Booking copy")
        trip_policy = _object(connection, "stored_objects", "trip-a/policy", DIGESTS["policy"], "", trip=ids["trip_a"])
        library_policy = _object(connection, "owner_stored_objects", "owner/policy", DIGESTS["policy"], "owner-1")
        ids["policy_trip"] = _trip_document(connection, ids["trip_a"], trip_policy, "Policy (trip)")
        ids["policy_linked"] = _library_document(
            connection, "owner-1", library_policy, "Policy (library)", ids["trip_a"]
        )
        # An unfiled library document, and one linked to a trip that holds nothing like it.
        passport = _object(connection, "owner_stored_objects", "owner/passport", DIGESTS["passport"], "owner-1")
        ids["passport"] = _library_document(connection, "owner-1", passport, "Passport")
        other_file = _object(connection, "owner_stored_objects", "owner/other", DIGESTS["other"], "owner-1")
        ids["linked_other"] = _library_document(connection, "owner-1", other_file, "Visa", ids["trip_b"])
        # A trip document whose file is also a photo of the trip: the object keeps its trip.
        photo = _object(connection, "stored_objects", "trip-a/photo", DIGESTS["photo"], "", trip=ids["trip_a"])
        ids["photo_document"] = _trip_document(connection, ids["trip_a"], photo, "Photo as document")
        ids["photo_object"] = photo
        # A removed document (a column nothing ever set) is deleted with its file.
        gone = _object(connection, "stored_objects", "trip-a/gone", "e" * 64, "", trip=ids["trip_a"])
        ids["gone"] = _trip_document(connection, ids["trip_a"], gone, "Removed", deleted=True)
        ids["gone_object"] = gone
        connection.execute(
            text("INSERT INTO public.stay_document_assets (stay_id, document_asset_id) VALUES (:stay, :document)"),
            {"stay": ids["stay"], "document": ids["booking_a"]},
        )
        connection.execute(
            text("INSERT INTO public.route_document_assets (route_id, document_asset_id) VALUES (:route, :document)"),
            {"route": ids["route"], "document": ids["policy_trip"]},
        )
        ids["keys"] = None
    with Session(engine) as session:
        session.add(
            MediaAsset(trip_id=ids["trip_a"], original_object_id=ids["photo_object"], media_kind=MediaKind.PHOTO)
        )
        session.commit()
    with engine.connect() as connection:
        keys = connection.execute(
            text(
                "SELECT object_key FROM public.stored_objects UNION SELECT object_key FROM public.owner_stored_objects"
            )
        ).scalars()
        for key in keys:
            storage.put(key, b"synthetic")
    ids.pop("keys")
    return ids


def _documents(engine) -> dict[str, tuple]:
    with engine.connect() as connection:
        rows = connection.execute(
            text("SELECT id, owner_subject, trip_id, original_object_id, title FROM public.document_assets")
        ).all()
    return {row.id: (row.owner_subject, row.trip_id, row.original_object_id, row.title) for row in rows}


def _objects(engine) -> dict[str, tuple]:
    with engine.connect() as connection:
        rows = connection.execute(
            text("SELECT id, object_key, owner_subject, trip_id, state::text AS state FROM public.stored_objects")
        ).all()
    return {row.object_key: (row.id, row.owner_subject, row.trip_id, row.state) for row in rows}


def test_the_two_homes_become_one_and_the_round_trip_loses_nothing(database, tmp_path) -> None:
    engine, config = database
    storage = LocalObjectStorage(str(tmp_path))
    command.upgrade(config, PREVIOUS)
    ids = _seed(engine, storage)

    command.upgrade(config, "head")
    assert {"owner_documents", "owner_stored_objects"}.isdisjoint(_tables(engine))
    documents, objects = _documents(engine), _objects(engine)

    # Every live document survives under its id; the removed one is gone.
    assert set(documents) == {
        ids[name]
        for name in (
            "booking_a",
            "booking_b",
            "booking_c",
            "library_booking",
            "policy_trip",
            "policy_linked",
            "passport",
            "linked_other",
            "photo_document",
        )
    }
    assert documents[ids["booking_a"]][:2] == ("owner-1", ids["trip_a"])
    assert documents[ids["booking_c"]][:2] == ("owner-2", ids["trip_c"])
    assert documents[ids["passport"]][:2] == ("owner-1", None)
    assert documents[ids["linked_other"]][:2] == ("owner-1", ids["trip_b"])  # a link becomes the trip it is filed under
    # A library document linked to a trip that held the same file is unfiled rather than lost.
    assert documents[ids["policy_trip"]][1] == ids["trip_a"]
    assert documents[ids["policy_linked"]][1] is None

    # The owner's copies of one file share one object; another owner's is separate.
    shared = {documents[ids[name]][2] for name in ("booking_a", "booking_b", "library_booking")}
    assert len(shared) == 1
    assert documents[ids["booking_c"]][2] not in shared
    assert len({documents[ids[name]][2] for name in ("policy_trip", "policy_linked")}) == 1
    # The released duplicates wait for the locked purge, with no owner or trip; kept ones are the owner's.
    kept = {key: row for key, row in objects.items() if row[0] in shared}
    assert len(kept) == 1
    [(row)] = kept.values()
    assert (row[1], row[2], row[3]) == ("owner-1", None, "available")
    released = [
        row
        for key, row in objects.items()
        if key in {"trip-a/booking", "trip-b/booking", "owner/booking"} and row[0] not in shared
    ]
    assert len(released) == 2
    assert all(row[1:] == (None, None, "purge_pending") for row in released)
    # A file a photo also uses keeps its trip, and a removed document's file waits for the purge.
    assert objects["trip-a/photo"][1:3] == ("owner-1", ids["trip_a"])
    assert objects["trip-a/gone"][3] == "purge_pending"

    # Attachments survive, and the unique keys hold.
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM public.stay_document_assets")) == 1
        assert connection.scalar(text("SELECT count(*) FROM public.route_document_assets")) == 1
        assert (
            connection.scalar(
                text(
                    "SELECT data_type FROM information_schema.columns WHERE table_name = 'stored_objects' AND column_name = 'byte_size'"
                )
            )
            == "bigint"
        )
    with engine.begin() as connection:
        connection.execute(text("UPDATE public.stored_objects SET byte_size = 3000000000"))  # over 2 GiB fits now

    # Storage reconciles clean, before and after the locked purge of what the migration released.
    old = timedelta(hours=0)
    with Session(engine) as session:
        assert unreferenced_objects(session, storage, older_than=old) == []
        assert _purge_pending_objects(session, storage) == 4  # three duplicates and the removed document's file
        assert unreferenced_objects(session, storage, older_than=old) == []
    assert {key for key, _ in storage.objects()} == set(_objects(engine))

    # The old schema holds one document per file: refuse while a file is shared, then drop the extra copies.
    with engine.begin() as connection:
        connection.execute(text("UPDATE public.stored_objects SET byte_size = 7"))
    with pytest.raises(RuntimeError, match="several trips"):
        command.downgrade(config, PREVIOUS)
    with engine.begin() as connection:
        for name in ("booking_b", "library_booking", "policy_linked"):
            connection.execute(text("DELETE FROM public.document_assets WHERE id = :id"), {"id": ids[name]})
    command.downgrade(config, PREVIOUS)
    assert {"owner_documents", "owner_stored_objects"} <= _tables(engine)
    with engine.connect() as connection:
        library = set(connection.execute(text("SELECT id FROM public.owner_documents")).scalars())
        trip_documents = set(connection.execute(text("SELECT id FROM public.document_assets")).scalars())
        assert connection.scalar(text("SELECT count(*) FROM public.stay_document_assets")) == 1
        assert connection.scalar(text("SELECT count(*) FROM public.route_document_assets")) == 1
        assert connection.scalar(text("SELECT count(*) FROM public.stored_objects WHERE trip_id IS NULL")) == 0
    # Filed documents are trip documents again, unfiled ones are the library's.
    assert library == {ids["passport"]}
    assert ids["booking_a"] in trip_documents and ids["linked_other"] in trip_documents

    command.upgrade(config, "head")
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    assert {"owner_documents", "owner_stored_objects"}.isdisjoint(_tables(engine))


def test_the_downgrade_refuses_what_the_old_schema_cannot_hold(database, tmp_path) -> None:
    engine, config = database
    command.upgrade(config, "head")
    with Session(engine) as session:
        first, second = (Trip(owner_subject="owner-1", title=f"Exampleland {name}") for name in "ab")
        session.add_all([first, second])
        session.commit()
        trips = (first.id, second.id)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO public.stored_objects (id, owner_subject, bucket, object_key, sha256, byte_size, "
                "content_type, state) VALUES ('o1', 'owner-1', 'library', 'owner/shared', :sha, 7, 'text/plain', 'available')"
            ),
            {"sha": "a" * 64},
        )
        for trip in trips:
            connection.execute(
                text(
                    "INSERT INTO public.document_assets (id, owner_subject, trip_id, original_object_id, document_kind, "
                    "title, owner_metadata) VALUES (:id, 'owner-1', :trip, 'o1', 'other', 'Policy', '{}')"
                ),
                {"id": uuid4().hex, "trip": trip},
            )
    with pytest.raises(RuntimeError, match="several trips"):
        command.downgrade(config, PREVIOUS)


def test_the_downgrade_gives_a_document_the_photo_object_when_both_hold_the_same_bytes_in_one_trip(
    database, tmp_path
) -> None:
    """Two objects now, one before: the old schema keeps one object per trip and checksum."""
    engine, config = database
    storage = LocalObjectStorage(str(tmp_path))
    command.upgrade(config, "head")
    with Session(engine) as session:
        trip = Trip(owner_subject="owner-1", title="Exampleland")
        session.add(trip)
        session.commit()
        trip_id = trip.id
    digest = "7" * 64
    with engine.begin() as connection:
        columns = "id, bucket, object_key, sha256, byte_size, content_type, state, trip_id, owner_subject"
        for name, key, trip_home, owner in (
            ("photo", "trip/photo", trip_id, None),
            ("owned", "owner/document", None, "owner-1"),
        ):
            connection.execute(
                text(
                    f"INSERT INTO public.stored_objects ({columns}) "  # noqa: S608
                    "VALUES (:id, 'media', :key, :sha, 7, 'image/jpeg', 'available', :trip, :owner)"
                ),
                {"id": name, "key": key, "sha": digest, "trip": trip_home, "owner": owner},
            )
            storage.put(key, b"synthetic")
        connection.execute(
            text(
                "INSERT INTO public.document_assets (id, owner_subject, trip_id, original_object_id, document_kind, "
                "title, owner_metadata) VALUES ('document', 'owner-1', :trip, 'owned', 'other', 'Receipt', '{}')"
            ),
            {"trip": trip_id},
        )
    with Session(engine) as session:
        session.add(MediaAsset(trip_id=trip_id, original_object_id="photo", media_kind=MediaKind.PHOTO))
        session.commit()

    command.downgrade(config, PREVIOUS)

    with engine.connect() as connection:
        assert connection.scalar(text("SELECT original_object_id FROM public.document_assets")) == "photo"
        assert (
            connection.scalar(text("SELECT count(*) FROM public.stored_objects WHERE sha256 = :sha"), {"sha": digest})
            == 1
        )
        # The document's own object is kept as purge inventory of the library, its bytes untouched.
        row = connection.execute(text("SELECT state::text, owner_subject FROM public.owner_stored_objects")).one()
        assert tuple(row) == ("purge_pending", "owner-1")
    assert storage.exists("trip/photo") and storage.exists("owner/document")
    # Upgrading again merges the two objects of the owner's file and releases the extra one for the locked purge.
    command.upgrade(config, "head")
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT original_object_id FROM public.document_assets")) == "photo"
        released = connection.execute(
            text("SELECT state::text, owner_subject, trip_id FROM public.stored_objects WHERE id = 'owned'")
        ).one()
        assert tuple(released) == ("purge_pending", None, None)
