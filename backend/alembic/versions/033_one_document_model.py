"""Merge the trip documents and the owner library into one document model (#368).

A document belongs to the owner and is optionally filed under a trip; only a document filed under a trip can be
attached to that trip's stays and routes.

* ``document_assets`` becomes the one document table. It gains ``owner_subject``, its ``trip_id`` becomes optional
  (``ON DELETE SET NULL``: deleting a trip unfiles its documents) and ``original_object_id`` stops being unique,
  because the same bytes may sit under several trips. One document holds a file per trip (or unfiled).
* ``owner_documents`` is copied into it (``linked_trip_id`` becomes ``trip_id``) and dropped.
* ``stored_objects`` becomes the one inventory. It gains ``owner_subject`` (the home of a document original, with
  identical bytes stored once per owner) and a 64-bit ``byte_size``. ``owner_stored_objects`` is copied into it, ids
  and keys unchanged, and dropped. No file is moved, rewritten or deleted here.
* Identical bytes the owner held more than once (the same file as documents of two trips, or in the library and a
  trip) become one object; the other rows are released, and marked ``purge_pending`` for the locked purge when
  nothing else uses them. A library document that was linked to a trip already holding the same file is unfiled
  (its attachments, if any, move to the document that stays).
* The ``deleted_at`` columns were never set and are dropped; a row that had one is deleted like a removed document.

The downgrade moves unfiled documents back to the library tables and filed ones back to trip documents. It refuses
while one file is held by documents of several trips, or by a document and a photo of another trip, because the old
schema cannot hold that; remove or re-upload one of them first. It also refuses a ``byte_size`` over 2 GiB.

Revision ID: 033_one_document_model
Revises: 032_live_audiences
"""

from collections import defaultdict

import sqlalchemy as sa

from alembic import op

revision = "033_one_document_model"
down_revision = "032_live_audiences"
branch_labels = None
depends_on = None

# An object nothing names: no photo, derivative, poster or document.
UNREFERENCED = """
    NOT EXISTS (SELECT 1 FROM public.media_assets WHERE original_object_id = stored_objects.id)
    AND NOT EXISTS (SELECT 1 FROM public.media_derivatives
                    WHERE object_id = stored_objects.id OR poster_object_id = stored_objects.id)
    AND NOT EXISTS (SELECT 1 FROM public.document_assets WHERE original_object_id = stored_objects.id)
"""
MEDIA_REFERENCED = """
    EXISTS (SELECT 1 FROM public.media_assets WHERE original_object_id = stored_objects.id)
    OR EXISTS (SELECT 1 FROM public.media_derivatives
               WHERE object_id = stored_objects.id OR poster_object_id = stored_objects.id)
"""


def _release_deleted(bind) -> None:
    """Remove documents carrying a ``deleted_at`` (never set by the application) and release their files."""
    bind.execute(
        sa.text(
            "CREATE TEMP TABLE _released_objects AS "
            "SELECT original_object_id AS id FROM public.document_assets WHERE deleted_at IS NOT NULL "
            "UNION SELECT original_object_id FROM public.owner_documents WHERE deleted_at IS NOT NULL"
        )
    )
    bind.execute(sa.text("DELETE FROM public.document_assets WHERE deleted_at IS NOT NULL"))
    bind.execute(sa.text("DELETE FROM public.owner_documents WHERE deleted_at IS NOT NULL"))


def _merge_duplicates(bind) -> None:
    """Keep one object per owner and file; point the documents at it and release the others."""
    rows = bind.execute(
        sa.text(
            "SELECT id, owner_subject, sha256 FROM public.stored_objects WHERE owner_subject IS NOT NULL "
            "ORDER BY owner_subject, sha256, (state::text = 'available') DESC, created_at, id"
        )
    ).all()
    groups: dict[tuple[str, str], list[str]] = defaultdict(list)
    for object_id, owner, digest in rows:
        groups[owner, digest].append(object_id)
    for ids in groups.values():
        keep, *duplicates = ids
        for duplicate in duplicates:
            bind.execute(
                sa.text("UPDATE public.document_assets SET original_object_id = :keep WHERE original_object_id = :id"),
                {"keep": keep, "id": duplicate},
            )
            bind.execute(
                sa.text(
                    "UPDATE public.stored_objects SET owner_subject = NULL, "
                    f"state = CASE WHEN {UNREFERENCED} THEN 'purge_pending'::public.travel_object_state "
                    "ELSE state END WHERE id = :id"
                ),
                {"id": duplicate},
            )


def _unfile_repeats(bind) -> None:
    """A trip holds one document per file. Of two that now do, the one with attachments (else the older) stays.

    The other is unfiled, not lost; its attachments move to the one that stays, so no attached document is ever
    unfiled. This happens when a library document was linked to a trip that already held the same file."""
    repeats = bind.execute(
        sa.text(
            """
            WITH flagged AS (
                SELECT d.id, d.original_object_id, d.trip_id, d.created_at,
                       (EXISTS (SELECT 1 FROM public.stay_document_assets WHERE document_asset_id = d.id)
                        OR EXISTS (SELECT 1 FROM public.route_document_assets WHERE document_asset_id = d.id)) AS attached
                FROM public.document_assets d WHERE d.trip_id IS NOT NULL
            ), ranked AS (
                SELECT id, first_value(id) OVER pair AS kept, row_number() OVER pair AS position FROM flagged
                WINDOW pair AS (PARTITION BY original_object_id, trip_id ORDER BY attached DESC, created_at, id)
            )
            SELECT id, kept FROM ranked WHERE position > 1
            """
        )
    ).all()
    for repeat, kept in repeats:
        for table, owner_column in (("stay_document_assets", "stay_id"), ("route_document_assets", "route_id")):
            bind.execute(
                sa.text(
                    f"INSERT INTO public.{table} ({owner_column}, document_asset_id, created_at) "  # noqa: S608
                    f"SELECT {owner_column}, :kept, created_at FROM public.{table} WHERE document_asset_id = :repeat "
                    "ON CONFLICT DO NOTHING"
                ),
                {"kept": kept, "repeat": repeat},
            )
            bind.execute(
                sa.text(f"DELETE FROM public.{table} WHERE document_asset_id = :repeat"),  # noqa: S608
                {"repeat": repeat},
            )
        bind.execute(sa.text("UPDATE public.document_assets SET trip_id = NULL WHERE id = :id"), {"id": repeat})


def upgrade() -> None:
    bind = op.get_bind()
    _release_deleted(bind)

    # Inventory: one table, an owner home and room for any file size the upload limit allows.
    op.add_column("stored_objects", sa.Column("owner_subject", sa.String(255), nullable=True))
    op.alter_column("stored_objects", "byte_size", existing_type=sa.Integer(), type_=sa.BigInteger())
    op.execute(
        "INSERT INTO public.stored_objects "
        "(id, trip_id, owner_subject, bucket, object_key, sha256, byte_size, content_type, state, created_at, updated_at) "
        "SELECT id, NULL, owner_subject, bucket, object_key, sha256, byte_size, content_type, state, created_at, "
        "updated_at FROM public.owner_stored_objects"
    )

    # Documents: one table, owned by the owner, optionally filed under a trip.
    op.drop_constraint("document_assets_original_object_id_key", "document_assets", type_="unique")
    op.drop_constraint("document_assets_trip_id_fkey", "document_assets", type_="foreignkey")
    op.alter_column("document_assets", "trip_id", existing_type=sa.String(32), nullable=True)
    op.create_foreign_key(
        "document_assets_trip_id_fkey", "document_assets", "trips", ["trip_id"], ["id"], ondelete="SET NULL"
    )
    op.add_column("document_assets", sa.Column("owner_subject", sa.String(255), nullable=True))
    op.execute(
        "UPDATE public.document_assets SET owner_subject = trips.owner_subject "
        "FROM public.trips WHERE trips.id = document_assets.trip_id"
    )
    op.execute(
        "INSERT INTO public.document_assets "
        "(id, owner_subject, trip_id, original_object_id, document_kind, title, owner_metadata, created_at, updated_at) "
        "SELECT id, owner_subject, linked_trip_id, original_object_id, document_kind, title, owner_metadata, "
        "created_at, updated_at FROM public.owner_documents"
    )
    op.alter_column("document_assets", "owner_subject", existing_type=sa.String(255), nullable=False)

    # A trip document's file is now the owner's. An object a photo also uses keeps its trip as well, and a file
    # only documents use leaves the trip, whose deletion no longer concerns it.
    op.execute(
        "UPDATE public.stored_objects SET owner_subject = document_assets.owner_subject "
        "FROM public.document_assets WHERE document_assets.original_object_id = stored_objects.id "
        "AND stored_objects.owner_subject IS NULL"
    )
    op.execute(
        f"UPDATE public.stored_objects SET trip_id = NULL WHERE owner_subject IS NOT NULL AND NOT ({MEDIA_REFERENCED})"
    )
    _merge_duplicates(bind)
    _unfile_repeats(bind)
    # Files released above, and those of removed documents, wait for the locked purge.
    op.execute(
        f"UPDATE public.stored_objects SET state = 'purge_pending' WHERE id IN (SELECT id FROM _released_objects) "
        f"AND {UNREFERENCED}"
    )
    op.execute("DROP TABLE _released_objects")

    op.drop_column("document_assets", "deleted_at")
    op.drop_table("owner_documents", schema="public")
    op.drop_table("owner_stored_objects", schema="public")

    op.create_index("ix_stored_objects_owner_subject", "stored_objects", ["owner_subject"])
    op.create_index(
        "uq_stored_object_owner_sha256",
        "stored_objects",
        ["owner_subject", "sha256"],
        unique=True,
        postgresql_where=sa.text("owner_subject IS NOT NULL"),
    )
    op.create_index("ix_document_assets_owner_subject", "document_assets", ["owner_subject"])
    op.create_index("ix_document_assets_original_object_id", "document_assets", ["original_object_id"])
    op.create_index(
        "uq_document_assets_object_trip",
        "document_assets",
        ["original_object_id", "trip_id"],
        unique=True,
        postgresql_where=sa.text("trip_id IS NOT NULL"),
    )
    op.create_index(
        "uq_document_assets_object_unfiled",
        "document_assets",
        ["original_object_id"],
        unique=True,
        postgresql_where=sa.text("trip_id IS NULL"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.scalar(
        sa.text(
            "SELECT count(*) FROM (SELECT original_object_id FROM public.document_assets "
            "GROUP BY original_object_id HAVING count(*) > 1) shared"
        )
    ):
        raise RuntimeError("A file is held by documents of several trips; remove all but one before downgrading")
    if bind.scalar(
        sa.text(
            "SELECT count(*) FROM public.document_assets d JOIN public.stored_objects stored_objects "
            f"ON stored_objects.id = d.original_object_id WHERE ({MEDIA_REFERENCED}) "
            "AND stored_objects.trip_id IS DISTINCT FROM d.trip_id"
        )
    ):
        raise RuntimeError("A document shares its file with a photo of another trip; remove one before downgrading")
    if bind.scalar(sa.text("SELECT count(*) FROM public.stored_objects WHERE byte_size > 2147483647")):
        raise RuntimeError("A stored object is larger than 2 GiB; remove it before downgrading")

    op.drop_index("uq_document_assets_object_unfiled", table_name="document_assets")
    op.drop_index("uq_document_assets_object_trip", table_name="document_assets")
    op.drop_index("ix_document_assets_original_object_id", table_name="document_assets")
    op.drop_index("ix_document_assets_owner_subject", table_name="document_assets")
    op.drop_index("uq_stored_object_owner_sha256", table_name="stored_objects")
    op.drop_index("ix_stored_objects_owner_subject", table_name="stored_objects")

    op.execute(
        """
CREATE TABLE public.owner_stored_objects (
    id character varying(32) NOT NULL,
    owner_subject character varying(255) NOT NULL,
    bucket character varying(64) NOT NULL,
    object_key character varying(255) NOT NULL,
    sha256 character varying(64) NOT NULL,
    byte_size integer NOT NULL,
    content_type character varying(120) NOT NULL,
    state public.travel_object_state NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT owner_stored_objects_pkey PRIMARY KEY (id),
    CONSTRAINT owner_stored_objects_object_key_key UNIQUE (object_key)
)
"""
    )
    op.execute("CREATE INDEX ix_owner_stored_objects_owner_subject ON public.owner_stored_objects (owner_subject)")
    op.execute(
        """
CREATE TABLE public.owner_documents (
    id character varying(32) NOT NULL,
    owner_subject character varying(255) NOT NULL,
    original_object_id character varying(32) NOT NULL,
    document_kind public.travel_document_kind NOT NULL,
    title character varying(160) NOT NULL,
    owner_metadata json NOT NULL,
    linked_trip_id character varying(32),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT owner_documents_pkey PRIMARY KEY (id),
    CONSTRAINT owner_documents_original_object_id_key UNIQUE (original_object_id),
    CONSTRAINT owner_documents_linked_trip_id_fkey FOREIGN KEY (linked_trip_id)
        REFERENCES public.trips(id) ON DELETE SET NULL,
    CONSTRAINT owner_documents_original_object_id_fkey FOREIGN KEY (original_object_id)
        REFERENCES public.owner_stored_objects(id)
)
"""
    )
    op.execute("CREATE INDEX ix_owner_documents_linked_trip_id ON public.owner_documents (linked_trip_id)")
    op.execute("CREATE INDEX ix_owner_documents_owner_subject ON public.owner_documents (owner_subject)")

    # Unfiled documents go back to the library; objects only they name move with them.
    op.execute(
        "INSERT INTO public.owner_stored_objects "
        "(id, owner_subject, bucket, object_key, sha256, byte_size, content_type, state, created_at, updated_at) "
        "SELECT id, owner_subject, 'library', object_key, sha256, byte_size, content_type, state, created_at, "
        "updated_at FROM public.stored_objects WHERE id IN "
        "(SELECT original_object_id FROM public.document_assets WHERE trip_id IS NULL)"
    )
    op.execute(
        "INSERT INTO public.owner_documents "
        "(id, owner_subject, original_object_id, document_kind, title, owner_metadata, created_at, updated_at) "
        "SELECT id, owner_subject, original_object_id, document_kind, title, owner_metadata, created_at, updated_at "
        "FROM public.document_assets WHERE trip_id IS NULL"
    )
    op.execute("DELETE FROM public.document_assets WHERE trip_id IS NULL")
    op.execute("DELETE FROM public.stored_objects WHERE id IN (SELECT id FROM public.owner_stored_objects)")
    # Objects of the library that nothing named any more (waiting for the purge) are kept as they were.
    op.execute(
        "INSERT INTO public.owner_stored_objects "
        "(id, owner_subject, bucket, object_key, sha256, byte_size, content_type, state, created_at, updated_at) "
        "SELECT id, owner_subject, 'library', object_key, sha256, byte_size, content_type, state, created_at, "
        "updated_at FROM public.stored_objects WHERE owner_subject IS NOT NULL AND trip_id IS NULL "
        "AND NOT EXISTS (SELECT 1 FROM public.document_assets WHERE original_object_id = stored_objects.id)"
    )
    op.execute("DELETE FROM public.stored_objects WHERE id IN (SELECT id FROM public.owner_stored_objects)")

    # Filed documents are trip documents again; their files belong to the trip.
    op.execute(
        "UPDATE public.stored_objects SET trip_id = document_assets.trip_id "
        "FROM public.document_assets WHERE document_assets.original_object_id = stored_objects.id "
        "AND stored_objects.trip_id IS NULL"
    )
    op.add_column("document_assets", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.drop_constraint("document_assets_trip_id_fkey", "document_assets", type_="foreignkey")
    op.alter_column("document_assets", "trip_id", existing_type=sa.String(32), nullable=False)
    op.create_foreign_key(
        "document_assets_trip_id_fkey", "document_assets", "trips", ["trip_id"], ["id"], ondelete="CASCADE"
    )
    op.drop_column("document_assets", "owner_subject")
    op.create_unique_constraint("document_assets_original_object_id_key", "document_assets", ["original_object_id"])

    op.drop_column("stored_objects", "owner_subject")
    op.alter_column("stored_objects", "byte_size", existing_type=sa.BigInteger(), type_=sa.Integer())
