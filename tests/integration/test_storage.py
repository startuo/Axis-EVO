from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
import hashlib
import json
import sqlite3
from threading import Barrier

import pytest

from axis_evo.events import EventType
from axis_evo.hashing import canonical_json_bytes
from axis_evo.storage import append_event, connect_database, create_run


def test_sqlite_durability_settings_on_every_connection(tmp_path):
    for _ in range(2):
        connection = connect_database(tmp_path / "settings.sqlite3")
        try:
            assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
            assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
            assert connection.execute("PRAGMA synchronous").fetchone()[0] == 2
            assert connection.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
        finally:
            connection.close()


def test_schema_has_only_two_core_fact_tables(database):
    tables = database.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    assert {row[0] for row in tables} == {"runs", "events"}


def test_database_rejects_non_durable_memory_mode():
    with pytest.raises(sqlite3.OperationalError, match="file-backed WAL"):
        connect_database(":memory:")


def test_run_persists_matching_canonical_task_spec_and_hash(database, task_spec):
    run = create_run(database, task_spec, "workspace", "test_model")
    row = database.execute("SELECT * FROM runs WHERE run_id = ?", (run.run_id,)).fetchone()
    expected = canonical_json_bytes(asdict(task_spec))
    assert row["task_spec_json"].encode("utf-8") == expected
    assert row["task_spec_sha256"] == hashlib.sha256(expected).hexdigest()
    assert row["task_spec_sha256"] == run.task_spec_sha256
    assert row["task_id"] == task_spec.task_id
    assert row["status"] == "RUNNING"
    assert row["ended_at"] is None
    assert not database.in_transaction


def test_event_seq_is_strictly_monotonic(tmp_path, task_spec):
    path = tmp_path / "sequence.sqlite3"
    connection = connect_database(path)
    try:
        run = create_run(connection, task_spec, "workspace", "test_model")
        first = append_event(
            connection, run.run_id, EventType.RUN_STARTED, {"order": 1},
            occurred_at="2026-09-28T09:10:10Z",
        )
        second = append_event(
            connection, run.run_id, EventType.TASK_LOADED, {"order": 2},
            occurred_at="2026-09-28T09:10:00Z",
        )
        third = append_event(connection, run.run_id, EventType.STEP_PLANNED, {"order": 3})
        assert [first.seq, second.seq, third.seq] == [1, 2, 3]
    finally:
        connection.close()

    connection = connect_database(path)
    try:
        fourth = append_event(connection, run.run_id, EventType.TOOL_INTENT, {"order": 4})
        assert fourth.seq == 4
        rows = connection.execute(
            "SELECT seq, payload_json FROM events WHERE run_id = ? ORDER BY seq", (run.run_id,)
        ).fetchall()
        sequences = [row["seq"] for row in rows]
        assert all(left < right for left, right in zip(sequences, sequences[1:]))
        assert len(set(sequences)) == len(sequences)
        assert [json.loads(row["payload_json"])["order"] for row in rows] == [1, 2, 3, 4]
    finally:
        connection.close()


def test_sequence_is_allocated_per_run(database, task_spec):
    first = create_run(database, task_spec, "workspace", "test_model")
    second = create_run(database, task_spec, "workspace", "test_model")
    assert append_event(database, first.run_id, EventType.RUN_STARTED, {}).seq == 1
    assert append_event(database, first.run_id, EventType.TASK_LOADED, {}).seq == 2
    assert append_event(database, second.run_id, EventType.RUN_STARTED, {}).seq == 1


def test_append_commits_and_persists_the_envelope(database, task_spec, tmp_path):
    run = create_run(database, task_spec, "workspace", "test_model")
    payload = {"tool_name": "patch_file", "arguments": {"path": "config.json"}}
    event = append_event(
        database, run.run_id, EventType.TOOL_INTENT, payload,
        step_id="step_001", tool_call_id="call_001", event_id="evt_explicit",
        occurred_at="2026-09-28T09:10:00Z",
    )
    assert not database.in_transaction
    payload["arguments"]["path"] = "modified_after_append"
    reader = connect_database(tmp_path / "facts.sqlite3")
    try:
        row = dict(reader.execute("SELECT * FROM events").fetchone())
    finally:
        reader.close()
    del row["event_pk"]
    row["payload"] = json.loads(row.pop("payload_json"))
    assert row == asdict(event)
    assert event.payload["arguments"]["path"] == "config.json"


def _raw_event(database, *, run_id, task_id="task_test", event_id="evt_raw", seq=1, version=1):
    database.execute(
        """INSERT INTO events (
            event_id, schema_version, run_id, task_id, seq, event_type, occurred_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (event_id, version, run_id, task_id, seq, "TOOL_INTENT", "2026-09-28T09:10:00Z", "{}"),
    )


def test_events_cannot_reference_a_nonexistent_run(database):
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        _raw_event(database, run_id="run_missing")
    with pytest.raises(sqlite3.IntegrityError, match="run does not exist"):
        append_event(database, "run_missing", EventType.TOOL_INTENT, {})
    assert database.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0
    assert not database.in_transaction


def test_duplicate_event_id_is_rejected_and_rolls_back(database, task_spec):
    run = create_run(database, task_spec, "workspace", "test_model")
    append_event(database, run.run_id, EventType.RUN_STARTED, {}, event_id="evt_duplicate")
    with pytest.raises(sqlite3.IntegrityError, match="events.event_id"):
        append_event(database, run.run_id, EventType.TASK_LOADED, {}, event_id="evt_duplicate")
    assert not database.in_transaction
    assert database.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1
    assert append_event(database, run.run_id, EventType.TASK_LOADED, {}).seq == 2


def test_duplicate_run_seq_is_rejected_by_database(database, task_spec):
    run = create_run(database, task_spec, "workspace", "test_model")
    append_event(database, run.run_id, EventType.RUN_STARTED, {})
    with pytest.raises(sqlite3.IntegrityError, match="events.run_id, events.seq"):
        _raw_event(database, run_id=run.run_id, task_id=run.task_id, seq=1)


@pytest.mark.parametrize("version", [0, 2])
def test_database_enforces_event_schema_version(database, task_spec, version):
    run = create_run(database, task_spec, "workspace", "test_model")
    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        _raw_event(database, run_id=run.run_id, task_id=run.task_id, version=version)


def test_database_rejects_crashed_run_state(database, task_spec):
    run = create_run(database, task_spec, "workspace", "test_model")
    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        database.execute("UPDATE runs SET status = 'CRASHED' WHERE run_id = ?", (run.run_id,))


def test_caller_transaction_is_not_silently_committed_or_rolled_back(database, task_spec):
    run = create_run(database, task_spec, "workspace", "test_model")
    database.execute("BEGIN IMMEDIATE")
    try:
        database.execute("UPDATE runs SET model_plugin = 'pending' WHERE run_id = ?", (run.run_id,))
        with pytest.raises(sqlite3.OperationalError, match="within a transaction"):
            append_event(database, run.run_id, EventType.TOOL_INTENT, {})
        assert database.in_transaction
        assert database.execute("SELECT model_plugin FROM runs").fetchone()[0] == "pending"
    finally:
        database.rollback()
    assert database.execute("SELECT model_plugin FROM runs").fetchone()[0] == "test_model"


def test_concurrent_writers_allocate_unique_sequences(tmp_path, task_spec):
    path = tmp_path / "concurrent.sqlite3"
    connection = connect_database(path)
    try:
        run = create_run(connection, task_spec, "workspace", "test_model")
    finally:
        connection.close()
    barrier = Barrier(4)

    def write_events(writer):
        connection = connect_database(path)
        try:
            barrier.wait(timeout=10)
            return [
                append_event(
                    connection, run.run_id, EventType.TOOL_INTENT, {"writer": writer, "item": item}
                ).seq
                for item in range(10)
            ]
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=4) as pool:
        sequences = [seq for result in pool.map(write_events, range(4)) for seq in result]
    assert sorted(sequences) == list(range(1, 41))
    connection = connect_database(path)
    try:
        rows = connection.execute("SELECT seq, payload_json FROM events ORDER BY seq").fetchall()
        assert [row["seq"] for row in rows] == list(range(1, 41))
        payloads = [json.loads(row["payload_json"]) for row in rows]
        assert {(data["writer"], data["item"]) for data in payloads} == {
            (writer, item) for writer in range(4) for item in range(10)
        }
        for writer in range(4):
            assert [data["item"] for data in payloads if data["writer"] == writer] == list(range(10))
    finally:
        connection.close()
