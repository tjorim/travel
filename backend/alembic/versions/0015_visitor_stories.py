"""Add authored story dates and reviewed media presentation fields.

Revision ID: 0015_visitor_stories
Revises: 0014_owner_library
"""

import uuid

import sqlalchemy as sa

from alembic import op

revision = "0015_visitor_stories"
down_revision = "0014_owner_library"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("moment_excerpts", sa.Column("share_id", sa.String(32), nullable=True))
    op.add_column("moment_excerpts", sa.Column("story_date", sa.Date(), nullable=True))
    connection = op.get_bind()
    for (excerpt_id,) in connection.execute(sa.text("SELECT id FROM moment_excerpts")):
        connection.execute(
            sa.text("UPDATE moment_excerpts SET share_id = :share_id WHERE id = :id"),
            {"share_id": uuid.uuid4().hex, "id": excerpt_id},
        )
    op.alter_column("moment_excerpts", "share_id", nullable=False)
    op.create_unique_constraint("uq_moment_excerpts_share_id", "moment_excerpts", ["share_id"])
    op.add_column("media_derivatives", sa.Column("moment_excerpt_id", sa.String(32), nullable=True))
    op.add_column("media_derivatives", sa.Column("caption", sa.String(500), nullable=True))
    op.add_column("media_derivatives", sa.Column("alt_text", sa.String(300), nullable=True))
    op.add_column("media_derivatives", sa.Column("focal_x", sa.Integer(), nullable=True))
    op.add_column("media_derivatives", sa.Column("focal_y", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_media_derivatives_moment_excerpt_id", "media_derivatives", "moment_excerpts", ["moment_excerpt_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint("fk_media_derivatives_moment_excerpt_id", "media_derivatives", type_="foreignkey")
    for column in ("focal_y", "focal_x", "alt_text", "caption", "moment_excerpt_id"):
        op.drop_column("media_derivatives", column)
    op.drop_constraint("uq_moment_excerpts_share_id", "moment_excerpts", type_="unique")
    op.drop_column("moment_excerpts", "story_date")
    op.drop_column("moment_excerpts", "share_id")
