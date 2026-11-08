"""Link trip documents to stays, like routes (#257).

``stay_document_assets`` is the twin of ``route_document_assets``: an owner-only, explicit attachment of a trip
document (a booking confirmation) to a stay. Both keys cascade on delete, so removing a stay or a document removes
only the link; a stored object is never touched here. The table starts empty, so no existing row changes what any
audience receives, and an older application that ignores it delivers exactly the same.
"""

import sqlalchemy as sa

from alembic import op

revision = "023_stay_documents"
down_revision = "022_sharing_preset_label"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stay_document_assets",
        sa.Column("stay_id", sa.String(32), sa.ForeignKey("stays.id", ondelete="CASCADE"), primary_key=True),
        sa.Column(
            "document_asset_id",
            sa.String(32),
            sa.ForeignKey("document_assets.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_stay_document_assets_document_asset_id", "stay_document_assets", ["document_asset_id"])


def downgrade() -> None:
    op.drop_index("ix_stay_document_assets_document_asset_id", table_name="stay_document_assets")
    op.drop_table("stay_document_assets")
