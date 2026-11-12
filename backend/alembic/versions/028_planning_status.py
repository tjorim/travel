"""Merge the stay, route and visit status types into one planning status (#359).

The three PostgreSQL enum types held the same four values, so stays, routes and visits now share
``travel_planning_status``. Each column is converted through its text form, so every existing status
survives unchanged. The downgrade rebuilds the three per-kind types from the same values.

Revision ID: 028_planning_status
Revises: 027_remove_unused_values
"""

from alembic import op

revision = "028_planning_status"
down_revision = "027_remove_unused_values"
branch_labels = None
depends_on = None

_VALUES = "'idea', 'planned', 'confirmed', 'cancelled'"
_NEW = "travel_planning_status"
# table, the per-kind enum type it used before this revision
_COLUMNS = (
    ("stays", "travel_stay_status"),
    ("routes", "travel_route_status"),
    ("visits", "travel_visit_status"),
)


def _retype(table: str, new: str) -> None:
    # Only visits carry a server default (migration 003); a default cast to the old type blocks the retype.
    op.execute(f"ALTER TABLE {table} ALTER COLUMN status DROP DEFAULT")
    op.execute(f"ALTER TABLE {table} ALTER COLUMN status TYPE {new} USING status::text::{new}")
    if table == "visits":
        op.execute("ALTER TABLE visits ALTER COLUMN status SET DEFAULT 'planned'")


def upgrade() -> None:
    op.execute(f"CREATE TYPE {_NEW} AS ENUM ({_VALUES})")
    for table, old in _COLUMNS:
        _retype(table, _NEW)
        op.execute(f"DROP TYPE {old}")


def downgrade() -> None:
    for table, old in _COLUMNS:
        op.execute(f"CREATE TYPE {old} AS ENUM ({_VALUES})")
        _retype(table, old)
    op.execute(f"DROP TYPE {_NEW}")
