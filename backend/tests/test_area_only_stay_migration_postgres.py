"""Optional real PostgreSQL test of migration 020 (area-only stays); uses a disposable database.

Set ``TRAVEL_TEST_DATABASE_URL`` to a server URL (any database on it); the test creates and drops its own.

It seeds the schema of the previous revision, with every kind of location a stay can point at, and checks what the
migration does to each: a private, unnamed city-level placeholder used by stays alone is converted and removed, and
every other location is kept with its stays attached."""

import os
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, insert, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from alembic import command
from app.config import settings
from app.models import Area, DatePrecision, Location, PublicSurface, Route, TravelUpdate, Trip, Visibility


@pytest.fixture
def database(monkeypatch):
    url = os.environ.get("TRAVEL_TEST_DATABASE_URL")
    if not url:
        pytest.skip("local PostgreSQL test URL not configured")
    name = "area_only_stay_" + uuid4().hex
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


# name -> (location fields, extra use, expected to be a converted placeholder)
PLACEHOLDER = {"visibility": Visibility.PRIVATE, "locality": "Taipei", "country_code": "TW"}
CASES: dict[str, tuple[dict, str | None, bool]] = {
    "placeholder": (PLACEHOLDER, None, True),
    "placeholder_without_city": ({"visibility": Visibility.PRIVATE}, None, True),
    "placeholder_other_case": ({**PLACEHOLDER, "locality": "TAIPEI"}, None, True),
    "placeholder_with_a_visit": (PLACEHOLDER, "visit", False),
    "placeholder_with_a_route": (PLACEHOLDER, "route", False),
    "placeholder_with_an_update": (PLACEHOLDER, "update", False),
    "placeholder_in_a_scope": (PLACEHOLDER, "scope", False),
    # The owner's city-level shells with the area's own two-decimal point, converted when private.
    "generic_verblijf_on_the_area_point": (
        {
            "visibility": Visibility.PRIVATE,
            "display_name": "Verblijf in Taipei",
            "locality": "Taipei",
            "country_code": "TW",
            "latitude": 25.03,
            "longitude": 121.56,
        },
        None,
        True,
    ),
    # The same, shared with visitors: they receive it, so converting would change what they read. Kept.
    "shared_generic_verblijf_on_the_area_point": (
        {
            "visibility": Visibility.EVERYONE,
            "label": "Verblijf in Taipei",
            "display_name": "Verblijf in Taipei",
            "locality": "Taipei",
            "country_code": "TW",
            "latitude": 25.03,
            "longitude": 121.56,
        },
        None,
        False,
    ),
    # An exact private position never counts as a shell, whatever else is missing.
    "unlabeled_four_decimal_point_no_address": (
        {**PLACEHOLDER, "latitude": 25.0470, "longitude": 121.5100},
        None,
        False,
    ),
    "three_decimals_on_the_area_point": ({**PLACEHOLDER, "latitude": 25.031, "longitude": 121.561}, None, False),
    "confirmed_hotel_with_four_decimals_and_address": (
        {
            **PLACEHOLDER,
            "display_name": "Hotel Exact",
            "address_line1": "3 Example Road",
            "latitude": 25.0412,
            "longitude": 121.5233,
        },
        None,
        False,
    ),
    "shared_and_named": (
        {"visibility": Visibility.EVERYONE, "label": "Verblijf in Taipei", "display_name": "Verblijf in Taipei"},
        None,
        False,
    ),
    "custom_visibility": ({**PLACEHOLDER, "visibility": Visibility.CUSTOM, "label": "Somewhere"}, None, False),
    "named_by_the_owner": ({**PLACEHOLDER, "label": "Our base"}, None, False),
    "display_name": ({**PLACEHOLDER, "display_name": "Taipei (hotel nog te kiezen)"}, None, False),
    "with_a_point": ({**PLACEHOLDER, "latitude": 25.04, "longitude": 121.5}, None, False),
    "with_notes": ({**PLACEHOLDER, "notes": "Ask the host"}, None, False),
    "with_an_address": ({**PLACEHOLDER, "address_line1": "1 Synthetic Street"}, None, False),
    "with_a_postal_code": ({**PLACEHOLDER, "postal_code": "100"}, None, False),
    "with_an_admin_area": ({**PLACEHOLDER, "admin_area": "Taipei City"}, None, False),
    "with_an_osm_element": ({**PLACEHOLDER, "osm_element_type": "node", "osm_element_id": "1"}, None, False),
    "sharing_its_address": ({**PLACEHOLDER, "share_address": True}, None, False),
    "another_city": ({**PLACEHOLDER, "locality": "Banqiao"}, None, False),
    "another_country": ({**PLACEHOLDER, "country_code": "JP"}, None, False),
    "real_hotel": (
        {**PLACEHOLDER, "display_name": "Hotel Synthetic", "address_line1": "2 Example Road", "latitude": 25.0},
        None,
        False,
    ),
}


def _seed(engine) -> dict:
    """A trip at the previous revision. Stays are inserted as SQL: the Stay model describes the head schema."""
    with Session(engine) as session:
        trip = Trip(owner_subject="owner-1", title="Exampleland 2054")
        session.add(trip)
        session.flush()
        area = Area(trip_id=trip.id, label="Taipei", country_code="TW", latitude=25.03, longitude=121.56)
        other = Area(trip_id=trip.id, label="Tainan", country_code="TW")
        chiayi = Area(trip_id=trip.id, label="Chiayi City", country_code="TW")
        session.add_all([area, other, chiayi])
        session.flush()
        stays: dict[str, str] = {}
        locations: dict[str, str] = {}
        scope_items: list[dict] = []
        for index, (name, (fields, use, _)) in enumerate(CASES.items()):
            location = Location(trip_id=trip.id, area_id=area.id, **fields)
            session.add(location)
            session.flush()
            locations[name] = location.id
            if use == "visit":
                # Raw SQL: the Visit model describes the head schema, which has no position.
                session.execute(
                    text(
                        'INSERT INTO visits (id, trip_id, "position", area_id, location_id, status, visibility, '
                        "share_time) VALUES (:id, :trip, :position, :area, :location, 'planned', 'private', false)"
                    ),
                    {"id": uuid4().hex, "trip": trip.id, "position": index, "area": area.id, "location": location.id},
                )
            elif use == "route":
                session.add(
                    Route(
                        trip_id=trip.id,
                        departure_area_id=area.id,
                        arrival_area_id=other.id,
                        departure_location_id=location.id,
                    )
                )
            elif use == "update":
                session.add(
                    TravelUpdate(
                        trip_id=trip.id,
                        area_id=area.id,
                        location_id=location.id,
                        occurred_at=datetime(2054, 4, 2, tzinfo=UTC),
                        date_precision=DatePrecision.DAY,
                        title="Here",
                        body="Hello.",
                    )
                )
            elif use == "scope":
                scope_items.append({"kind": "location", "id": location.id})
        # A placeholder two stays share, a placeholder nothing uses, and one in another area.
        orphan = Location(trip_id=trip.id, area_id=other.id, locality="Tainan", country_code="TW")
        session.add(orphan)
        # A Core insert names only the columns given: the model also has columns that later revisions add.
        session.execute(insert(PublicSurface).values(trip_id=trip.id, scope={"items": scope_items}))
        session.flush()
        locations["orphan"] = orphan.id
        for index, name in enumerate(CASES):
            for second in (0, 1) if name == "placeholder" else (0,):
                stay_id = uuid4().hex
                session.execute(
                    text(
                        "INSERT INTO stays (id, trip_id, location_id, check_in_date, check_out_date, status, "
                        "visibility, share_date_precision, property_name) VALUES (:id, :trip, :location, "
                        ":check_in, :check_out, 'planned', 'everyone', 'month', :name)"
                    ),
                    {
                        "id": stay_id,
                        "trip": trip.id,
                        "location": locations[name],
                        "name": f"Property {name}",
                        "check_in": date(2054, 1, 1) + timedelta(days=index + second * 40),
                        "check_out": date(2054, 1, 2) + timedelta(days=index + second * 40),
                    },
                )
                stays[name if not second else name + "_again"] = stay_id
        session.commit()
        return {
            "trip": trip.id,
            "areas": {"Taipei": area.id, "Tainan": other.id, "Chiayi": chiayi.id},
            "stays": stays,
            "locations": locations,
        }


def _stay_rows(engine, *, with_area: bool = True) -> dict[str, tuple[str | None, str | None]]:
    """Each stay's (area, location); the previous schema has no stay area, so it reads ``None``."""
    with engine.connect() as connection:
        rows = connection.execute(
            text(f"SELECT id, {'area_id' if with_area else 'NULL'} AS area_id, location_id FROM stays")
        ).all()
    return {row.id: (row.area_id, row.location_id) for row in rows}


def _location_ids(engine) -> set[str]:
    with engine.connect() as connection:
        return set(connection.execute(text("SELECT id FROM locations")).scalars())


def test_upgrade_converts_only_placeholders_that_stays_alone_use(database) -> None:
    engine, config = database
    command.upgrade(config, "019_audience_date_precision")
    ids = _seed(engine)
    command.upgrade(config, "head")

    rows = _stay_rows(engine)
    remaining = _location_ids(engine)
    for name, (_, _, converted) in CASES.items():
        stays = [ids["stays"][name], *([ids["stays"][name + "_again"]] if name + "_again" in ids["stays"] else [])]
        for stay_id in stays:
            area_id, location_id = rows[stay_id]
            assert area_id == ids["areas"]["Taipei"], name  # every stay keeps the area it read from its location
            if converted:
                assert location_id is None, name
            else:
                assert location_id == ids["locations"][name], name
        assert (ids["locations"][name] in remaining) is (not converted), name
    # The property name belongs to the stay: converting never touches it.
    with engine.connect() as connection:
        names = dict(connection.execute(text("SELECT id, property_name FROM stays")).all())
    for name in CASES:
        assert names[ids["stays"][name]] == f"Property {name}", name
    # No stay with an exact position (three or more decimals) lost its location.
    for name in (
        "unlabeled_four_decimal_point_no_address",
        "three_decimals_on_the_area_point",
        "confirmed_hotel_with_four_decimals_and_address",
    ):
        assert rows[ids["stays"][name]][1] == ids["locations"][name], name
    # A placeholder nothing pointed at is not touched: only what the migration frees is removed.
    assert ids["locations"]["orphan"] in remaining
    with engine.connect() as connection:
        columns = {
            row.column_name: row.is_nullable
            for row in connection.execute(
                text("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'stays'")
            )
        }
        indexes = set(connection.execute(text("SELECT indexname FROM pg_indexes WHERE tablename = 'stays'")).scalars())
    assert (columns["area_id"], columns["location_id"]) == ("NO", "YES")
    assert "ix_stays_area_id" in indexes


def test_downgrade_gives_every_stay_a_location_again_and_a_round_trip_converts_again(database) -> None:
    engine, config = database
    command.upgrade(config, "019_audience_date_precision")
    ids = _seed(engine)
    command.upgrade(config, "head")
    before = _stay_rows(engine)
    area_only = {stay_id for stay_id, (_, location_id) in before.items() if location_id is None}
    # Two stays on one placeholder, the two other plain placeholders and the generic one on the area's point.
    assert len(area_only) == 5
    tainan, chiayi = ids["areas"]["Tainan"], ids["areas"]["Chiayi"]
    # Undecided stays in an area whose placeholder survives (the downgrade reuses it) and in one with none.
    reused, fresh = uuid4().hex, uuid4().hex
    with engine.begin() as connection:
        for stay_id, area_id in ((reused, tainan), (fresh, chiayi)):
            connection.execute(
                text(
                    "INSERT INTO stays (id, trip_id, area_id, location_id, check_in_date, check_out_date, status, "
                    "visibility, share_date_precision) VALUES (:id, :trip, :area, NULL, '2054-05-01', '2054-05-02', "
                    "'planned', 'private', NULL)"
                ),
                {"id": stay_id, "trip": ids["trip"], "area": area_id},
            )
    locations_before = _location_ids(engine)

    command.downgrade(config, "019_audience_date_precision")
    after = _stay_rows(engine, with_area=False)
    assert set(after) == set(before) | {reused, fresh}
    assert all(location_id is not None for _, location_id in after.values())
    with engine.connect() as connection:
        assert "area_id" not in set(
            connection.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = 'stays'")
            ).scalars()
        )
        locations = {
            row.id: row
            for row in connection.execute(
                text(
                    "SELECT l.id, l.area_id, l.visibility::text AS visibility, l.locality, l.country_code, l.label, "
                    "l.display_name, l.latitude, l.notes, l.share_address FROM locations l"
                )
            )
        }
    new = [row for location_id, row in locations.items() if location_id not in locations_before]
    # Stays that kept a location keep it.
    for stay_id, (_, location_id) in before.items():
        if location_id is not None:
            assert after[stay_id][1] == location_id
    # Area-only stays share one generic private location per area: an existing one is reused, else one is made.
    assert after[reused][1] == ids["locations"]["orphan"]
    taipei_location = {after[stay_id][1] for stay_id in area_only}
    assert len(taipei_location) == 1
    assert locations[taipei_location.pop()].area_id == ids["areas"]["Taipei"]
    (generic,) = new  # only Chiayi needed a new one
    assert generic.id == after[fresh][1]
    assert (generic.area_id, generic.visibility, generic.locality, generic.country_code) == (
        chiayi,
        "private",
        "Chiayi City",
        "TW",
    )
    assert (generic.label, generic.display_name, generic.latitude, generic.notes, generic.share_address) == (
        None,
        None,
        None,
        None,
        False,
    )
    # Every stay's location is in the area it read from before.
    assert {stay_id: locations[after[stay_id][1]].area_id for stay_id in before} == {
        stay_id: area_id for stay_id, (area_id, _) in before.items()
    }

    command.upgrade(config, "head")
    again = _stay_rows(engine)
    undecided = {stay_id for stay_id, (_, location_id) in again.items() if location_id is None}
    # The stays in areas with no other placeholder user become area-only again; the Taipei ones were given an
    # existing Taipei placeholder that a visit, route or update also uses, which is kept by the rule.
    assert {reused, fresh} <= undecided <= area_only | {reused, fresh}
    assert {stay_id: area_id for stay_id, (area_id, _) in again.items()} == {
        **{stay_id: area_id for stay_id, (area_id, _) in before.items()},
        reused: tainan,
        fresh: chiayi,
    }
    command.downgrade(config, "base")


def test_downgrade_refuses_a_stay_that_disagrees_with_its_location(database) -> None:
    engine, config = database
    command.upgrade(config, "019_audience_date_precision")
    ids = _seed(engine)
    command.upgrade(config, "head")
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE stays SET area_id = :area WHERE id = :id"),
            {"area": ids["areas"]["Tainan"], "id": ids["stays"]["real_hotel"]},
        )
    with pytest.raises(RuntimeError, match="different area than their location"):
        command.downgrade(config, "019_audience_date_precision")
