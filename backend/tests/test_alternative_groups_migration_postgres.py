"""Optional real PostgreSQL test of migration 021 (alternative groups); uses a disposable database.

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
from app.models import (
    AlternativeGroup,
    AlternativeGroupKind,
    AlternativeGroupMember,
    Area,
    AuditEvent,
    AuditEventKind,
    AuditTargetType,
    Stay,
    StayStatus,
    Trip,
)


@pytest.fixture
def database(monkeypatch):
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    name = "alternative_groups_" + uuid4().hex
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


def _seed(engine) -> dict[str, str]:
    with Session(engine) as session:
        trip = Trip(owner_subject="owner-1", title="Exampleland 2054")
        session.add(trip)
        session.flush()
        area = Area(trip_id=trip.id, label="Tainan", country_code="TW")
        session.add(area)
        session.flush()
        stays = [
            Stay(
                trip_id=trip.id,
                area_id=area.id,
                check_in_date=date(2054, 4, 1),
                check_out_date=date(2054, 4, 4),
                status=StayStatus.IDEA,
            )
            for _ in range(3)
        ]
        session.add_all(stays)
        session.flush()
        session.commit()
        return {"trip": trip.id, "stays": ",".join(stay.id for stay in stays)}


def _group(session: Session, trip_id: str, stay_ids: list[str]) -> AlternativeGroup:
    group = AlternativeGroup(trip_id=trip_id, kind=AlternativeGroupKind.STAY)
    group.members = [AlternativeGroupMember(stay_id=stay_id) for stay_id in stay_ids]
    session.add(group)
    session.flush()
    return group


def test_upgrade_enforces_the_group_rules_and_the_downgrade_leaves_no_audit_rows_behind(database) -> None:
    engine, config = database
    command.upgrade(config, "020_area_only_stay")
    ids = _seed(engine)
    stays = ids["stays"].split(",")
    command.upgrade(config, "head")

    with Session(engine) as session:
        group = _group(session, ids["trip"], stays[:2])
        group.members[0].chosen = True
        session.commit()
        group_id = group.id

    # At most one chosen member per group.
    with Session(engine) as session:
        (other,) = [member for member in session.get(AlternativeGroup, group_id).members if not member.chosen]
        other.chosen = True
        with pytest.raises(IntegrityError):
            session.commit()
    # A record is in one group at most.
    with Session(engine) as session, pytest.raises(IntegrityError):
        _group(session, ids["trip"], [stays[0], stays[2]])
    # A member names exactly one record.
    with engine.connect() as connection, pytest.raises(IntegrityError):
        connection.execute(
            text("INSERT INTO alternative_group_members (id, group_id) VALUES ('m1', :group)"), {"group": group_id}
        )
    # The audit vocabulary accepts the new kinds.
    with Session(engine) as session:
        session.add(
            AuditEvent(
                trip_id=ids["trip"],
                actor_subject="owner-1",
                kind=AuditEventKind.ALTERNATIVE_CHOOSE,
                target_type=AuditTargetType.ALTERNATIVE_GROUP,
                target_id=group_id,
                details={},
            )
        )
        session.commit()
    # Deleting a record leaves its group, without that member.
    with Session(engine) as session:
        session.execute(text("DELETE FROM stays WHERE id = :id"), {"id": stays[0]})
        session.commit()
        assert [m.stay_id for m in session.get(AlternativeGroup, group_id).members] == [stays[1]]

    command.downgrade(config, "020_area_only_stay")
    with engine.connect() as connection:
        tables = set(
            connection.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"))
            .scalars()
            .all()
        )
        assert not {"alternative_groups", "alternative_group_members"} & tables
        assert connection.execute(text("SELECT count(*) FROM audit_events")).scalar_one() == 0
        assert connection.execute(text("SELECT count(*) FROM stays")).scalar_one() == 2
    command.upgrade(config, "head")  # the round trip is clean
