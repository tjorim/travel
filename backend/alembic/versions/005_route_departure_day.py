"""Give routes a local departure day that can exist without a time.

Revision ID: 005_route_departure_day
Revises: 004_merge_audit
"""

import sqlalchemy as sa

from alembic import op

revision = "005_route_departure_day"
down_revision = "004_merge_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("routes", sa.Column("departs_on", sa.Date(), nullable=True))
    # A scheduled route departs on the local date of its departure instant, in
    # the departure time zone, else the departure area's, else UTC.
    op.execute(
        """
        UPDATE public.routes AS route
        SET departs_on = (
            route.departs_at AT TIME ZONE COALESCE(route.departure_timezone, area.timezone, 'UTC')
        )::date
        FROM public.areas AS area
        WHERE area.id = route.departure_area_id AND route.departs_at IS NOT NULL
        """
    )
    op.create_check_constraint("ck_route_time_needs_a_day", "routes", "departs_at IS NULL OR departs_on IS NOT NULL")


def downgrade() -> None:
    op.drop_constraint("ck_route_time_needs_a_day", "routes", type_="check")
    op.drop_column("routes", "departs_on")
