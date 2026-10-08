"""Explicit additive Skill schema initialization and owned write transactions."""

from contextlib import contextmanager
from importlib.resources import files
import sqlite3
from typing import Iterator

from .storage import _write_transaction


def _check_write_context(connection: sqlite3.Connection) -> None:
    if connection.in_transaction:
        raise ValueError("Skill writes reject an active caller transaction")
    if connection.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
        raise ValueError("Skill writes require foreign_keys=ON on the Axis-Evo connection")


def _schema_objects(connection: sqlite3.Connection) -> tuple:
    cursor = connection.cursor()
    cursor.row_factory = None
    try:
        return tuple(cursor.execute("""SELECT type, name, tbl_name, sql FROM sqlite_master
            WHERE tbl_name IN ('skills', 'skill_versions', 'skill_state_events')
              AND name NOT LIKE 'sqlite_%' ORDER BY type, name"""))
    finally:
        cursor.close()


def initialize_skill_schema(connection: sqlite3.Connection) -> None:
    """Apply only migration 002, atomically, without changing connection settings."""
    _check_write_context(connection)
    names = {row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('runs', 'events')")}
    if names != {"runs", "events"}:
        raise ValueError("initialize_skill_schema requires an existing Axis-Evo database")
    schema = files("axis_evo").joinpath("migrations", "002_phase2_skills.sql").read_text(encoding="utf-8")
    reference = sqlite3.connect(":memory:")
    try:
        reference.executescript(schema)
        expected = _schema_objects(reference)
    finally:
        reference.close()
    try:
        # executescript must own BEGIN: it would commit a surrounding transaction.
        connection.executescript("BEGIN IMMEDIATE;\n" + schema)
        if _schema_objects(connection) != expected:
            raise sqlite3.IntegrityError("Phase 2 schema differs from migration 002")
        connection.commit()
    except BaseException:
        connection.rollback()
        raise


@contextmanager
def _skill_transaction(connection: sqlite3.Connection) -> Iterator[None]:
    _check_write_context(connection)
    with _write_transaction(connection):
        yield


def _insert_one(connection: sqlite3.Connection, sql: str, parameters: tuple) -> None:
    if connection.execute(sql, parameters).rowcount != 1:
        raise sqlite3.IntegrityError("Skill fact insertion was not applied")
