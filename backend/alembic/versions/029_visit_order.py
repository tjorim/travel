"""Order visits by date like stays and routes; drop the manual position (#367).

A visit is now ordered by day, then time, then creation (undated visits last, in creation order), so the
``position`` column and its unique ``(trip_id, position)`` constraint go. Visits created together share a
``created_at`` (migration 001 stamped every converted row alike), so before the column is dropped the old
position nudges such ties apart by whole microseconds: the order the owner arranged survives wherever the
new rule has nothing else to go by. The downgrade restores a position from the new order.

Revision ID: 029_visit_order
Revises: 028_planning_status
"""

from alembic import op

revision = "029_visit_order"
down_revision = "028_planning_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE visits SET created_at = visits.created_at + (ranked.rank - 1) * interval '1 microsecond'
        FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY trip_id, created_at ORDER BY "position", id) AS rank
            FROM visits
        ) AS ranked
        WHERE ranked.id = visits.id AND ranked.rank > 1
        """
    )
    op.execute("ALTER TABLE visits DROP CONSTRAINT uq_visit_position")
    op.execute('ALTER TABLE visits DROP COLUMN "position"')


def downgrade() -> None:
    op.execute('ALTER TABLE visits ADD COLUMN "position" integer')
    op.execute(
        """
        UPDATE visits SET "position" = ordered.place - 1
        FROM (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY trip_id
                ORDER BY starts_on IS NULL, starts_on, start_time IS NULL, start_time, created_at, id
            ) AS place
            FROM visits
        ) AS ordered
        WHERE ordered.id = visits.id
        """
    )
    op.execute('ALTER TABLE visits ALTER COLUMN "position" SET NOT NULL')
    op.execute('ALTER TABLE visits ADD CONSTRAINT uq_visit_position UNIQUE (trip_id, "position")')
