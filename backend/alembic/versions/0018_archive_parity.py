"""Close the static-archive parity gaps.

Stays become the nights slept at an accommodation (local check-in and
check-out dates with optional local times), may be planned before the
property is chosen, and can name their city or area. Transport legs record
each endpoint's time zone and a travel class. Trips gain local travel dates,
route stages an authored summary, itinerary entries a date range, kind and
tentative flag, tasks HTTPS reference links, and a new shareable trip
highlight resource.

Revision ID: 0018_archive_parity
Revises: 0017_mcp_audit_trip_tombstones
Create Date: 2026-09-23
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0018_archive_parity"
down_revision = "0017_mcp_audit_trip_tombstones"
branch_labels = None
depends_on = None


itinerary_entry_kind = postgresql.ENUM(
    "travel", "free", "work", name="travel_itinerary_entry_kind", create_type=False
)


def upgrade() -> None:
    bind = op.get_bind()

    op.add_column("trips", sa.Column("starts_on", sa.Date(), nullable=True))
    op.add_column("trips", sa.Column("ends_on", sa.Date(), nullable=True))
    op.add_column("route_stages", sa.Column("summary", sa.Text(), nullable=True))

    # Existing stays keep their calendar nights. The previous instants carry
    # no accommodation time zone, so their UTC date is the best available
    # local date and the time of day is not carried over.
    op.add_column("stays", sa.Column("check_in_date", sa.Date(), nullable=True))
    op.add_column("stays", sa.Column("check_out_date", sa.Date(), nullable=True))
    op.execute(
        "UPDATE stays SET check_in_date = (arrives_at AT TIME ZONE 'UTC')::date, "
        "check_out_date = (departs_at AT TIME ZONE 'UTC')::date"
    )
    # A same-day stay would now cover zero nights; keep it as one night.
    op.execute("UPDATE stays SET check_out_date = check_in_date + 1 WHERE check_out_date <= check_in_date")
    op.alter_column("stays", "check_in_date", nullable=False)
    op.alter_column("stays", "check_out_date", nullable=False)
    op.drop_constraint("ck_stay_departure_after_arrival", "stays", type_="check")
    op.drop_column("stays", "arrives_at")
    op.drop_column("stays", "departs_at")
    op.create_check_constraint("ck_stay_check_out_after_check_in", "stays", "check_out_date > check_in_date")
    op.add_column("stays", sa.Column("check_in_time", sa.Time(), nullable=True))
    op.add_column("stays", sa.Column("check_out_time", sa.Time(), nullable=True))
    op.add_column("stays", sa.Column("broad_place_id", sa.String(length=32), nullable=True))
    op.create_foreign_key("fk_stays_broad_place_id_places", "stays", "places", ["broad_place_id"], ["id"])
    op.add_column("stays", sa.Column("website_url", sa.String(length=2048), nullable=True))
    op.alter_column("stays", "exact_place_id", existing_type=sa.String(length=32), nullable=True)
    op.alter_column("stays", "property_name", existing_type=sa.String(length=160), nullable=True)

    op.add_column("transport_legs", sa.Column("departure_timezone", sa.String(length=64), nullable=True))
    op.add_column("transport_legs", sa.Column("arrival_timezone", sa.String(length=64), nullable=True))
    op.add_column("transport_legs", sa.Column("travel_class", sa.String(length=80), nullable=True))

    itinerary_entry_kind.create(bind, checkfirst=True)
    op.add_column("itinerary_entries", sa.Column("end_date", sa.Date(), nullable=True))
    op.add_column("itinerary_entries", sa.Column("kind", itinerary_entry_kind, nullable=True))
    op.add_column(
        "itinerary_entries",
        sa.Column("tentative", sa.Boolean(), server_default=sa.false(), nullable=False),
    )

    op.add_column("trip_tasks", sa.Column("links", sa.JSON(), server_default="[]", nullable=False))

    op.create_table(
        "trip_highlights",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_trip_highlights_trip_id", "trip_highlights", ["trip_id"])


def downgrade() -> None:
    bind = op.get_bind()
    undecided = bind.execute(
        sa.text("SELECT count(*) FROM stays WHERE exact_place_id IS NULL OR property_name IS NULL")
    ).scalar_one()
    if undecided:
        raise RuntimeError(
            f"{undecided} stay(s) have no chosen accommodation yet; the previous schema cannot hold them. "
            "Choose or delete them before downgrading."
        )

    op.drop_index("ix_trip_highlights_trip_id", table_name="trip_highlights")
    op.drop_table("trip_highlights")

    op.drop_column("trip_tasks", "links")

    op.drop_column("itinerary_entries", "tentative")
    op.drop_column("itinerary_entries", "kind")
    op.drop_column("itinerary_entries", "end_date")
    itinerary_entry_kind.drop(bind, checkfirst=True)

    op.drop_column("transport_legs", "travel_class")
    op.drop_column("transport_legs", "arrival_timezone")
    op.drop_column("transport_legs", "departure_timezone")

    op.alter_column("stays", "property_name", existing_type=sa.String(length=160), nullable=False)
    op.alter_column("stays", "exact_place_id", existing_type=sa.String(length=32), nullable=False)
    op.drop_column("stays", "website_url")
    op.drop_constraint("fk_stays_broad_place_id_places", "stays", type_="foreignkey")
    op.drop_column("stays", "broad_place_id")
    op.add_column("stays", sa.Column("arrives_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("stays", sa.Column("departs_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        "UPDATE stays SET "
        "arrives_at = (check_in_date + coalesce(check_in_time, time '15:00')) AT TIME ZONE 'UTC', "
        "departs_at = (check_out_date + coalesce(check_out_time, time '11:00')) AT TIME ZONE 'UTC'"
    )
    op.alter_column("stays", "arrives_at", nullable=False)
    op.alter_column("stays", "departs_at", nullable=False)
    op.drop_constraint("ck_stay_check_out_after_check_in", "stays", type_="check")
    op.drop_column("stays", "check_out_time")
    op.drop_column("stays", "check_in_time")
    op.drop_column("stays", "check_out_date")
    op.drop_column("stays", "check_in_date")
    op.create_check_constraint("ck_stay_departure_after_arrival", "stays", "departs_at > arrives_at")

    op.drop_column("route_stages", "summary")
    op.drop_column("trips", "ends_on")
    op.drop_column("trips", "starts_on")
