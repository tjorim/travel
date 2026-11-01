"""Keep detached trip object inventory for committed, retryable cleanup."""

import sqlalchemy as sa

from alembic import op

revision = "017_trip_object_cleanup"
down_revision = "016_location_update_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("stored_objects_trip_id_fkey", "stored_objects", type_="foreignkey")
    op.alter_column("stored_objects", "trip_id", existing_type=sa.String(32), nullable=True)
    op.create_foreign_key(
        "stored_objects_trip_id_fkey", "stored_objects", "trips", ["trip_id"], ["id"], ondelete="SET NULL"
    )


def downgrade() -> None:
    # Refuse to discard cleanup inventory. Run the locked maintenance purge first.
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT count(*) FROM stored_objects WHERE trip_id IS NULL")):
        raise RuntimeError("Purge detached stored objects before downgrading")
    op.drop_constraint("stored_objects_trip_id_fkey", "stored_objects", type_="foreignkey")
    op.alter_column("stored_objects", "trip_id", existing_type=sa.String(32), nullable=False)
    op.create_foreign_key(
        "stored_objects_trip_id_fkey", "stored_objects", "trips", ["trip_id"], ["id"], ondelete="CASCADE"
    )
