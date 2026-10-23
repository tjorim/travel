"""Let the owner nominate one photo copy as its trip's cover (#494)."""

import sqlalchemy as sa

from alembic import op

revision = "012_trip_cover"
down_revision = "011_media_worker"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("media_derivatives", sa.Column("is_cover", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.create_index(
        "uq_media_derivatives_trip_cover",
        "media_derivatives",
        ["trip_id"],
        unique=True,
        postgresql_where=sa.text("is_cover"),
        sqlite_where=sa.text("is_cover"),
    )


def downgrade() -> None:
    op.drop_index("uq_media_derivatives_trip_cover", table_name="media_derivatives")
    op.drop_column("media_derivatives", "is_cover")
