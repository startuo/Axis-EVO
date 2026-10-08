from concurrent.futures import ThreadPoolExecutor
from importlib.resources import files
import hashlib
import json
import sqlite3
from threading import Barrier

import pytest

from axis_evo.hashing import canonical_json_bytes
from axis_evo.skill_card import SkillRef, SkillSource, skill_card_from_dict
from axis_evo.skill_manager import SkillIntegrityError, SkillManager
from axis_evo.skill_storage import initialize_skill_schema
from axis_evo.storage import connect_database


@pytest.fixture
def manager(database):
    initialize_skill_schema(database)
    return SkillManager(database)


def _create(manager, skill_id="edit.config", source=None, **changes):
    values = {"name": "配置技能", "description": "", "instructions": "Read, patch, then check.\r\n",
              "allowed_tools": ["read_file", "patch_file", "future_tool"],
              "source": source if source is not None else SkillSource("MANUAL")}
    values.update(changes)
    return manager.create_version(skill_id, **values)


def _derived(card):
    return SkillSource("DERIVED", card.ref)


def _facts(connection):
    return tuple(tuple(tuple(row) for row in connection.execute(f"SELECT * FROM {table} ORDER BY 1, 2"))
                 for table in ("skills", "skill_versions", "skill_state_events"))


def _phase1_facts(connection):
    return (tuple(tuple(row) for row in connection.execute("SELECT * FROM runs ORDER BY run_id")),
            tuple(tuple(row) for row in connection.execute("SELECT * FROM events ORDER BY event_pk")),
            tuple(tuple(row) for row in connection.execute("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE tbl_name IN ('runs','events') ORDER BY name")))


def _pragmas(connection):
    return tuple(connection.execute(f"PRAGMA {name}").fetchone()[0] for name in
                 ("foreign_keys", "journal_mode", "synchronous", "busy_timeout", "recursive_triggers"))


def _raw_version(connection, card, **changes):
    source = card.source.ref
    values = {"skill_id": card.skill_id, "skill_version": card.skill_version, "schema_version": 1,
              "card_json": card.canonical_bytes().decode("utf-8"), "card_sha256": hashlib.sha256(card.canonical_bytes()).hexdigest(),
              "source_kind": card.source.kind, "source_skill_id": source.skill_id if source else None,
              "source_skill_version": source.skill_version if source else None, "created_at": "audit metadata"}
    values.update(changes)
    return connection.execute("""INSERT INTO skill_versions
        (skill_id, skill_version, schema_version, card_json, card_sha256, source_kind, source_skill_id, source_skill_version, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""", tuple(values.values()))


def test_skill_schema_initialization_is_explicit_atomic_and_idempotent(database):
    phase1, settings, factory = _phase1_facts(database), _pragmas(database), database.row_factory
    assert {row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")} == {"runs", "events"}
    instance = SkillManager(database)
    with pytest.raises(sqlite3.OperationalError):
        instance.list_versions("missing")
    assert _phase1_facts(database) == phase1
    initialize_skill_schema(database)
    assert not database.in_transaction
    assert {row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")} == {"runs", "events", "skills", "skill_versions", "skill_state_events"}
    assert len(list(database.execute("SELECT name FROM sqlite_master WHERE type='trigger'"))) == 9
    for table in ("skills", "skill_versions", "skill_state_events"):
        assert "WITHOUT ROWID" in database.execute("SELECT sql FROM sqlite_master WHERE name=?", (table,)).fetchone()[0]
    card = _create(instance)
    instance.promote(card.skill_id, 1, "SHADOW")
    facts, schema = _facts(database), tuple(tuple(row) for row in database.execute("SELECT * FROM sqlite_master ORDER BY name"))
    initialize_skill_schema(database)
    assert _facts(database) == facts
    assert tuple(tuple(row) for row in database.execute("SELECT * FROM sqlite_master ORDER BY name")) == schema
    assert _phase1_facts(database) == phase1
    assert _pragmas(database) == settings and database.row_factory is factory


def test_skill_initializer_rolls_back_partial_schema_on_real_ddl_failure(database):
    database.execute("CREATE VIEW skill_state_events AS SELECT 1 AS existing_fact")
    schema = tuple(tuple(row) for row in database.execute("SELECT * FROM sqlite_master ORDER BY name"))
    with pytest.raises(sqlite3.OperationalError):
        initialize_skill_schema(database)
    assert not database.in_transaction
    assert tuple(tuple(row) for row in database.execute("SELECT * FROM sqlite_master ORDER BY name")) == schema


def test_initializer_requires_phase1_connection_and_foreign_keys(database):
    other = sqlite3.connect(":memory:", isolation_level=None)
    try:
        other.execute("PRAGMA foreign_keys=ON")
        with pytest.raises(ValueError, match="Axis-Evo"):
            initialize_skill_schema(other)
        assert other.execute("SELECT COUNT(*) FROM sqlite_master").fetchone()[0] == 0
    finally:
        other.close()
    database.execute("PRAGMA foreign_keys=OFF")
    with pytest.raises(ValueError, match="foreign_keys"):
        initialize_skill_schema(database)
    assert database.execute("PRAGMA foreign_keys").fetchone()[0] == 0


def test_first_manual_version_and_exact_card_hash(manager):
    phase1 = _phase1_facts(manager.connection)
    card = _create(manager)
    assert card.skill_version == 1 and card.schema_version == 1
    assert card.source.to_dict() == {"kind": "MANUAL"}
    assert manager.get_version(card.skill_id, 1) == card
    assert manager.get_current_state(card.skill_id, 1) == "CANDIDATE"
    assert [(event.transition_seq, event.state) for event in manager.get_state_history(card.skill_id, 1)] == [(1, "CANDIDATE")]
    row = manager.connection.execute("SELECT card_json, card_sha256 FROM skill_versions").fetchone()
    assert row[0].encode("utf-8") == canonical_json_bytes(card.to_dict())
    assert row[1] == hashlib.sha256(row[0].encode("utf-8")).hexdigest()
    assert _phase1_facts(manager.connection) == phase1


def test_second_version_and_contiguous_allocations_preserve_old_bytes(manager):
    first = _create(manager)
    original = tuple(manager.connection.execute("SELECT * FROM skill_versions").fetchone())
    second = _create(manager, source=_derived(first), instructions="Revised procedure")
    third = _create(manager, source=_derived(first))
    assert [card.skill_version for card in manager.list_versions(first.skill_id)] == [1, 2, 3]
    assert second.source.ref == first.ref and third.source.ref == first.ref
    assert manager.get_current_state(first.skill_id, 2) == "CANDIDATE"
    assert tuple(manager.connection.execute("SELECT * FROM skill_versions WHERE skill_version=1").fetchone()) == original
    assert first.canonical_bytes() != second.canonical_bytes()


def test_lifecycle_trust_does_not_inherit_and_hash_or_lineage_never_changes(manager):
    first = _create(manager)
    content = tuple(manager.connection.execute("SELECT * FROM skill_versions").fetchone())
    initial = manager.get_state_history(first.skill_id, 1)[0]
    manager.promote(first.skill_id, 1, "SHADOW")
    assert tuple(manager.connection.execute("SELECT * FROM skill_versions").fetchone()) == content
    manager.promote(first.skill_id, 1, "TRUSTED")
    assert tuple(manager.connection.execute("SELECT * FROM skill_versions").fetchone()) == content
    assert manager.get_state_history(first.skill_id, 1)[0] == initial
    assert [(item.transition_seq, item.state) for item in manager.get_state_history(first.skill_id, 1)] == [(1, "CANDIDATE"), (2, "SHADOW"), (3, "TRUSTED")]
    second = _create(manager, source=_derived(first))
    fork = _create(manager, "fork", source=_derived(first))
    assert manager.get_current_state(first.skill_id, 1) == "TRUSTED"
    assert manager.get_current_state(second.skill_id, 2) == "CANDIDATE"
    assert manager.get_current_state(fork.skill_id, 1) == "CANDIDATE"
    before = tuple(manager.connection.execute("SELECT * FROM skill_versions WHERE skill_id='fork'").fetchone())
    manager.promote("fork", 1, "SHADOW")
    manager.promote("fork", 1, "TRUSTED")
    assert tuple(manager.connection.execute("SELECT * FROM skill_versions WHERE skill_id='fork'").fetchone()) == before
    assert manager.get_version("fork", 1).source.ref == first.ref


@pytest.mark.parametrize("source", [SkillRef("missing", 1), SkillRef("edit.config", 2)])
def test_missing_source_leaves_no_partial_new_skill(manager, source):
    _create(manager)
    before = _facts(manager.connection)
    with pytest.raises(KeyError):
        _create(manager, "new_skill", source=SkillSource("DERIVED", source))
    assert _facts(manager.connection) == before
    assert not manager.connection.in_transaction


def test_manual_revision_is_rejected_without_consuming_version(manager):
    first = _create(manager)
    before = _facts(manager.connection)
    with pytest.raises(ValueError, match="DERIVED"):
        _create(manager)
    assert _facts(manager.connection) == before
    assert _create(manager, source=_derived(first)).skill_version == 2


@pytest.mark.parametrize("table", ["skills", "skill_versions", "skill_state_events"])
@pytest.mark.parametrize("failure", ["ABORT", "IGNORE"])
def test_atomic_creation_rolls_back_on_real_trigger_failure(manager, table, failure):
    connection = manager.connection
    before = _facts(connection)
    action = "RAISE(ABORT, 'injected failure')" if failure == "ABORT" else "RAISE(IGNORE)"
    connection.execute(f"CREATE TEMP TRIGGER fail_creation BEFORE INSERT ON main.{table} BEGIN SELECT {action}; END")
    with pytest.raises(sqlite3.IntegrityError):
        _create(manager)
    assert _facts(connection) == before and not connection.in_transaction
    connection.execute("DROP TRIGGER fail_creation")
    assert _create(manager).skill_version == 1


def _commit_failure(connection, condition):
    connection.execute("CREATE TABLE fault_parent(id INTEGER PRIMARY KEY)")
    connection.execute("CREATE TABLE fault_child(id INTEGER REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED)")
    connection.execute(f"""CREATE TEMP TRIGGER fail_commit AFTER INSERT ON main.skill_state_events
                           WHEN {condition} BEGIN INSERT INTO fault_child VALUES (999); END""")


@pytest.mark.parametrize("operation", ["create", "promote"])
def test_commit_failure_rolls_back_all_skill_facts(manager, operation):
    if operation == "promote":
        _create(manager)
    connection = manager.connection
    _commit_failure(connection, "1")
    before = _facts(connection)
    trace = []
    connection.set_trace_callback(trace.append)
    with pytest.raises(sqlite3.IntegrityError):
        _create(manager) if operation == "create" else manager.promote("edit.config", 1, "SHADOW")
    connection.set_trace_callback(None)
    assert _facts(connection) == before and not connection.in_transaction
    assert connection.execute("SELECT COUNT(*) FROM fault_child").fetchone()[0] == 0
    assert any(item == "COMMIT" for item in trace) and trace[-1] == "ROLLBACK"
    connection.execute("DROP TRIGGER fail_commit")
    if operation == "create":
        assert _create(manager).skill_version == 1
    else:
        assert manager.promote("edit.config", 1, "SHADOW").transition_seq == 2


@pytest.mark.parametrize("failure", ["ABORT", "IGNORE"])
def test_failed_revision_does_not_advance_version(manager, failure):
    first = _create(manager)
    connection = manager.connection
    action = "RAISE(ABORT, 'injected failure')" if failure == "ABORT" else "RAISE(IGNORE)"
    connection.execute(f"CREATE TEMP TRIGGER fail_revision BEFORE INSERT ON main.skill_state_events WHEN NEW.skill_version=2 BEGIN SELECT {action}; END")
    before = _facts(connection)
    with pytest.raises(sqlite3.IntegrityError):
        _create(manager, source=_derived(first))
    assert _facts(connection) == before
    connection.execute("DROP TRIGGER fail_revision")
    assert _create(manager, source=_derived(first)).skill_version == 2


@pytest.mark.parametrize("failure", ["ABORT", "IGNORE"])
def test_failed_promotion_does_not_advance_transition_sequence(manager, failure):
    _create(manager)
    connection = manager.connection
    action = "RAISE(ABORT, 'injected failure')" if failure == "ABORT" else "RAISE(IGNORE)"
    connection.execute(f"CREATE TEMP TRIGGER fail_promotion BEFORE INSERT ON main.skill_state_events WHEN NEW.transition_seq=2 BEGIN SELECT {action}; END")
    before = _facts(connection)
    with pytest.raises(sqlite3.IntegrityError):
        manager.promote("edit.config", 1, "SHADOW")
    assert _facts(connection) == before
    connection.execute("DROP TRIGGER fail_promotion")
    assert manager.promote("edit.config", 1, "SHADOW").transition_seq == 2


@pytest.mark.parametrize("current,target", [
    ("CANDIDATE", "TRUSTED"), ("CANDIDATE", "CANDIDATE"), ("SHADOW", "CANDIDATE"),
    ("SHADOW", "SHADOW"), ("TRUSTED", "CANDIDATE"), ("TRUSTED", "SHADOW"), ("TRUSTED", "TRUSTED"),
])
def test_invalid_lifecycle_transitions_preserve_history(manager, current, target):
    _create(manager)
    if current != "CANDIDATE":
        manager.promote("edit.config", 1, "SHADOW")
    if current == "TRUSTED":
        manager.promote("edit.config", 1, "TRUSTED")
    before = _facts(manager.connection)
    with pytest.raises(ValueError):
        manager.promote("edit.config", 1, target)
    assert _facts(manager.connection) == before


@pytest.mark.parametrize("statement", [
    "UPDATE skills SET skill_id='renamed'", "UPDATE skills SET created_at='changed'", "DELETE FROM skills",
    "UPDATE skill_versions SET card_json='{}'", "UPDATE skill_versions SET card_sha256='bad'",
    "UPDATE skill_versions SET source_kind='DERIVED', source_skill_id='other', source_skill_version=1",
    "UPDATE skill_versions SET created_at='changed'", "DELETE FROM skill_versions",
    "UPDATE skill_state_events SET state='TRUSTED'", "UPDATE skill_state_events SET transition_seq=9", "DELETE FROM skill_state_events",
])
def test_immutable_rows_reject_direct_sql_mutation(manager, statement):
    _create(manager)
    manager.promote("edit.config", 1, "SHADOW")
    before = _facts(manager.connection)
    with pytest.raises(sqlite3.IntegrityError):
        manager.connection.execute(statement)
    assert _facts(manager.connection) == before


@pytest.mark.parametrize("table", ["skills", "skill_versions", "skill_state_events"])
@pytest.mark.parametrize("recursive", [0, 1])
def test_replace_cannot_bypass_immutability(manager, table, recursive):
    _create(manager)
    connection = manager.connection
    connection.execute(f"PRAGMA recursive_triggers={recursive}")
    row = tuple(connection.execute(f"SELECT * FROM {table}").fetchone())
    before = _facts(connection)
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(f"INSERT OR REPLACE INTO {table} VALUES ({','.join('?' for _ in row)})", row)
    assert _facts(connection) == before
    with pytest.raises(sqlite3.OperationalError):
        connection.execute(f"INSERT OR REPLACE INTO {table}(rowid) VALUES (1)")
    assert _facts(connection) == before


@pytest.mark.parametrize("changes", [
    {"skill_version": 3, "source_kind": "DERIVED", "source_skill_id": "edit.config", "source_skill_version": 1},
    {"skill_version": 2}, {"skill_version": 2, "source_kind": "DERIVED", "source_skill_id": "edit.config", "source_skill_version": 2},
    {"skill_version": 2, "source_kind": "DERIVED", "source_skill_id": "missing", "source_skill_version": 1},
    {"skill_version": 2, "source_kind": "DERIVED", "source_skill_id": "edit.config", "source_skill_version": 3},
    {"skill_version": 2, "source_kind": "DERIVED", "source_skill_id": "edit.config", "source_skill_version": None},
])
def test_sql_rejects_skipped_manual_missing_self_or_forward_source(manager, changes):
    first = _create(manager)
    before = _facts(manager.connection)
    with pytest.raises(sqlite3.IntegrityError):
        _raw_version(manager.connection, first, **changes)
    assert _facts(manager.connection) == before


@pytest.mark.parametrize("field,value", [
    ("skill_version", 1.5), ("skill_version", "abc"), ("schema_version", 2),
    ("card_sha256", "A" * 64), ("card_sha256", "g" * 64), ("card_sha256", "a" * 63),
])
def test_schema_checks_reject_invalid_version_fields(manager, field, value):
    first = _create(manager)
    before = _facts(manager.connection)
    changes = {"skill_version": 2, "source_kind": "DERIVED", "source_skill_id": first.skill_id, "source_skill_version": 1, field: value}
    with pytest.raises(sqlite3.IntegrityError):
        _raw_version(manager.connection, first, **changes)
    assert _facts(manager.connection) == before


@pytest.mark.parametrize("seq,state", [(2, "SHADOW"), (1, "TRUSTED"), (1, "SHADOW"), (3, "TRUSTED"), (2, "CANDIDATE"), (4, "TRUSTED")])
def test_sql_lifecycle_backstop_rejects_invalid_initial_or_next_transition(manager, seq, state):
    card = _create(manager)
    before = _facts(manager.connection)
    if seq == 2 and state == "SHADOW":
        manager.connection.execute("DROP TRIGGER skill_state_events_no_delete")
        manager.connection.execute("DELETE FROM skill_state_events")
        before = _facts(manager.connection)
    with pytest.raises(sqlite3.IntegrityError):
        manager.connection.execute("INSERT INTO skill_state_events VALUES (?, 1, ?, ?, 'audit metadata')", (card.skill_id, seq, state))
    assert _facts(manager.connection) == before


def test_caller_mutation_before_begin_and_after_commit_cannot_change_card(manager):
    tools = ["read_file", "patch_file"]
    def mutate_on_begin(statement):
        if statement == "BEGIN IMMEDIATE":
            tools.append("write_file")
    manager.connection.set_trace_callback(mutate_on_begin)
    card = _create(manager, allowed_tools=tools)
    manager.connection.set_trace_callback(None)
    tools.clear()
    data = card.to_dict()
    data["allowed_tools"].append("run_tests")
    assert manager.get_version(card.skill_id, 1).allowed_tools == ("read_file", "patch_file")


@pytest.mark.parametrize("operation", ["initialize", "create", "promote"])
def test_skill_write_rejects_and_preserves_active_caller_transaction(database, operation):
    initialize_skill_schema(database)
    manager = SkillManager(database)
    if operation == "promote":
        _create(manager)
    before = _facts(database)
    database.execute("CREATE TABLE caller_note(value TEXT)")
    database.execute("BEGIN IMMEDIATE")
    database.execute("INSERT INTO caller_note VALUES ('uncommitted')")
    with pytest.raises(ValueError, match="caller transaction"):
        if operation == "initialize":
            initialize_skill_schema(database)
        elif operation == "create":
            _create(manager, "new")
        else:
            manager.promote("edit.config", 1, "SHADOW")
    assert database.in_transaction
    assert database.execute("SELECT COUNT(*) FROM caller_note").fetchone()[0] == 1
    assert _facts(database) == before
    database.rollback()
    assert database.execute("SELECT COUNT(*) FROM caller_note").fetchone()[0] == 0


def test_query_only_reads_never_write_initialize_or_change_connection_settings(manager):
    first = _create(manager)
    _create(manager, source=_derived(first))
    manager.promote(first.skill_id, 1, "SHADOW")
    before, phase1, settings = _facts(manager.connection), _phase1_facts(manager.connection), _pragmas(manager.connection)
    manager.connection.row_factory = None
    manager.connection.execute("PRAGMA query_only=ON")
    trace = []
    manager.connection.set_trace_callback(trace.append)
    assert manager.get_version(first.skill_id, 1) == first
    assert len(manager.list_versions(first.skill_id)) == 2
    assert manager.get_current_state(first.skill_id, 1) == "SHADOW"
    assert len(manager.get_state_history(first.skill_id, 1)) == 2
    manager.connection.set_trace_callback(None)
    assert all(statement.lstrip().upper().startswith("SELECT") for statement in trace)
    assert _facts(manager.connection) == before and _phase1_facts(manager.connection) == phase1
    assert _pragmas(manager.connection) == settings
    assert manager.connection.row_factory is None
    assert manager.connection.execute("PRAGMA query_only").fetchone()[0] == 1


@pytest.mark.parametrize("corruption", ["hash", "card_id", "card_version", "row_version", "schema", "source", "pretty_json", "unknown_key"])
def test_get_version_rejects_persisted_disagreement_without_repair(manager, corruption):
    card = _create(manager)
    connection = manager.connection
    connection.execute("DROP TRIGGER skill_versions_no_update")
    connection.execute("PRAGMA ignore_check_constraints=ON")
    connection.execute("PRAGMA foreign_keys=OFF")
    data = card.to_dict()
    target_version = 1
    if corruption == "hash":
        connection.execute("UPDATE skill_versions SET card_sha256=?", ("0" * 64,))
    elif corruption == "row_version":
        connection.execute("UPDATE skill_versions SET skill_version=2")
        target_version = 2
    elif corruption == "schema":
        connection.execute("UPDATE skill_versions SET schema_version=2")
    elif corruption == "source":
        connection.execute("UPDATE skill_versions SET source_kind='DERIVED', source_skill_id='missing', source_skill_version=1")
    elif corruption == "pretty_json":
        connection.execute("UPDATE skill_versions SET card_json=?", (json.dumps(data, ensure_ascii=False, indent=2),))
    else:
        data[{"card_id": "skill_id", "card_version": "skill_version", "unknown_key": "state"}[corruption]] = {"card_id": "other", "card_version": 2, "unknown_key": "TRUSTED"}[corruption]
        encoded = canonical_json_bytes(data)
        connection.execute("UPDATE skill_versions SET card_json=?, card_sha256=?", (encoded.decode(), hashlib.sha256(encoded).hexdigest()))
    before = _facts(connection)
    with pytest.raises(SkillIntegrityError):
        manager.get_version(card.skill_id, target_version)
    assert _facts(connection) == before


@pytest.mark.parametrize("corruption", ["missing_initial", "gap", "repeat", "skip", "empty", "after_trusted"])
def test_all_lifecycle_read_and_promote_apis_reject_corrupted_history(manager, corruption):
    card = _create(manager)
    manager.promote(card.skill_id, 1, "SHADOW")
    manager.promote(card.skill_id, 1, "TRUSTED")
    connection = manager.connection
    for trigger in ("skill_state_events_no_update", "skill_state_events_no_delete", "skill_state_events_insert_guard"):
        connection.execute(f"DROP TRIGGER {trigger}")
    connection.execute("PRAGMA ignore_check_constraints=ON")
    statements = {
        "missing_initial": "DELETE FROM skill_state_events WHERE transition_seq=1",
        "gap": "DELETE FROM skill_state_events WHERE transition_seq=2",
        "repeat": "UPDATE skill_state_events SET state='CANDIDATE' WHERE transition_seq=2",
        "skip": "UPDATE skill_state_events SET state='TRUSTED' WHERE transition_seq=2",
        "empty": "DELETE FROM skill_state_events",
        "after_trusted": "INSERT INTO skill_state_events VALUES ('edit.config',1,4,'TRUSTED','later')",
    }
    connection.execute(statements[corruption])
    before = _facts(connection)
    for read in (manager.get_version, manager.get_current_state, manager.get_state_history):
        with pytest.raises(SkillIntegrityError):
            read(card.skill_id, 1)
    with pytest.raises(SkillIntegrityError):
        manager.promote(card.skill_id, 1, "SHADOW")
    assert _facts(connection) == before


@pytest.mark.parametrize("corruption", ["missing", "cycle", "same_skill_forward"])
def test_read_and_derived_creation_reject_corrupt_lineage(manager, corruption):
    first = _create(manager, "a")
    other = _create(manager, "b", source=_derived(first))
    if corruption == "same_skill_forward":
        other = _create(manager, "a", source=_derived(first))
    source = SkillSource("DERIVED", SkillRef("missing", 1)) if corruption == "missing" else _derived(other)
    data = first.to_dict()
    data["source"] = source.to_dict()
    encoded = canonical_json_bytes(data)
    connection = manager.connection
    connection.execute("DROP TRIGGER skill_versions_no_update")
    connection.execute("PRAGMA foreign_keys=OFF")
    connection.execute("""UPDATE skill_versions SET card_json=?, card_sha256=?, source_kind='DERIVED',
                          source_skill_id=?, source_skill_version=? WHERE skill_id='a' AND skill_version=1""",
                       (encoded.decode(), hashlib.sha256(encoded).hexdigest(), source.ref.skill_id, source.ref.skill_version))
    connection.execute("PRAGMA foreign_keys=ON")
    before = _facts(connection)
    with pytest.raises(SkillIntegrityError):
        manager.get_version("a", 1)
    with pytest.raises(SkillIntegrityError):
        _create(manager, "fork", source=_derived(first))
    assert _facts(connection) == before


def test_orphan_identity_or_version_is_detected_not_repaired(manager):
    connection = manager.connection
    connection.execute("INSERT INTO skills VALUES ('orphan','audit metadata')")
    before = _facts(connection)
    with pytest.raises(SkillIntegrityError):
        _create(manager, "orphan")
    assert _facts(connection) == before
    data = {"schema_version": 1, "skill_id": "orphan", "skill_version": 1, "name": "orphan", "description": "", "instructions": "steps", "allowed_tools": [], "source": {"kind": "MANUAL"}}
    _raw_version(connection, skill_card_from_dict(data))
    before = _facts(connection)
    with pytest.raises(SkillIntegrityError):
        manager.get_version("orphan", 1)
    assert _facts(connection) == before


def test_version_allocation_and_state_order_are_inside_owned_transactions(manager, monkeypatch):
    trace = []
    manager.connection.set_trace_callback(trace.append)
    card = _create(manager)
    manager.connection.set_trace_callback(None)
    begin = next(i for i, sql in enumerate(trace) if sql == "BEGIN IMMEDIATE")
    allocation = next(i for i, sql in enumerate(trace) if "SELECT COUNT(*)" in sql)
    insert = next(i for i, sql in enumerate(trace) if "INSERT INTO skill_versions" in sql)
    assert begin < allocation < insert < trace.index("COMMIT")
    times = iter(["9000-later", "1000-earlier"])
    monkeypatch.setattr("axis_evo.skill_manager.utc_now", lambda: next(times))
    manager.promote(card.skill_id, 1, "SHADOW")
    manager.promote(card.skill_id, 1, "TRUSTED")
    assert manager.get_current_state(card.skill_id, 1) == "TRUSTED"
    assert [item.transition_seq for item in manager.get_state_history(card.skill_id, 1)] == [1, 2, 3]


def test_concurrent_version_allocation_is_contiguous_and_durable(tmp_path):
    path = tmp_path / "concurrent.sqlite3"
    connection = connect_database(path)
    try:
        initialize_skill_schema(connection)
        first = _create(SkillManager(connection))
    finally:
        connection.close()
    barrier = Barrier(6)
    def writer(index):
        database = connect_database(path)
        try:
            barrier.wait(timeout=10)
            card = _create(SkillManager(database), source=_derived(first), instructions=f"revision {index}")
            assert not database.in_transaction
            return card.skill_version
        finally:
            database.close()
    with ThreadPoolExecutor(max_workers=6) as pool:
        versions = list(pool.map(writer, range(6)))
    assert sorted(versions) == list(range(2, 8))
    observer = sqlite3.connect(path)
    try:
        assert observer.execute("SELECT skill_version FROM skill_versions ORDER BY skill_version").fetchall() == [(i,) for i in range(1, 8)]
        assert observer.execute("SELECT COUNT(*) FROM skill_state_events WHERE state='CANDIDATE' AND transition_seq=1").fetchone()[0] == 7
    finally:
        observer.close()


@pytest.mark.parametrize("collision", ["rowid_table", "weak_trigger", "unexpected_trigger"])
def test_initializer_rejects_existing_weakened_or_unexpected_schema_atomically(database, collision):
    schema = files("axis_evo").joinpath("migrations", "002_phase2_skills.sql").read_text(encoding="utf-8")
    if collision == "rowid_table":
        start = schema.index("CREATE TABLE IF NOT EXISTS skill_state_events")
        schema = schema[:start] + schema[start:].replace(") WITHOUT ROWID;", ");", 1)
    database.executescript(schema)
    if collision == "weak_trigger":
        database.execute("DROP TRIGGER skill_versions_no_update")
        database.execute("CREATE TRIGGER skill_versions_no_update BEFORE UPDATE ON skill_versions BEGIN SELECT 1; END")
    elif collision == "unexpected_trigger":
        database.execute("CREATE TRIGGER extra_policy BEFORE INSERT ON skill_versions BEGIN SELECT 1; END")
    before = tuple(tuple(row) for row in database.execute("SELECT * FROM sqlite_master ORDER BY name"))
    settings = _pragmas(database)
    with pytest.raises(sqlite3.IntegrityError, match="schema differs"):
        initialize_skill_schema(database)
    assert not database.in_transaction
    assert tuple(tuple(row) for row in database.execute("SELECT * FROM sqlite_master ORDER BY name")) == before
    assert _pragmas(database) == settings


@pytest.mark.parametrize("affected", ["target", "ancestor"])
def test_missing_middle_version_is_rejected_by_reads_promotion_and_derivation(manager, affected):
    first = _create(manager, "a")
    _create(manager, "a", source=_derived(first))
    third = _create(manager, "a", source=_derived(first))
    target = third if affected == "target" else _create(manager, "b", source=_derived(third))
    connection = manager.connection
    connection.execute("DROP TRIGGER skill_versions_no_delete")
    connection.execute("DROP TRIGGER skill_state_events_no_delete")
    connection.execute("PRAGMA foreign_keys=OFF")
    connection.execute("DELETE FROM skill_state_events WHERE skill_id='a' AND skill_version=2")
    connection.execute("DELETE FROM skill_versions WHERE skill_id='a' AND skill_version=2")
    connection.execute("PRAGMA foreign_keys=ON")
    before = _facts(connection)
    for read in (manager.get_version, manager.get_current_state, manager.get_state_history):
        with pytest.raises(SkillIntegrityError, match="contiguous"):
            read(target.skill_id, target.skill_version)
    with pytest.raises(SkillIntegrityError):
        manager.list_versions(target.skill_id)
    with pytest.raises(SkillIntegrityError):
        manager.promote(target.skill_id, target.skill_version, "SHADOW")
    with pytest.raises(SkillIntegrityError):
        _create(manager, "fork", source=_derived(target))
    assert _facts(connection) == before


def test_version_with_missing_logical_identity_is_rejected_without_repair(manager):
    first = _create(manager)
    connection = manager.connection
    connection.execute("DROP TRIGGER skills_no_delete")
    connection.execute("PRAGMA foreign_keys=OFF")
    connection.execute("DELETE FROM skills")
    connection.execute("PRAGMA foreign_keys=ON")
    before = _facts(connection)
    with pytest.raises(SkillIntegrityError):
        manager.get_version(first.skill_id, 1)
    assert _facts(connection) == before


@pytest.mark.parametrize("invalid_version", [0, -1, 1.5])
def test_invalid_earlier_version_cannot_hide_behind_count_equal_max(manager, invalid_version):
    first = _create(manager, "a")
    other = _create(manager, "b")
    second = _create(manager, "a", source=_derived(other))
    connection = manager.connection
    connection.execute("DROP TRIGGER skill_versions_no_update")
    connection.execute("DROP TRIGGER skill_state_events_no_update")
    connection.execute("PRAGMA foreign_keys=OFF")
    connection.execute("PRAGMA ignore_check_constraints=ON")
    connection.execute("UPDATE skill_versions SET skill_version=? WHERE skill_id='a' AND skill_version=1", (invalid_version,))
    connection.execute("UPDATE skill_state_events SET skill_version=? WHERE skill_id='a' AND skill_version=1", (invalid_version,))
    connection.execute("PRAGMA ignore_check_constraints=OFF")
    connection.execute("PRAGMA foreign_keys=ON")
    count, maximum = connection.execute("SELECT COUNT(*), MAX(skill_version) FROM skill_versions WHERE skill_id='a'").fetchone()
    assert count == maximum == 2
    before = _facts(connection)
    for read in (manager.get_version, manager.get_current_state, manager.get_state_history):
        with pytest.raises(SkillIntegrityError):
            read(second.skill_id, second.skill_version)
    with pytest.raises(SkillIntegrityError):
        manager.list_versions("a")
    with pytest.raises(SkillIntegrityError):
        manager.promote("a", 2, "SHADOW")
    with pytest.raises(SkillIntegrityError):
        _create(manager, "a", source=_derived(second))
    with pytest.raises(SkillIntegrityError):
        _create(manager, "fork", source=_derived(second))
    assert _facts(connection) == before


def test_initializer_commit_failure_rolls_back_all_migration_objects(database):
    before = tuple(tuple(row) for row in database.execute("SELECT * FROM sqlite_master ORDER BY name"))
    def deny_commit(action, arg1, arg2, database_name, trigger):
        if action == sqlite3.SQLITE_TRANSACTION and arg1 == "COMMIT":
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK
    database.set_authorizer(deny_commit)
    try:
        with pytest.raises(sqlite3.DatabaseError, match="not authorized"):
            initialize_skill_schema(database)
    finally:
        database.set_authorizer(None)
    assert not database.in_transaction
    assert tuple(tuple(row) for row in database.execute("SELECT * FROM sqlite_master ORDER BY name")) == before
    initialize_skill_schema(database)
