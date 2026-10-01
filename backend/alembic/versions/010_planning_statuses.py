"""Give stays, routes and visits one planning vocabulary.

Stays and routes gain ``idea`` (a candidate being compared) and lose ``booked``,
which is folded into ``confirmed``; visits gain ``cancelled``. Afterwards every
record is ``idea``, ``planned``, ``confirmed`` or ``cancelled``.

Revision ID: 010_planning_statuses
Revises: 009_media_captured_local
"""

from alembic import op

revision = "010_planning_statuses"
down_revision = "009_media_captured_local"
branch_labels = None
depends_on = None

# table, enum type, the values it holds before and after this revision
_RETYPED = (
    (
        "stays",
        "travel_stay_status",
        ("planned", "booked", "confirmed", "cancelled"),
        ("idea", "planned", "confirmed", "cancelled"),
    ),
    (
        "routes",
        "travel_route_status",
        ("planned", "booked", "confirmed", "cancelled"),
        ("idea", "planned", "confirmed", "cancelled"),
    ),
)


def _retype(table: str, type_name: str, values: tuple[str, ...]) -> None:
    """Rebuild an enum type: PostgreSQL can add a value but never drop one."""
    labels = ", ".join(f"'{value}'" for value in values)
    op.execute(f"ALTER TYPE {type_name} RENAME TO {type_name}_old")
    op.execute(f"CREATE TYPE {type_name} AS ENUM ({labels})")
    op.execute(f"ALTER TABLE {table} ALTER COLUMN status TYPE {type_name} USING status::text::{type_name}")
    op.execute(f"DROP TYPE {type_name}_old")


def upgrade() -> None:
    for table, type_name, _before, after in _RETYPED:
        # Reserved and confirmed are one state now; comparing as text keeps the update off the dropped value.
        op.execute(f"UPDATE {table} SET status = 'confirmed' WHERE status::text = 'booked'")
        _retype(table, type_name, after)
    # Existing visits keep their status; the new value is not used in this transaction.
    op.execute("ALTER TYPE travel_visit_status ADD VALUE IF NOT EXISTS 'cancelled'")


def downgrade() -> None:
    # Which confirmed records were once only booked is not recorded, so they all stay confirmed. An idea
    # was never planned, so it goes back to the nearest older state rather than being deleted.
    for table, type_name, before, _after in _RETYPED:
        op.execute(f"UPDATE {table} SET status = 'planned' WHERE status::text = 'idea'")
        _retype(table, type_name, before)
    # A cancelled visit was at most an idea that was dropped.
    op.execute("UPDATE visits SET status = 'idea' WHERE status::text = 'cancelled'")
    op.execute("ALTER TABLE visits ALTER COLUMN status DROP DEFAULT")
    op.execute("ALTER TYPE travel_visit_status RENAME TO travel_visit_status_old")
    op.execute("CREATE TYPE travel_visit_status AS ENUM ('idea', 'planned', 'confirmed')")
    op.execute(
        "ALTER TABLE visits ALTER COLUMN status TYPE travel_visit_status USING status::text::travel_visit_status"
    )
    op.execute("ALTER TABLE visits ALTER COLUMN status SET DEFAULT 'planned'")
    op.execute("DROP TYPE travel_visit_status_old")
