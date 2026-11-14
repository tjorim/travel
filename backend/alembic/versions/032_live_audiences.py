"""Bring the live-location tables in line with the rest (#363).

* The two JSON dictionaries ``live_sessions.audiences`` and ``live_sessions.delays``, keyed by an audience string,
  become rows of ``live_session_audiences``: one per session and audience, with its precision and delay. A link's
  row references ``share_links`` and goes with the link (``ON DELETE CASCADE``). A setting whose link was deleted,
  revoked or expired is not carried over: it was stale.
* ``live_sessions`` gains ``created_at`` and ``updated_at``, and ``current_id`` becomes a foreign key to
  ``live_points`` (cleared when the point is deleted).
* The constraints of ``live_points`` get names.
* Area and location coordinates get the range checks ``live_points`` already had.

The downgrade writes the dictionaries again from the rows.

Revision ID: 032_live_audiences
Revises: 031_audit_alignment
"""

import json
import uuid

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "032_live_audiences"
down_revision = "031_audit_alignment"
branch_labels = None
depends_on = None

KINDS = ("public", "link")
PRECISIONS = ("exact", "1km", "10km")
DELAYS = (0, 900, 1800, 3600, 7200, 86400)
# Links that can still deliver, or may be prepared to: a revoked or expired link has no live setting.
LINK_STATES = ("draft", "active")

# (old name, new name) of the live_points constraints, which PostgreSQL named by itself.
RENAMES = (
    ("live_points_session_id_observed_at_key", "uq_live_points_session_observed"),
    ("live_points_latitude_check", "ck_live_points_latitude"),
    ("live_points_longitude_check", "ck_live_points_longitude"),
)
COORDINATE_CHECKS = (
    ("areas", "ck_areas_latitude", "latitude >= -90 AND latitude <= 90"),
    ("areas", "ck_areas_longitude", "longitude >= -180 AND longitude <= 180"),
    ("locations", "ck_locations_latitude", "latitude >= -90 AND latitude <= 90"),
    ("locations", "ck_locations_longitude", "longitude >= -180 AND longitude <= 180"),
    (
        "locations",
        "ck_locations_viewport_latitudes",
        "viewport_north >= -90 AND viewport_north <= 90 AND viewport_south >= -90 AND viewport_south <= 90",
    ),
    (
        "locations",
        "ck_locations_viewport_longitudes",
        "viewport_east >= -180 AND viewport_east <= 180 AND viewport_west >= -180 AND viewport_west <= 180",
    ),
)


def _json(value) -> dict:
    """A JSON column as a dictionary (a driver may hand it back as text)."""
    value = json.loads(value) if isinstance(value, str) else value
    return value or {}


def upgrade() -> None:
    bind = op.get_bind()
    kind = postgresql.ENUM(*KINDS, name="travel_live_audience_kind", schema="public")
    precision = postgresql.ENUM(*PRECISIONS, name="travel_live_precision", schema="public")
    kind.create(bind)
    precision.create(bind)
    op.create_table(
        "live_session_audiences",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("session_id", sa.String(32), sa.ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "kind",
            postgresql.ENUM(name="travel_live_audience_kind", schema="public", create_type=False),
            nullable=False,
        ),
        sa.Column("share_link_id", sa.String(32), sa.ForeignKey("share_links.id", ondelete="CASCADE")),
        sa.Column(
            "precision",
            postgresql.ENUM(name="travel_live_precision", schema="public", create_type=False),
            nullable=False,
        ),
        sa.Column("delay_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("session_id", "share_link_id", name="uq_live_session_audiences_link"),
        sa.CheckConstraint("(kind = 'link') = (share_link_id IS NOT NULL)", name="ck_live_session_audiences_link_pair"),
        sa.CheckConstraint(
            "delay_seconds IN (" + ", ".join(str(delay) for delay in DELAYS) + ")",
            name="ck_live_session_audiences_delay",
        ),
    )
    op.create_index("ix_live_session_audiences_share_link_id", "live_session_audiences", ["share_link_id"])
    op.create_index(
        "uq_live_session_audiences_public",
        "live_session_audiences",
        ["session_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'public'"),
    )

    usable_links = {
        (link_id, trip_id)
        for link_id, trip_id in bind.execute(
            sa.text("SELECT id, trip_id FROM share_links WHERE state::text = ANY(:states)"),
            {"states": list(LINK_STATES)},
        )
    }
    insert = sa.text(
        "INSERT INTO live_session_audiences (id, session_id, kind, share_link_id, precision, delay_seconds) "
        "VALUES (:id, :session_id, CAST(:kind AS public.travel_live_audience_kind), :share_link_id, "
        "CAST(:precision AS public.travel_live_precision), :delay)"
    )
    rows = []
    for session_id, trip_id, audiences, delays in bind.execute(
        sa.text("SELECT id, trip_id, audiences, delays FROM live_sessions")
    ):
        delays = _json(delays)
        for key, saved_precision in _json(audiences).items():
            if saved_precision not in PRECISIONS or (key != "public" and (key, trip_id) not in usable_links):
                continue
            saved_delay = delays.get(key, 0)
            rows.append(
                {
                    "id": uuid.uuid4().hex,
                    "session_id": session_id,
                    "kind": "public" if key == "public" else "link",
                    "share_link_id": None if key == "public" else key,
                    "precision": saved_precision,
                    "delay": saved_delay if saved_delay in DELAYS else 0,
                }
            )
    if rows:
        bind.execute(insert, rows)
    op.drop_column("live_sessions", "audiences")
    op.drop_column("live_sessions", "delays")

    op.add_column(
        "live_sessions",
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.add_column(
        "live_sessions",
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.execute(
        "UPDATE live_sessions SET current_id = NULL "
        "WHERE current_id IS NOT NULL AND current_id NOT IN (SELECT id FROM live_points)"
    )
    op.create_foreign_key(
        "fk_live_sessions_current_point", "live_sessions", "live_points", ["current_id"], ["id"], ondelete="SET NULL"
    )

    for old, new in RENAMES:
        op.execute(f"ALTER TABLE live_points RENAME CONSTRAINT {old} TO {new}")
    for table, name, check in COORDINATE_CHECKS:
        op.create_check_constraint(name, table, check)


def downgrade() -> None:
    bind = op.get_bind()
    for table, name, _ in reversed(COORDINATE_CHECKS):
        op.drop_constraint(name, table, type_="check")
    for old, new in RENAMES:
        op.execute(f"ALTER TABLE live_points RENAME CONSTRAINT {new} TO {old}")

    op.drop_constraint("fk_live_sessions_current_point", "live_sessions", type_="foreignkey")
    op.drop_column("live_sessions", "updated_at")
    op.drop_column("live_sessions", "created_at")

    op.add_column("live_sessions", sa.Column("audiences", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column("live_sessions", sa.Column("delays", sa.JSON(), nullable=False, server_default="{}"))
    op.alter_column("live_sessions", "audiences", server_default=None)
    saved: dict[str, tuple[dict, dict]] = {}
    for session_id, link_id, saved_precision, delay in bind.execute(
        sa.text("SELECT session_id, share_link_id, precision::text, delay_seconds FROM live_session_audiences")
    ):
        audiences, delays = saved.setdefault(session_id, ({}, {}))
        audiences[link_id or "public"] = saved_precision
        delays[link_id or "public"] = delay
    update = sa.text(
        "UPDATE live_sessions SET audiences = CAST(:audiences AS json), delays = CAST(:delays AS json) WHERE id = :id"
    )
    for session_id, (audiences, delays) in saved.items():
        bind.execute(update, {"id": session_id, "audiences": json.dumps(audiences), "delays": json.dumps(delays)})

    op.drop_table("live_session_audiences")
    postgresql.ENUM(name="travel_live_precision", schema="public").drop(bind)
    postgresql.ENUM(name="travel_live_audience_kind", schema="public").drop(bind)
