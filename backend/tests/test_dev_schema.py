"""The SQLite dev database is built from the models; it must never touch another database."""

import pytest
from sqlalchemy import create_engine, inspect

from app.database import Base
from app.dev_schema import create_dev_schema


def test_creates_every_model_table_and_resets(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'dev.db'}")

    create_dev_schema(engine)
    assert set(inspect(engine).get_table_names()) == set(Base.metadata.tables)

    create_dev_schema(engine)  # idempotent: tables that exist are left alone

    table = next(iter(Base.metadata.tables))
    with engine.begin() as connection:
        connection.exec_driver_sql(f'DROP TABLE "{table}"')
    create_dev_schema(engine, reset=True)
    assert set(inspect(engine).get_table_names()) == set(Base.metadata.tables)


def test_refuses_to_run_on_postgresql():
    engine = create_engine("postgresql+psycopg://user@localhost/travel")  # never connected to

    with pytest.raises(SystemExit, match="Refusing to create the schema on postgresql"):
        create_dev_schema(engine)
