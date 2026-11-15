"""Let authored text exist in Dutch and English, with fallback (#376).

Every text a visitor can receive becomes two nullable columns, ``<field>_nl`` and ``<field>_en``, and the single
column is removed. Neither language is the original. The fields are the trip's ``title`` and ``summary``, a visit's
``title`` and ``summary``, a travel update's ``title`` and ``body``, the ``label`` of an area, a location and a route,
a photo's ``caption`` and ``alt_text``, and a collection's ``title``.

* ``trips`` and ``collections`` gain ``content_language`` (``nl`` or ``en``, default ``nl``): the language a write to
  the plain field name lands in. A trip's other records read it from the trip.
* The existing text moves to ``<field>_nl`` and every trip and collection starts as ``nl``, so nothing reads
  differently. An empty update body (``''``) becomes ``NULL``: both languages empty.
* A trip's and an update's title is required in at least one language (a check constraint).

The downgrade writes the text of each record's content language (the other language where that one is empty) back
into the single column; the text of the other language is dropped, which is the only loss.

Revision ID: 034_bilingual_texts
Revises: 033_one_document_model
"""

from alembic import op

revision = "034_bilingual_texts"
down_revision = "033_one_document_model"
branch_labels = None
depends_on = None

# table -> (owner of the content language, [(field, column type, required)]).
# A trip and a collection hold their own language; the rest read their trip's.
TABLES: dict[str, tuple[str, list[tuple[str, str, bool]]]] = {
    "trips": ("self", [("title", "character varying(160)", True), ("summary", "text", False)]),
    "collections": ("self", [("title", "character varying(160)", False)]),
    "areas": ("trip", [("label", "character varying(120)", False)]),
    "locations": ("trip", [("label", "character varying(120)", False)]),
    "visits": ("trip", [("title", "character varying(160)", False), ("summary", "text", False)]),
    "routes": ("trip", [("label", "character varying(160)", False)]),
    "travel_updates": ("trip", [("title", "character varying(160)", True), ("body", "text", False)]),
    "media_derivatives": (
        "trip",
        [("caption", "character varying(500)", False), ("alt_text", "character varying(300)", False)],
    ),
}
REQUIRED_TITLES = ("trips", "travel_updates")


def upgrade() -> None:
    for table in ("trips", "collections"):
        op.execute(f"ALTER TABLE public.{table} ADD COLUMN content_language character varying(2) DEFAULT 'nl' NOT NULL")
        op.execute(
            f"ALTER TABLE public.{table} ADD CONSTRAINT ck_{table}_content_language "
            "CHECK (content_language IN ('nl', 'en'))"
        )
    for table, (_, fields) in TABLES.items():
        for field, column_type, _required in fields:
            op.execute(f"ALTER TABLE public.{table} ADD COLUMN {field}_nl {column_type}")
            op.execute(f"ALTER TABLE public.{table} ADD COLUMN {field}_en {column_type}")
            op.execute(f"UPDATE public.{table} SET {field}_nl = NULLIF({field}, '')")
            op.execute(f"ALTER TABLE public.{table} DROP COLUMN {field}")
    for table in REQUIRED_TITLES:
        op.execute(
            f"ALTER TABLE public.{table} ADD CONSTRAINT ck_{table}_title_present "
            "CHECK (title_nl IS NOT NULL OR title_en IS NOT NULL)"
        )


def _resolved(field: str, language: str, alias: str = "") -> str:
    """The text in ``language``, falling back to the other one: the rule every reader applies."""
    prefix = f"{alias}." if alias else ""
    nl, en = f"{prefix}{field}_nl", f"{prefix}{field}_en"
    return f"CASE {language} WHEN 'en' THEN COALESCE({en}, {nl}) ELSE COALESCE({nl}, {en}) END"


def downgrade() -> None:
    for table in REQUIRED_TITLES:
        op.execute(f"ALTER TABLE public.{table} DROP CONSTRAINT ck_{table}_title_present")
    for table, (owner, fields) in TABLES.items():
        for field, column_type, required in fields:
            op.execute(f"ALTER TABLE public.{table} ADD COLUMN {field} {column_type}")
            if owner == "self":
                value = _resolved(field, f"{table}.content_language")
                op.execute(f"UPDATE public.{table} SET {field} = {value}")
            else:
                value = _resolved(field, "trips.content_language", table)
                op.execute(
                    f"UPDATE public.{table} SET {field} = {value} FROM public.trips WHERE trips.id = {table}.trip_id"
                )
            if field == "body":
                op.execute(f"UPDATE public.{table} SET {field} = '' WHERE {field} IS NULL")
            if required or field == "body":
                op.execute(f"ALTER TABLE public.{table} ALTER COLUMN {field} SET NOT NULL")
            op.execute(f"ALTER TABLE public.{table} DROP COLUMN {field}_nl")
            op.execute(f"ALTER TABLE public.{table} DROP COLUMN {field}_en")
    for table in ("trips", "collections"):
        op.execute(f"ALTER TABLE public.{table} DROP CONSTRAINT ck_{table}_content_language")
        op.execute(f"ALTER TABLE public.{table} DROP COLUMN content_language")
