"""Drop the unused ``static_export`` derivative purpose and type two free-string columns (#359).

``static_export`` was never read by anything: only ``share`` derivatives can reach a visitor, so a
leftover static-export copy is private like ``owner_preview`` and becomes one. ``processing_backend``
and the task alert ``kind`` hold a small fixed set of values, so they become enums like the rest.

Revision ID: 027_remove_unused_values
Revises: 026_location_delay
"""

from alembic import op

revision = "027_remove_unused_values"
down_revision = "026_location_delay"
branch_labels = None
depends_on = None

_PURPOSE = "travel_derivative_purpose"
_BACKEND = "travel_derivative_processing_backend"
_ALERT_KIND = "travel_task_alert_kind"


def _retype_purpose(values: tuple[str, ...]) -> None:
    """Rebuild an enum type: PostgreSQL can add a value but never drop one."""
    labels = ", ".join(f"'{value}'" for value in values)
    op.execute(f"ALTER TYPE {_PURPOSE} RENAME TO {_PURPOSE}_old")
    op.execute(f"CREATE TYPE {_PURPOSE} AS ENUM ({labels})")
    op.execute(f"ALTER TABLE media_derivatives ALTER COLUMN purpose TYPE {_PURPOSE} USING purpose::text::{_PURPOSE}")
    op.execute(f"DROP TYPE {_PURPOSE}_old")


def upgrade() -> None:
    op.execute("UPDATE media_derivatives SET purpose = 'owner_preview' WHERE purpose::text = 'static_export'")
    _retype_purpose(("owner_preview", "share"))

    op.execute(f"CREATE TYPE {_BACKEND} AS ENUM ('local', 'remote', 'thumbnail')")
    op.execute("ALTER TABLE media_derivatives ALTER COLUMN processing_backend DROP DEFAULT")
    op.execute(
        f"ALTER TABLE media_derivatives ALTER COLUMN processing_backend TYPE {_BACKEND} "
        f"USING processing_backend::{_BACKEND}"
    )
    op.execute("ALTER TABLE media_derivatives ALTER COLUMN processing_backend SET DEFAULT 'local'")

    op.execute(f"CREATE TYPE {_ALERT_KIND} AS ENUM ('reminder')")
    op.execute(f"ALTER TABLE trip_task_alerts ALTER COLUMN kind TYPE {_ALERT_KIND} USING kind::{_ALERT_KIND}")


def downgrade() -> None:
    op.execute("ALTER TABLE trip_task_alerts ALTER COLUMN kind TYPE VARCHAR(32) USING kind::text")
    op.execute(f"DROP TYPE {_ALERT_KIND}")

    op.execute("ALTER TABLE media_derivatives ALTER COLUMN processing_backend DROP DEFAULT")
    op.execute(
        "ALTER TABLE media_derivatives ALTER COLUMN processing_backend TYPE VARCHAR(10) USING processing_backend::text"
    )
    op.execute("ALTER TABLE media_derivatives ALTER COLUMN processing_backend SET DEFAULT 'local'")
    op.execute(f"DROP TYPE {_BACKEND}")

    # The converted static-export copies stay owner previews; which ones they were is not recorded.
    _retype_purpose(("owner_preview", "share", "static_export"))
