"""Let a stay be undecided: filed under its area alone, with no placeholder location.

A stay gets an ``area_id`` of its own (backfilled from its location's area, which
is what every stay read until now) and ``location_id`` becomes optional, the same
shape as a visit or a route end.

Until now a stay whose accommodation was undecided pointed at one shared
"city-level" location per area (``routers.placement.area_location``). This
revision converts the stays that point at such a placeholder to area-only stays
and deletes the placeholder when that leaves it unused. What any audience
receives does not change: a stay is delivered as its area and its nights, and
its location only when that location is itself shared, which a placeholder never
is (it is recognised as private).

A location counts as a placeholder only when ALL of these hold; otherwise it is
kept, with its stays attached:

* it is ``private`` and its address is not shared;
* it has no public name, no address, postal code, admin area, display name,
  coordinates, viewport, OSM or navigation-provider reference and no notes
  (what ``area_location`` never sets);
* its ``locality`` is empty or equals its area's label, and its country is empty or
  equals its area's country (what ``area_location`` sets), so an owner's
  edit to either makes it theirs;
* only stays point at it: no visit, route end or reisupdate, and no share scope
  (public view, hidden link or collection member) mentions its id.

The downgrade never takes anything away from a visitor: every area-only stay
gets a location again (an existing placeholder of its area, else one new generic
private city-level location per area, exactly as the previous code made them)
before ``location_id`` is required again and ``area_id`` is dropped.
"""

from alembic import op

revision = "020_area_only_stay"
down_revision = "019_audience_date_precision"
branch_labels = None
depends_on = None

# The fields ``area_location`` never sets: a location with any of them is the owner's.
_UNSET_FIELDS = (
    "label",
    "osm_element_type",
    "osm_element_id",
    "osm_url",
    "display_name",
    "address_line1",
    "address_line2",
    "admin_area",
    "postal_code",
    "latitude",
    "longitude",
    "viewport_north",
    "viewport_south",
    "viewport_east",
    "viewport_west",
    "navigation_provider",
    "navigation_provider_place_id",
    "notes",
)
_NAMES_NOTHING = " AND ".join(f"l.{field} IS NULL" for field in _UNSET_FIELDS)

# A location's id may appear in a share scope as a chosen or excluded item.
_NOT_IN_A_SCOPE = " AND ".join(
    f"NOT EXISTS (SELECT 1 FROM public.{table} t WHERE t.trip_id = l.trip_id AND t.scope::text LIKE '%' || l.id || '%')"
    for table in ("public_surfaces", "share_links", "collection_members")
)

_PLACEHOLDER = f"""
    l.visibility = 'private' AND NOT l.share_address AND {_NAMES_NOTHING}
    AND (l.locality IS NULL OR lower(l.locality) = lower(a.label))
    AND (l.country_code IS NULL OR l.country_code = a.country_code)
"""

_USED_ELSEWHERE = """
    EXISTS (SELECT 1 FROM public.visits v WHERE v.location_id = l.id)
    OR EXISTS (SELECT 1 FROM public.routes r WHERE r.departure_location_id = l.id OR r.arrival_location_id = l.id)
    OR EXISTS (SELECT 1 FROM public.travel_updates u WHERE u.location_id = l.id)
"""


def upgrade() -> None:
    op.execute("ALTER TABLE public.stays ADD COLUMN area_id character varying(32)")
    op.execute("UPDATE public.stays SET area_id = l.area_id FROM public.locations l WHERE l.id = stays.location_id")
    op.execute("ALTER TABLE public.stays ALTER COLUMN location_id DROP NOT NULL")
    # Placeholders used by stays alone, decided before any stay changes.
    op.execute(
        f"""
CREATE TEMPORARY TABLE _placeholder_locations ON COMMIT DROP AS
SELECT l.id FROM public.locations l JOIN public.areas a ON a.id = l.area_id
WHERE {_PLACEHOLDER}
  AND EXISTS (SELECT 1 FROM public.stays s WHERE s.location_id = l.id)
  AND NOT ({_USED_ELSEWHERE})
  AND {_NOT_IN_A_SCOPE}
"""
    )
    op.execute(
        "UPDATE public.stays SET location_id = NULL WHERE location_id IN (SELECT id FROM _placeholder_locations)"
    )
    op.execute("DELETE FROM public.locations WHERE id IN (SELECT id FROM _placeholder_locations)")
    op.execute("ALTER TABLE public.stays ALTER COLUMN area_id SET NOT NULL")
    op.execute(
        "ALTER TABLE public.stays ADD CONSTRAINT stays_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id)"
    )
    op.execute("CREATE INDEX ix_stays_area_id ON public.stays USING btree (area_id)")
    op.execute("DROP TABLE _placeholder_locations")


def downgrade() -> None:
    mismatched = (
        op.get_bind()
        .exec_driver_sql(
            "SELECT count(*) FROM public.stays s JOIN public.locations l ON l.id = s.location_id WHERE l.area_id <> s.area_id"
        )
        .scalar_one()
    )
    if mismatched:
        raise RuntimeError(
            f"{mismatched} stay(s) are filed under a different area than their location; "
            "repair them (move the stay or its location) before downgrading, because the previous schema "
            "derives a stay's area from its location."
        )
    # One location per (trip, area) for the area-only stays: an existing placeholder, else a new generic one.
    op.execute(
        f"""
CREATE TEMPORARY TABLE _stay_area_locations ON COMMIT DROP AS
SELECT DISTINCT ON (s.area_id) s.area_id, l.id AS location_id
FROM public.stays s
JOIN public.areas a ON a.id = s.area_id
LEFT JOIN public.locations l ON l.area_id = s.area_id AND l.trip_id = s.trip_id AND {_PLACEHOLDER}
WHERE s.location_id IS NULL
ORDER BY s.area_id, l.created_at NULLS LAST, l.id
"""
    )
    op.execute(
        "UPDATE _stay_area_locations SET location_id = replace(gen_random_uuid()::text, '-', '') "
        "WHERE location_id IS NULL"
    )
    op.execute(
        """
INSERT INTO public.locations (id, trip_id, area_id, visibility, share_address, locality, country_code)
SELECT m.location_id, a.trip_id, a.id, 'private', false, a.label, a.country_code
FROM _stay_area_locations m JOIN public.areas a ON a.id = m.area_id
WHERE NOT EXISTS (SELECT 1 FROM public.locations l WHERE l.id = m.location_id)
"""
    )
    op.execute(
        "UPDATE public.stays SET location_id = m.location_id FROM _stay_area_locations m "
        "WHERE stays.location_id IS NULL AND stays.area_id = m.area_id"
    )
    op.execute("ALTER TABLE public.stays ALTER COLUMN location_id SET NOT NULL")
    op.execute("DROP INDEX public.ix_stays_area_id")
    op.execute("ALTER TABLE public.stays DROP CONSTRAINT stays_area_id_fkey")
    op.execute("ALTER TABLE public.stays DROP COLUMN area_id")
    op.execute("DROP TABLE _stay_area_locations")
