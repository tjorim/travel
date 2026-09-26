"""Areas, locations, routes and visits; every stay has a location; no GPS tracks.

The `places` table is split into `areas` (formerly `broad` places) and `locations`
(formerly `exact` ones), so every reference points at the right kind by construction.
Every stay has a location and takes its area from it. Transport legs and the
hand-drawn map routes become one record, a *route* between two areas, with the
exact locations, schedule, booking details and a drawn line all optional. The
application no longer stores recorded GPS tracks; the stored bytes of existing
tracks are handed to the purge job instead of being left behind. Route stages and
day-plan entries become one record, the *visit*: an area, or a location in one,
with optional days, times, a kind and a text for visitors.

Revision ID: 001_areas_locations_routes
Revises: 000_baseline
Create Date: 2026-09-25
"""

import json

import sqlalchemy as sa

from alembic import op

revision = "001_areas_locations_routes"
down_revision = "000_baseline"
branch_labels = None
depends_on = None

# (table, old column, new column, old constraint, new constraint)
COLUMN_RENAMES = (
    ("route_stages", "broad_place_id", "area_id", "route_stages_broad_place_id_fkey", "route_stages_area_id_fkey"),
    ("stays", "exact_place_id", "location_id", "stays_exact_place_id_fkey", "stays_location_id_fkey"),
    ("travel_updates", "broad_place_id", "area_id", "moment_excerpts_broad_place_id_fkey", "travel_updates_area_id_fkey"),
    ("travel_updates", "exact_place_id", "location_id", "fk_travel_updates_exact_place_id", "fk_travel_updates_location_id"),
)

# Share-scope item kinds that all become "route".
OLD_ROUTE_KINDS = {"transport_leg", "broad_route", "map_route"}


def _ensure_unassigned_area(trips_sql: str) -> None:
    """A private "Unassigned" area for each trip selected by ``trips_sql``, unless it has one."""
    op.execute(
        f"""
        INSERT INTO public.places (id, trip_id, kind, visibility, share_address, label)
        SELECT md5(random()::text || t.trip_id), t.trip_id, 'area', 'private', false, 'Unassigned'
        FROM ({trips_sql}) AS t
        WHERE NOT EXISTS (
            SELECT 1 FROM public.places u WHERE u.trip_id = t.trip_id AND u.kind = 'area' AND u.label = 'Unassigned'
        )
        """
    )


def _unassigned(alias: str) -> str:
    return (
        f"(SELECT u.id FROM public.places u WHERE u.trip_id = {alias}.trip_id AND u.kind = 'area' "
        "AND u.label = 'Unassigned' LIMIT 1)"
    )


def _give_every_stay_a_location() -> None:
    """A stay planned only for an area gets a location in that area, named after it.

    A stay with neither gets one in a private "Unassigned" area for its trip, which
    the owner can rename. Then the stay's own area goes: it comes from its location."""
    _ensure_unassigned_area("SELECT DISTINCT trip_id FROM public.stays WHERE location_id IS NULL AND broad_place_id IS NULL")
    op.execute(
        f"""
        CREATE TEMPORARY TABLE _stay_locations ON COMMIT DROP AS
        SELECT s.id AS stay_id, md5(random()::text || s.id) AS place_id, s.trip_id,
               COALESCE(s.broad_place_id, {_unassigned("s")}) AS area_id
        FROM public.stays s WHERE s.location_id IS NULL
        """
    )
    op.execute(
        """
        INSERT INTO public.places (id, trip_id, kind, visibility, share_address, area_id, locality, country_code)
        SELECT m.place_id, m.trip_id, 'location', 'private', false, m.area_id,
               NULLIF(a.label, 'Unassigned'), a.country_code
        FROM _stay_locations m JOIN public.places a ON a.id = m.area_id
        """
    )
    op.execute(
        "UPDATE public.stays SET location_id = m.place_id FROM _stay_locations m WHERE stays.id = m.stay_id"
    )
    op.execute("ALTER TABLE public.stays DROP COLUMN broad_place_id")
    op.execute("ALTER TABLE public.stays ALTER COLUMN location_id SET NOT NULL")


def _merge_legs_and_drawn_routes() -> None:
    """Transport legs become routes; drawn map routes join them, between the trip's "Unassigned" area."""
    op.execute("ALTER TABLE public.transport_legs RENAME TO routes")
    op.execute("ALTER TABLE public.routes RENAME COLUMN kind TO mode")
    op.execute("ALTER TABLE public.routes RENAME CONSTRAINT transport_legs_pkey TO routes_pkey")
    op.execute("ALTER TABLE public.routes RENAME CONSTRAINT transport_legs_trip_id_fkey TO routes_trip_id_fkey")
    op.execute("ALTER INDEX public.ix_transport_legs_trip_id RENAME TO ix_routes_trip_id")
    for end in ("departure", "arrival"):
        op.execute(f"ALTER TABLE public.routes RENAME COLUMN {end}_place_id TO {end}_location_id")
        op.execute(
            f"ALTER TABLE public.routes RENAME CONSTRAINT transport_legs_{end}_place_id_fkey "
            f"TO routes_{end}_location_id_fkey"
        )
        op.execute(f"ALTER TABLE public.routes ALTER COLUMN {end}_location_id DROP NOT NULL")
        op.execute(f"ALTER TABLE public.routes ADD COLUMN {end}_area_id character varying(32)")
        op.execute(
            f"UPDATE public.routes SET {end}_area_id = p.area_id FROM public.places p "
            f"WHERE p.id = routes.{end}_location_id"
        )
    op.execute("ALTER TABLE public.routes ADD COLUMN label character varying(160)")
    op.execute("ALTER TABLE public.routes ADD COLUMN geometry json")

    op.execute("ALTER TABLE public.routes ALTER COLUMN departs_at DROP NOT NULL")
    op.execute("ALTER TABLE public.routes ALTER COLUMN arrives_at DROP NOT NULL")
    _ensure_unassigned_area("SELECT DISTINCT trip_id FROM public.broad_routes")
    op.execute(
        f"""
        INSERT INTO public.routes (id, trip_id, mode, status, label, geometry, visibility,
                                   departure_area_id, arrival_area_id, created_at, updated_at)
        SELECT b.id, b.trip_id, 'other', 'planned', b.label, b.geometry, b.visibility,
               {_unassigned("b")}, {_unassigned("b")}, b.created_at, b.updated_at
        FROM public.broad_routes b
        """
    )
    op.execute("DROP TABLE public.broad_routes")

    for end in ("departure", "arrival"):
        op.execute(f"ALTER TABLE public.routes ALTER COLUMN {end}_area_id SET NOT NULL")
        op.execute(
            f"ALTER TABLE public.routes ADD CONSTRAINT routes_{end}_area_id_fkey "
            f"FOREIGN KEY ({end}_area_id) REFERENCES public.places(id)"
        )
    op.execute("ALTER TABLE public.routes DROP CONSTRAINT ck_transport_leg_arrival_after_departure")
    op.execute("ALTER TABLE public.routes ADD CONSTRAINT ck_route_arrival_after_departure CHECK (arrives_at > departs_at)")
    op.execute(
        "ALTER TABLE public.routes ADD CONSTRAINT ck_route_times_paired CHECK ((departs_at IS NULL) = (arrives_at IS NULL))"
    )

    op.execute("ALTER TABLE public.transport_leg_document_assets RENAME TO route_document_assets")
    op.execute("ALTER TABLE public.route_document_assets RENAME COLUMN transport_leg_id TO route_id")
    for old, new in (
        ("transport_leg_document_assets_pkey", "route_document_assets_pkey"),
        ("transport_leg_document_assets_document_asset_id_fkey", "route_document_assets_document_asset_id_fkey"),
        ("transport_leg_document_assets_transport_leg_id_fkey", "route_document_assets_route_id_fkey"),
    ):
        op.execute(f"ALTER TABLE public.route_document_assets RENAME CONSTRAINT {old} TO {new}")
    op.execute(
        "ALTER INDEX public.ix_transport_leg_document_assets_document_asset_id "
        "RENAME TO ix_route_document_assets_document_asset_id"
    )


# Every reference that used to point at `places`: (table, constraint, column, new table).
PLACE_REFERENCES = (
    ("route_stages", "route_stages_area_id_fkey", "area_id", "areas"),
    ("travel_updates", "travel_updates_area_id_fkey", "area_id", "areas"),
    ("travel_updates", "fk_travel_updates_location_id", "location_id", "locations"),
    ("stays", "stays_location_id_fkey", "location_id", "locations"),
    ("routes", "routes_departure_area_id_fkey", "departure_area_id", "areas"),
    ("routes", "routes_arrival_area_id_fkey", "arrival_area_id", "areas"),
    ("routes", "routes_departure_location_id_fkey", "departure_location_id", "locations"),
    ("routes", "routes_arrival_location_id_fkey", "arrival_location_id", "locations"),
)

# The columns a location keeps from the old `places` row.
LOCATION_COLUMNS = (
    "id, trip_id, area_id, visibility, label, share_address, osm_element_type, osm_element_id, display_name, "
    "address_line1, address_line2, locality, admin_area, postal_code, country_code, latitude, longitude, "
    "viewport_north, viewport_south, viewport_east, viewport_west, navigation_provider, "
    "navigation_provider_place_id, notes, created_at, updated_at"
)


def _repoint(table: str, constraint: str, column: str, target: str) -> None:
    op.execute(f"ALTER TABLE public.{table} DROP CONSTRAINT {constraint}")
    op.execute(
        f"ALTER TABLE public.{table} ADD CONSTRAINT {constraint} FOREIGN KEY ({column}) REFERENCES public.{target}(id)"
    )


def _split_places() -> None:
    """Areas and locations get a table each; every reference is re-pointed at the right one."""
    op.execute(
        """
CREATE TABLE public.areas (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    visibility public.travel_visibility NOT NULL,
    label character varying(120) NOT NULL,
    region character varying(120),
    country_code character varying(2),
    latitude double precision,
    longitude double precision,
    timezone character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT areas_pkey PRIMARY KEY (id),
    CONSTRAINT areas_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE
)
"""
    )
    op.execute("CREATE INDEX ix_areas_trip_id ON public.areas USING btree (trip_id)")
    op.execute(
        """
INSERT INTO public.areas (id, trip_id, visibility, label, region, country_code, latitude, longitude, timezone, created_at, updated_at)
SELECT id, trip_id, visibility, COALESCE(label, 'Area'), region, country_code, latitude, longitude, timezone, created_at, updated_at
FROM public.places WHERE kind = 'area'
"""
    )
    op.execute(
        """
CREATE TABLE public.locations (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    area_id character varying(32) NOT NULL,
    visibility public.travel_visibility NOT NULL,
    label character varying(120),
    share_address boolean NOT NULL,
    osm_element_type character varying(12),
    osm_element_id character varying(32),
    display_name character varying(500),
    address_line1 character varying(160),
    address_line2 character varying(160),
    locality character varying(120),
    admin_area character varying(120),
    postal_code character varying(20),
    country_code character varying(2),
    latitude double precision,
    longitude double precision,
    viewport_north double precision,
    viewport_south double precision,
    viewport_east double precision,
    viewport_west double precision,
    navigation_provider character varying(40),
    navigation_provider_place_id character varying(255),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT locations_pkey PRIMARY KEY (id),
    CONSTRAINT locations_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE,
    CONSTRAINT locations_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id),
    CONSTRAINT ck_locations_osm_reference_pair CHECK ((osm_element_type IS NULL) = (osm_element_id IS NULL)),
    CONSTRAINT ck_locations_osm_element_type CHECK (osm_element_type IS NULL OR osm_element_type IN ('node', 'way', 'relation'))
)
"""
    )
    op.execute("CREATE INDEX ix_locations_trip_id ON public.locations USING btree (trip_id)")
    op.execute("CREATE INDEX ix_locations_area_id ON public.locations USING btree (area_id)")
    op.execute("CREATE INDEX ix_locations_osm_element ON public.locations USING btree (osm_element_type, osm_element_id)")
    op.execute(
        f"INSERT INTO public.locations ({LOCATION_COLUMNS}) SELECT {LOCATION_COLUMNS} FROM public.places WHERE kind = 'location'"
    )

    for reference in PLACE_REFERENCES:
        _repoint(*reference)
    op.execute("DROP TABLE public.places")
    op.execute("DROP TYPE public.travel_place_kind")

    # A day-plan link to a "place" points at an area or a location, whichever it is.
    op.execute("ALTER TABLE public.itinerary_entries ALTER COLUMN linked_kind TYPE text USING linked_kind::text")
    op.execute("UPDATE public.itinerary_entries SET linked_kind = 'route' WHERE linked_kind = 'transport_leg'")
    op.execute(
        "UPDATE public.itinerary_entries SET linked_kind = 'area' "
        "WHERE linked_kind = 'place' AND linked_id IN (SELECT id FROM public.areas)"
    )
    op.execute("UPDATE public.itinerary_entries SET linked_kind = 'location' WHERE linked_kind = 'place'")
    op.execute("DROP TYPE public.travel_itinerary_link_kind")
    op.execute(
        "CREATE TYPE public.travel_itinerary_link_kind AS ENUM "
        "('stay', 'route', 'route_stage', 'area', 'location', 'document', 'travel_update')"
    )
    op.execute(
        "ALTER TABLE public.itinerary_entries ALTER COLUMN linked_kind TYPE public.travel_itinerary_link_kind "
        "USING linked_kind::public.travel_itinerary_link_kind"
    )


def _join_places() -> None:
    """The reverse: one `places` table again, holding areas as `area` rows and locations as `location` rows."""
    op.execute("CREATE TYPE public.travel_place_kind AS ENUM ('area', 'location')")
    op.execute(
        """
CREATE TABLE public.places (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    kind public.travel_place_kind NOT NULL,
    label character varying(120),
    region character varying(120),
    country_code character varying(2),
    latitude double precision,
    longitude double precision,
    address_line1 character varying(160),
    address_line2 character varying(160),
    locality character varying(120),
    admin_area character varying(120),
    postal_code character varying(20),
    viewport_north double precision,
    viewport_south double precision,
    viewport_east double precision,
    viewport_west double precision,
    navigation_provider character varying(40),
    navigation_provider_place_id character varying(255),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    osm_element_type character varying(12),
    osm_element_id character varying(32),
    display_name character varying(500),
    timezone character varying(64),
    visibility public.travel_visibility NOT NULL,
    area_id character varying(32),
    share_address boolean NOT NULL,
    CONSTRAINT places_pkey PRIMARY KEY (id),
    CONSTRAINT places_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE,
    CONSTRAINT fk_places_area_id FOREIGN KEY (area_id) REFERENCES public.places(id),
    CONSTRAINT ck_places_osm_element_type CHECK (osm_element_type IS NULL OR osm_element_type IN ('node', 'way', 'relation')),
    CONSTRAINT ck_places_osm_reference_pair CHECK ((osm_element_type IS NULL) = (osm_element_id IS NULL)),
    CONSTRAINT ck_places_location_has_area CHECK ((kind = 'area' AND area_id IS NULL) OR (kind = 'location' AND area_id IS NOT NULL))
)
"""
    )
    op.execute("CREATE INDEX ix_places_trip_id ON public.places USING btree (trip_id)")
    op.execute("CREATE INDEX ix_places_osm_element ON public.places USING btree (osm_element_type, osm_element_id)")
    op.execute(
        "INSERT INTO public.places (id, trip_id, kind, visibility, label, region, country_code, latitude, longitude, "
        "timezone, share_address, created_at, updated_at) "
        "SELECT id, trip_id, 'area', visibility, label, region, country_code, latitude, longitude, timezone, false, "
        "created_at, updated_at FROM public.areas"
    )
    op.execute(
        f"INSERT INTO public.places (kind, {LOCATION_COLUMNS}) SELECT 'location', {LOCATION_COLUMNS} FROM public.locations"
    )
    for table, constraint, column, _target in PLACE_REFERENCES:
        _repoint(table, constraint, column, "places")
    op.execute("DROP TABLE public.locations")
    op.execute("DROP TABLE public.areas")

    op.execute("ALTER TABLE public.itinerary_entries ALTER COLUMN linked_kind TYPE text USING linked_kind::text")
    op.execute("UPDATE public.itinerary_entries SET linked_kind = 'place' WHERE linked_kind IN ('area', 'location')")
    op.execute("DROP TYPE public.travel_itinerary_link_kind")
    op.execute(
        "CREATE TYPE public.travel_itinerary_link_kind AS ENUM "
        "('stay', 'route', 'route_stage', 'place', 'document', 'travel_update')"
    )
    op.execute(
        "ALTER TABLE public.itinerary_entries ALTER COLUMN linked_kind TYPE public.travel_itinerary_link_kind "
        "USING linked_kind::public.travel_itinerary_link_kind"
    )


def _rewrite_scope_kinds(rewrite) -> None:
    """Apply ``rewrite`` to each stored share-scope item list, so listed records stay listed."""
    connection = op.get_bind()
    for table, key in (("public_surfaces", "trip_id"), ("share_links", "id")):
        for identifier, scope in connection.execute(sa.text(f"SELECT {key}, scope FROM public.{table}")).all():
            scope = scope if isinstance(scope, dict) else json.loads(scope)
            items = rewrite(scope.get("items", []))
            if items != scope.get("items", []):
                connection.execute(
                    sa.text(f"UPDATE public.{table} SET scope = CAST(:scope AS json) WHERE {key} = :identifier"),
                    {"scope": json.dumps({**scope, "items": items}), "identifier": identifier},
                )


def _ensure_unassigned_area_for(trips_sql: str) -> None:
    """A private "Unassigned" area for each trip selected by ``trips_sql``, unless it has one."""
    op.execute(
        f"""
        INSERT INTO public.areas (id, trip_id, visibility, label)
        SELECT md5(random()::text || t.trip_id), t.trip_id, 'private', 'Unassigned'
        FROM ({trips_sql}) AS t
        WHERE NOT EXISTS (
            SELECT 1 FROM public.areas u WHERE u.trip_id = t.trip_id AND u.label = 'Unassigned'
        )
        """
    )


def _merge_stages_and_steps() -> None:
    """Route stages and day-plan entries become visits.

    A stage keeps its area, label (as the title), text for visitors and visibility. An entry lands in the
    area of what it linked to (a stay's location, a route's arrival, a stage, an area, a location or a
    reisupdate's area), else in the trip's "Unassigned" area; it keeps its days, notes and free/work kind,
    and stays private. The "travel" kind and the tentative flag have no successor: a travel day is a route."""
    op.execute("CREATE TYPE public.travel_visit_kind AS ENUM ('free', 'work')")
    op.execute(
        """
CREATE TABLE public.visits (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    "position" integer NOT NULL,
    area_id character varying(32) NOT NULL,
    location_id character varying(32),
    title character varying(160),
    kind public.travel_visit_kind,
    starts_on date,
    ends_on date,
    start_time time without time zone,
    end_time time without time zone,
    notes text,
    summary text,
    visibility public.travel_visibility NOT NULL,
    share_time boolean NOT NULL,
    share_date_precision public.travel_date_precision NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT visits_pkey PRIMARY KEY (id),
    CONSTRAINT uq_visit_position UNIQUE (trip_id, "position"),
    CONSTRAINT visits_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE,
    CONSTRAINT visits_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id),
    CONSTRAINT visits_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id),
    CONSTRAINT ck_visit_last_day CHECK (ends_on IS NULL OR (starts_on IS NOT NULL AND ends_on >= starts_on)),
    CONSTRAINT ck_visit_time_needs_a_day CHECK (start_time IS NULL OR starts_on IS NOT NULL),
    CONSTRAINT ck_visit_end_time_needs_a_start CHECK (end_time IS NULL OR start_time IS NOT NULL)
)
"""
    )
    op.execute("CREATE INDEX ix_visits_trip_id ON public.visits USING btree (trip_id)")
    op.execute("CREATE INDEX ix_visits_area_id ON public.visits USING btree (area_id)")

    _ensure_unassigned_area_for("SELECT DISTINCT trip_id FROM public.itinerary_entries")
    unassigned = "(SELECT u.id FROM public.areas u WHERE u.trip_id = e.trip_id AND u.label = 'Unassigned' LIMIT 1)"
    op.execute(
        f"""
        INSERT INTO public.visits (id, trip_id, "position", area_id, location_id, title, kind, starts_on, ends_on,
                                   notes, summary, visibility, share_time, share_date_precision)
        SELECT id, trip_id, ROW_NUMBER() OVER (PARTITION BY trip_id ORDER BY source, "position") - 1,
               area_id, location_id, title, kind::public.travel_visit_kind, starts_on, ends_on, notes, summary,
               visibility::public.travel_visibility, false, 'month'
        FROM (
            SELECT s.id, s.trip_id, 0 AS source, s.position, s.area_id, NULL AS location_id, s.label AS title,
                   NULL AS kind, NULL::date AS starts_on, NULL::date AS ends_on, NULL AS notes, s.summary,
                   s.visibility::text AS visibility
            FROM public.route_stages s
            UNION ALL
            SELECT e.id, e.trip_id, 1, e.position,
                   COALESCE(
                       CASE e.linked_kind::text
                           WHEN 'area' THEN (SELECT a.id FROM public.areas a WHERE a.id = e.linked_id)
                           WHEN 'location' THEN (SELECT l.area_id FROM public.locations l WHERE l.id = e.linked_id)
                           WHEN 'stay' THEN (SELECT l.area_id FROM public.stays st JOIN public.locations l
                                             ON l.id = st.location_id WHERE st.id = e.linked_id)
                           WHEN 'route_stage' THEN (SELECT rs.area_id FROM public.route_stages rs WHERE rs.id = e.linked_id)
                           WHEN 'route' THEN (SELECT r.arrival_area_id FROM public.routes r WHERE r.id = e.linked_id)
                           WHEN 'travel_update' THEN (SELECT t.area_id FROM public.travel_updates t WHERE t.id = e.linked_id)
                       END,
                       {unassigned}
                   ),
                   CASE WHEN e.linked_kind::text = 'location'
                        THEN (SELECT l.id FROM public.locations l WHERE l.id = e.linked_id) END,
                   e.title, CASE WHEN e.kind::text = 'travel' THEN NULL ELSE e.kind::text END,
                   e.day_date, CASE WHEN e.day_date IS NOT NULL AND e.end_date >= e.day_date THEN e.end_date END,
                   e.notes, NULL, 'private'
            FROM public.itinerary_entries e
        ) AS merged(id, trip_id, source, "position", area_id, location_id, title, kind, starts_on, ends_on, notes, summary, visibility)
        """
    )
    op.execute("DROP TABLE public.itinerary_entries")
    op.execute("DROP TABLE public.route_stages")
    op.execute("DROP TYPE public.travel_itinerary_link_kind")
    op.execute("DROP TYPE public.travel_itinerary_entry_kind")


def _split_visits_back() -> None:
    """The reverse: a visit without days becomes a route stage, one with days a day-plan entry."""
    op.execute("CREATE TYPE public.travel_itinerary_entry_kind AS ENUM ('travel', 'free', 'work')")
    op.execute(
        "CREATE TYPE public.travel_itinerary_link_kind AS ENUM "
        "('stay', 'route', 'route_stage', 'area', 'location', 'document', 'travel_update')"
    )
    op.execute(
        """
CREATE TABLE public.route_stages (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    area_id character varying(32) NOT NULL,
    "position" integer NOT NULL,
    label character varying(120),
    summary text,
    visibility public.travel_visibility NOT NULL,
    CONSTRAINT route_stages_pkey PRIMARY KEY (id),
    CONSTRAINT uq_route_stage_position UNIQUE (trip_id, "position"),
    CONSTRAINT route_stages_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE,
    CONSTRAINT route_stages_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id)
)
"""
    )
    op.execute("CREATE INDEX ix_route_stages_trip_id ON public.route_stages USING btree (trip_id)")
    op.execute(
        """
CREATE TABLE public.itinerary_entries (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    "position" integer NOT NULL,
    day_date date,
    title character varying(160) NOT NULL,
    notes text,
    linked_kind public.travel_itinerary_link_kind,
    linked_id character varying(32),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    end_date date,
    kind public.travel_itinerary_entry_kind,
    tentative boolean DEFAULT false NOT NULL,
    CONSTRAINT itinerary_entries_pkey PRIMARY KEY (id),
    CONSTRAINT uq_itinerary_entry_position UNIQUE (trip_id, "position"),
    CONSTRAINT itinerary_entries_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE
)
"""
    )
    op.execute("CREATE INDEX ix_itinerary_entries_trip_id ON public.itinerary_entries USING btree (trip_id)")
    op.execute(
        """
        INSERT INTO public.route_stages (id, trip_id, area_id, "position", label, summary, visibility)
        SELECT id, trip_id, area_id, ROW_NUMBER() OVER (PARTITION BY trip_id ORDER BY "position") - 1,
               LEFT(title, 120), summary, visibility
        FROM public.visits WHERE starts_on IS NULL
        """
    )
    op.execute(
        """
        INSERT INTO public.itinerary_entries (id, trip_id, "position", day_date, end_date, title, notes, kind,
                                              linked_kind, linked_id)
        SELECT v.id, v.trip_id, ROW_NUMBER() OVER (PARTITION BY v.trip_id ORDER BY v."position") - 1,
               v.starts_on, v.ends_on, COALESCE(v.title, l.display_name, l.label, a.label), v.notes,
               v.kind::text::public.travel_itinerary_entry_kind,
               CASE WHEN v.location_id IS NOT NULL THEN 'location' ELSE 'area' END::public.travel_itinerary_link_kind,
               COALESCE(v.location_id, v.area_id)
        FROM public.visits v
        JOIN public.areas a ON a.id = v.area_id
        LEFT JOIN public.locations l ON l.id = v.location_id
        WHERE v.starts_on IS NOT NULL
        """
    )
    op.execute("DROP TABLE public.visits")
    op.execute("DROP TYPE public.travel_visit_kind")


# The constraints that were still named after the old moment excerpts.
MOMENT_NAMES = (
    ("travel_updates", "moment_excerpts_pkey", "travel_updates_pkey"),
    ("travel_updates", "moment_excerpts_trip_id_fkey", "travel_updates_trip_id_fkey"),
    (
        "travel_update_media_assets",
        "moment_media_assets_media_asset_id_fkey",
        "travel_update_media_assets_media_asset_id_fkey",
    ),
)


def upgrade() -> None:
    op.execute("ALTER TYPE public.travel_place_kind RENAME VALUE 'exact' TO 'location'")
    op.execute("ALTER TYPE public.travel_place_kind RENAME VALUE 'broad' TO 'area'")
    op.execute("ALTER TYPE public.travel_transport_leg_kind ADD VALUE IF NOT EXISTS 'bike'")
    op.execute("ALTER TYPE public.travel_transport_leg_kind ADD VALUE IF NOT EXISTS 'walk'")
    op.execute("ALTER TYPE public.travel_transport_leg_kind RENAME TO travel_route_mode")
    op.execute("ALTER TYPE public.travel_transport_leg_status RENAME TO travel_route_status")
    op.execute("ALTER TABLE public.places RENAME CONSTRAINT ck_places_spot_has_area TO ck_places_location_has_area")

    for table, old, new, old_constraint, new_constraint in COLUMN_RENAMES:
        op.execute(f"ALTER TABLE public.{table} RENAME COLUMN {old} TO {new}")
        op.execute(f"ALTER TABLE public.{table} RENAME CONSTRAINT {old_constraint} TO {new_constraint}")

    _give_every_stay_a_location()
    _merge_legs_and_drawn_routes()
    _split_places()
    _merge_stages_and_steps()
    for table, old, new in MOMENT_NAMES:
        op.execute(f"ALTER TABLE public.{table} RENAME CONSTRAINT {old} TO {new}")
    area_ids = {row[0] for row in op.get_bind().execute(sa.text("SELECT id FROM public.areas"))}

    def to_routes(items: list[dict]) -> list[dict]:
        seen: set[tuple[str, str]] = set()
        result = []
        for item in items:
            kind = item.get("kind")
            if kind in OLD_ROUTE_KINDS:
                kind = "route"
            elif kind == "route_stage":
                kind = "visit"
            elif kind == "place":
                kind = "area" if item.get("id") in area_ids else "location"
            if (kind, item.get("id")) not in seen:
                seen.add((kind, item.get("id")))
                result.append({**item, "kind": kind})
        return result

    _rewrite_scope_kinds(to_routes)

    # The raw recordings' bytes go to the purge job; the table and its enum go away.
    op.execute(
        "UPDATE public.stored_objects SET state = 'purge_pending' "
        "WHERE id IN (SELECT source_object_id FROM public.recorded_tracks)"
    )
    op.execute("DROP TABLE public.recorded_tracks")
    op.execute("DROP TYPE public.travel_track_kind")


# A route that can go back to being a transport leg: it has both locations and a schedule.
_LEG_SQL = "departure_location_id IS NOT NULL AND arrival_location_id IS NOT NULL AND departs_at IS NOT NULL"


def _split_routes_back() -> None:
    """Routes with locations and a schedule become legs again, the rest with a line become map routes.

    A route that is neither (an area-to-area route without a line) has no earlier form and is dropped."""
    op.execute(
        """
CREATE TABLE public.broad_routes (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    label character varying(160) NOT NULL,
    geometry json NOT NULL,
    date_precision public.travel_date_precision NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    visibility public.travel_visibility NOT NULL,
    CONSTRAINT broad_routes_pkey PRIMARY KEY (id),
    CONSTRAINT broad_routes_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE
)
"""
    )
    op.execute("CREATE INDEX ix_broad_routes_trip_id ON public.broad_routes USING btree (trip_id)")
    op.execute(
        f"""
        INSERT INTO public.broad_routes (id, trip_id, label, geometry, date_precision, created_at, updated_at, visibility)
        SELECT id, trip_id, COALESCE(label, 'Route'), geometry, 'day', created_at, updated_at, visibility
        FROM public.routes WHERE geometry IS NOT NULL AND NOT ({_LEG_SQL})
        """
    )
    op.execute(f"DELETE FROM public.routes WHERE NOT ({_LEG_SQL})")

    op.execute("ALTER TABLE public.routes DROP CONSTRAINT ck_route_times_paired")
    op.execute("ALTER TABLE public.routes DROP CONSTRAINT ck_route_arrival_after_departure")
    op.execute("ALTER TABLE public.routes ADD CONSTRAINT ck_transport_leg_arrival_after_departure CHECK (arrives_at > departs_at)")
    op.execute("ALTER TABLE public.routes ALTER COLUMN departs_at SET NOT NULL")
    op.execute("ALTER TABLE public.routes ALTER COLUMN arrives_at SET NOT NULL")
    for end in ("departure", "arrival"):
        op.execute(f"ALTER TABLE public.routes DROP COLUMN {end}_area_id")
        op.execute(f"ALTER TABLE public.routes ALTER COLUMN {end}_location_id SET NOT NULL")
        op.execute(
            f"ALTER TABLE public.routes RENAME CONSTRAINT routes_{end}_location_id_fkey "
            f"TO transport_legs_{end}_place_id_fkey"
        )
        op.execute(f"ALTER TABLE public.routes RENAME COLUMN {end}_location_id TO {end}_place_id")
    op.execute("ALTER TABLE public.routes DROP COLUMN label")
    op.execute("ALTER TABLE public.routes DROP COLUMN geometry")
    op.execute("ALTER INDEX public.ix_routes_trip_id RENAME TO ix_transport_legs_trip_id")
    op.execute("ALTER TABLE public.routes RENAME CONSTRAINT routes_trip_id_fkey TO transport_legs_trip_id_fkey")
    op.execute("ALTER TABLE public.routes RENAME CONSTRAINT routes_pkey TO transport_legs_pkey")
    op.execute("ALTER TABLE public.routes RENAME COLUMN mode TO kind")
    op.execute("ALTER TABLE public.routes RENAME TO transport_legs")

    op.execute(
        "ALTER INDEX public.ix_route_document_assets_document_asset_id "
        "RENAME TO ix_transport_leg_document_assets_document_asset_id"
    )
    for new, old in (
        ("route_document_assets_pkey", "transport_leg_document_assets_pkey"),
        ("route_document_assets_document_asset_id_fkey", "transport_leg_document_assets_document_asset_id_fkey"),
        ("route_document_assets_route_id_fkey", "transport_leg_document_assets_transport_leg_id_fkey"),
    ):
        op.execute(f"ALTER TABLE public.route_document_assets RENAME CONSTRAINT {new} TO {old}")
    op.execute("ALTER TABLE public.route_document_assets RENAME COLUMN route_id TO transport_leg_id")
    op.execute("ALTER TABLE public.route_document_assets RENAME TO transport_leg_document_assets")


def downgrade() -> None:
    op.execute("CREATE TYPE public.travel_track_kind AS ENUM ('gpx', 'point_array')")
    op.execute(
        """\
CREATE TABLE public.recorded_tracks (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    source_object_id character varying(32) NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone NOT NULL,
    kind public.travel_track_kind NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_track_end_after_start CHECK ((ended_at > started_at)),
    CONSTRAINT recorded_tracks_pkey PRIMARY KEY (id),
    CONSTRAINT recorded_tracks_source_object_id_key UNIQUE (source_object_id),
    CONSTRAINT recorded_tracks_source_object_id_fkey FOREIGN KEY (source_object_id) REFERENCES public.stored_objects(id),
    CONSTRAINT recorded_tracks_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE
)
"""
    )
    op.execute("CREATE INDEX ix_recorded_tracks_trip_id ON public.recorded_tracks USING btree (trip_id)")

    for table, old, new in reversed(MOMENT_NAMES):
        op.execute(f"ALTER TABLE public.{table} RENAME CONSTRAINT {new} TO {old}")
    connection = op.get_bind()
    stages = {row[0] for row in connection.execute(sa.text("SELECT id FROM public.visits WHERE starts_on IS NULL"))}
    _split_visits_back()
    _join_places()

    legs = {row[0] for row in connection.execute(sa.text(f"SELECT id FROM public.routes WHERE {_LEG_SQL}"))}
    drawn = {
        row[0]
        for row in connection.execute(
            sa.text(f"SELECT id FROM public.routes WHERE geometry IS NOT NULL AND NOT ({_LEG_SQL})")
        )
    }
    _split_routes_back()

    def to_old_kinds(items: list[dict]) -> list[dict]:
        result = []
        for item in items:
            if item.get("kind") in {"area", "location"}:
                result.append({**item, "kind": "place"})
            elif item.get("kind") == "visit":
                if item.get("id") in stages:
                    result.append({**item, "kind": "route_stage"})
            elif item.get("kind") != "route":
                result.append(item)
            elif item.get("id") in legs:
                result.append({**item, "kind": "transport_leg"})
            elif item.get("id") in drawn:
                result.append({**item, "kind": "broad_route"})
        return result

    _rewrite_scope_kinds(to_old_kinds)

    op.execute("ALTER TABLE public.stays ALTER COLUMN location_id DROP NOT NULL")
    op.execute("ALTER TABLE public.stays ADD COLUMN broad_place_id character varying(32)")
    op.execute(
        "ALTER TABLE public.stays ADD CONSTRAINT fk_stays_broad_place_id_places "
        "FOREIGN KEY (broad_place_id) REFERENCES public.places(id)"
    )

    for table, old, new, old_constraint, new_constraint in reversed(COLUMN_RENAMES):
        op.execute(f"ALTER TABLE public.{table} RENAME CONSTRAINT {new_constraint} TO {old_constraint}")
        op.execute(f"ALTER TABLE public.{table} RENAME COLUMN {new} TO {old}")

    # Bike and walk have no old equivalent; an enum value cannot be dropped, so the type is rebuilt.
    op.execute("UPDATE public.transport_legs SET kind = 'other' WHERE kind IN ('bike', 'walk')")
    op.execute("ALTER TYPE public.travel_route_mode RENAME TO travel_transport_leg_kind_new")
    op.execute(
        "CREATE TYPE public.travel_transport_leg_kind AS ENUM ('flight', 'train', 'bus', 'ferry', 'car', 'other')"
    )
    op.execute(
        "ALTER TABLE public.transport_legs ALTER COLUMN kind TYPE public.travel_transport_leg_kind "
        "USING kind::text::public.travel_transport_leg_kind"
    )
    op.execute("DROP TYPE public.travel_transport_leg_kind_new")
    op.execute("ALTER TYPE public.travel_route_status RENAME TO travel_transport_leg_status")
    op.execute("ALTER TYPE public.travel_itinerary_link_kind RENAME VALUE 'route' TO 'transport_leg'")

    op.execute("ALTER TABLE public.places RENAME CONSTRAINT ck_places_location_has_area TO ck_places_spot_has_area")
    op.execute("ALTER TYPE public.travel_place_kind RENAME VALUE 'area' TO 'broad'")
    op.execute("ALTER TYPE public.travel_place_kind RENAME VALUE 'location' TO 'exact'")
