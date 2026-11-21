"""Optional real PostgreSQL test of moving a trip's texts to another content language beside a concurrent writer (#376).

Set ``TRAVEL_TEST_DATABASE_URL`` to a server URL (any database on it); the test creates and drops its own."""

import os
import threading
import time
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from alembic import command
from app.core.config import settings
from app.core.content_language import ContentLanguage
from app.core.errors import Refusal
from app.models import Visit
from app.schemas import AreaInput, TripCreate, TripUpdate, VisitCreate, VisitUpdate
from app.services import areas as area_service
from app.services import trips as trip_service
from app.services import visits as visit_service
from app.services.localized import move_texts


@pytest.fixture
def engine(monkeypatch):
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    name = "bilingual_move_" + uuid4().hex
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
        command.upgrade(config, "head")
        yield engine
    finally:
        engine.dispose()
        with admin.connect() as connection:
            connection.execute(text(f"DROP DATABASE {name} WITH (FORCE)"))
        admin.dispose()


def _seed(engine) -> tuple[str, str]:
    """A Dutch trip with one visit written in Dutch only; returns the trip and visit ids."""
    with Session(engine) as session:
        trip = trip_service.create_trip(session, "owner-1", TripCreate(title="Rondreis"))
        area = area_service.save_area(session, "owner-1", trip.id, AreaInput(label="Brussel"))
        visit = visit_service.create_visit(
            session, "owner-1", trip.id, VisitCreate(area_id=area.id, title="Museum", summary="Mooi")
        )
        session.commit()
        return trip.id, visit.id


def _visit_texts(engine, visit_id: str) -> tuple[str | None, str | None]:
    with engine.connect() as connection:
        return tuple(
            connection.execute(text("SELECT title_nl, title_en FROM visits WHERE id = :id"), {"id": visit_id}).one()
        )


def _in_thread(work) -> tuple[threading.Thread, list]:
    outcome: list = []

    def run() -> None:
        try:
            outcome.append(work())
        except Exception as error:  # noqa: BLE001 - the test inspects what the thread raised
            outcome.append(error)

    thread = threading.Thread(target=run)
    thread.start()
    return thread, outcome


def test_a_text_writer_and_a_move_of_the_trips_texts_take_turns_and_nothing_is_overwritten(engine) -> None:
    trip_id, visit_id = _seed(engine)

    writer = Session(engine)
    # The writer adds the English title and holds the trip row lock until it commits.
    visit_service.update_visit(writer, "owner-1", trip_id, visit_id, VisitUpdate(title_en="Museum visit"))
    writer.flush()

    def move() -> object:
        with Session(engine) as session:
            try:
                trip_service.update_trip(
                    session, "owner-1", trip_id, TripUpdate(content_language=ContentLanguage.EN, move_texts=True)
                )
                session.commit()
            except Refusal as error:
                session.rollback()
                return error
            return "moved"

    thread, outcome = _in_thread(move)
    time.sleep(0.5)
    assert thread.is_alive(), "the move must wait for the writer that holds the trip"
    writer.commit()
    writer.close()
    thread.join(10)
    assert isinstance(outcome[0], Refusal) and outcome[0].code == "trip_text_in_both_languages"
    # The writer's translation survived, and the refused move left the trip and its visit as they were.
    assert _visit_texts(engine, visit_id) == ("Museum", "Museum visit")
    with Session(engine) as session:
        assert trip_service.get_trip(session, "owner-1", trip_id).content_language == "nl"


def test_a_move_never_overwrites_a_translation_committed_after_it_started(engine) -> None:
    """Without the trip lock (a writer that does not take it), the row's own update still keeps the translation."""
    trip_id, visit_id = _seed(engine)

    writer = Session(engine)
    writer.execute(text("UPDATE visits SET title_en = 'Museum visit' WHERE id = :id"), {"id": visit_id})

    def move() -> object:
        with Session(engine) as session:
            try:
                move_texts(session, trip_id, ContentLanguage.NL, ContentLanguage.EN)
                session.commit()
            except Refusal as error:
                session.rollback()
                return error
            return "moved"

    thread, outcome = _in_thread(move)
    time.sleep(0.5)
    assert thread.is_alive(), "the move waits for the row the writer changed"
    writer.commit()
    writer.close()
    thread.join(10)
    assert isinstance(outcome[0], Refusal) and outcome[0].code == "trip_text_in_both_languages"
    assert _visit_texts(engine, visit_id) == ("Museum", "Museum visit")


def test_a_move_without_a_competing_writer_moves_every_text(engine) -> None:
    trip_id, visit_id = _seed(engine)
    with Session(engine) as session:
        trip_service.update_trip(
            session, "owner-1", trip_id, TripUpdate(content_language=ContentLanguage.EN, move_texts=True)
        )
        session.commit()
    assert _visit_texts(engine, visit_id) == (None, "Museum")
    with Session(engine) as session:
        moved = session.get(Visit, visit_id)
        assert moved is not None and (moved.title, moved.summary_en) == ("Museum", "Mooi")
