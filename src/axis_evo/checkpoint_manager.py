"""Bounded artifact evidence anchored to committed events, never restoration.

A controlled boundary is a trusted caller assertion of exclusive execution,
not an OS lock. Sampling detects visible changes, not adversarial ABA races.
SQLite atomically publishes metadata and BLOBs, not the live filesystem.
"""

from dataclasses import asdict, dataclass
import hashlib
import os
from pathlib import Path
import re
import stat
from uuid import uuid4

from .checkpoint_storage import (
    CheckpointIntegrityError, CheckpointRecord, MAX_ENTRIES, MAX_FILE_BYTES,
    MAX_TOTAL_BYTES, MAX_MANIFEST_BYTES, MAX_SNAPSHOT_BYTES, _guard_schema,
)
from .events import EventType, utc_now
from .hashing import canonical_json_bytes
from .inspector import inspect_run, _payload
from .planning_adapter import _strict_json, _text
from .planning_provenance import _load as _load_proposal, inspect_planning_provenance
from .sandbox import Sandbox
from .skill_binding import _authorized_card, _read_snapshot, _rows, inspect_skill_trace
from .skill_card import SkillRef
from .skill_planner import _static_path, _task_data
from .skill_storage import _check_write_context, _insert_one, _skill_transaction
from .task_spec import task_spec_from_dict


_HASH = re.compile(r"[0-9a-f]{64}\Z")
_RUN_IDENTITY = ("run_id", "task_id", "task_spec_json", "task_spec_sha256",
                 "workspace_path", "model_plugin", "started_at")
_EVENT_FIELDS = ("event_id", "schema_version", "run_id", "task_id", "seq",
                 "event_type", "step_id", "tool_call_id", "occurred_at")


@dataclass(frozen=True)
class ControlledCaptureBoundary:
    """Caller holds exclusive execution until capture returns (including error).

    The identifier documents that caller's cooperative barrier. It does not
    authenticate the caller or prevent another process from writing files.
    """
    run_id: str
    event_cursor_seq: int
    exclusive_execution_id: str


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _json(text, limit):
    value = _strict_json(text, limit)
    if canonical_json_bytes(value).decode("utf-8") != text:
        raise CheckpointIntegrityError("Noncanonical evidence bytes")
    return value


def _raw(connection, run_id, cursor=None):
    rows = _rows(connection, "SELECT * FROM main.runs WHERE run_id=?", (run_id,))
    if len(rows) != 1:
        raise CheckpointIntegrityError("Run does not exist uniquely")
    suffix, args = ("", (run_id,)) if cursor is None else (" AND seq<=?", (run_id, cursor))
    events = [dict(r) for r in _rows(connection,
        "SELECT * FROM main.events WHERE run_id=?" + suffix + " ORDER BY seq", args)]
    bindings = [dict(r) for r in _rows(connection,
        "SELECT * FROM main.skill_invocation_bindings WHERE run_id=? ORDER BY tool_call_id", (run_id,))]
    if cursor is not None:
        calls = {r["tool_call_id"] for r in events}
        bindings = [r for r in bindings if r["tool_call_id"] in calls]
    links = [dict(r) for r in _rows(connection,
        "SELECT * FROM main.plan_run_links WHERE run_id=?", (run_id,))]
    refs = {(r["skill_id"], r["skill_version"]) for r in bindings}
    proposals = []
    for link in links:
        proposals.extend(dict(r) for r in _rows(connection,
            "SELECT * FROM main.plan_proposals WHERE proposal_id=?", (link["proposal_id"],)))
    refs.update((r["skill_id"], r["skill_version"]) for r in proposals)
    versions, states = [], []
    for sid, version in sorted(refs):
        versions.extend(dict(r) for r in _rows(connection,
            "SELECT * FROM main.skill_versions WHERE skill_id=? AND skill_version=?", (sid, version)))
        states.extend(dict(r) for r in _rows(connection,
            "SELECT * FROM main.skill_state_events WHERE skill_id=? AND skill_version=? ORDER BY transition_seq", (sid, version)))
    return {"run": dict(rows[0]), "events": events, "bindings": bindings,
            "links": links, "proposals": proposals, "versions": versions, "states": states}


def _prefix(raw, cursor):
    run, events = raw["run"], raw["events"]
    if type(cursor) is not int or cursor < 1 or len(events) != cursor:
        raise CheckpointIntegrityError("Missing or invalid event cursor")
    seen, ordered = set(), []
    for n, event in enumerate(events, 1):
        if (type(event["seq"]) is not int or event["seq"] != n
                or type(event["schema_version"]) is not int or event["schema_version"] != 1
                or event["run_id"] != run["run_id"] or event["task_id"] != run["task_id"]
                or event["event_id"] in seen):
            raise CheckpointIntegrityError("Event prefix identity or sequence mismatch")
        for key in _EVENT_FIELDS:
            if key not in ("schema_version", "seq") and (event[key] is not None or key not in ("step_id", "tool_call_id")):
                _text(event[key])
        EventType(event["event_type"])
        payload = _json(event["payload_json"], max(MAX_SNAPSHOT_BYTES, len(event["payload_json"].encode("utf-8"))))
        issues = []
        if type(payload) is not dict or _payload(event, issues) is None or issues:
            raise CheckpointIntegrityError("Invalid event payload")
        if event["event_type"] in ("STEP_PLANNED", "TOOL_INTENT", "TOOL_RESULT", "STEP_CONFIRMED"):
            _text(event["tool_call_id"])
        seen.add(event["event_id"])
        ordered.append({**{k: event[k] for k in _EVENT_FIELDS}, "payload": payload})
    return _sha(canonical_json_bytes({"schema_version": 1, "events": ordered}))


def _task_identity(run):
    for key in _RUN_IDENTITY:
        _text(run[key])
    task = task_spec_from_dict(_json(run["task_spec_json"], MAX_SNAPSHOT_BYTES))
    if task.task_id != run["task_id"] or _sha(canonical_json_bytes(_task_data(task))) != run["task_spec_sha256"]:
        raise CheckpointIntegrityError("Run TaskSpec integrity mismatch")
    return {key: run[key] for key in _RUN_IDENTITY}


def _skill_identity(connection, raw):
    refs = {(b["skill_id"], b["skill_version"], b["card_sha256"]) for b in raw["bindings"]}
    refs.update((p["skill_id"], p["skill_version"], p["card_sha256"]) for p in raw["proposals"])
    if not refs:
        return None
    if len(refs) != 1:
        raise CheckpointIntegrityError("Checkpoint requires one exact Skill identity")
    sid, version, digest = next(iter(refs))
    card = _authorized_card(connection, SkillRef(sid, version), ())
    if _sha(card.canonical_bytes()) != digest:
        raise CheckpointIntegrityError("Skill Card digest mismatch")
    return {"skill_id": sid, "skill_version": version, "card_sha256": digest}


def _plan_identity(connection, raw):
    if not raw["links"]:
        if raw["proposals"]:
            raise CheckpointIntegrityError("Proposal has no Run link")
        return None
    if len(raw["links"]) != 1 or len(raw["proposals"]) != 1:
        raise CheckpointIntegrityError("Plan association is not unique")
    link = raw["links"][0]
    proposal = _load_proposal(connection, link["proposal_id"])
    if (link["approved_plan_sha256"] != proposal.plan_sha256
            or proposal.task_spec_sha256 != raw["run"]["task_spec_sha256"]):
        raise CheckpointIntegrityError("Approved Plan and Run identity mismatch")
    return {"proposal_id": proposal.proposal_id, "plan_sha256": proposal.plan_sha256,
            "approved_plan_sha256": link["approved_plan_sha256"]}


def _unsafe_link(info):
    return (stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0)
            & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)))


def _directory(value):
    path = Path(_text(os.fspath(value)))
    if not path.is_absolute():
        raise ValueError("Checkpoint workspace must be absolute")
    for part in (path, *path.parents):
        if _unsafe_link(part.lstat()):
            raise ValueError("Checkpoint rejects redirected workspace ancestors")
    root = path.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Checkpoint workspace must be a directory")
    return root


def _fingerprint(info):
    # Windows 3.12 path-stat and CRT fd-stat can expose different creation-time
    # semantics after copy2. Use identity, size and mtime across those APIs;
    # two complete byte samples below provide the content comparison.
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns if os.name != "nt" else None)


def _capture_workspace(workspace):
    root = _directory(workspace)
    sandbox = Sandbox(root)
    entries, artifacts, total = [], {}, 0

    def visit(directory):
        nonlocal total
        before = _fingerprint(directory.lstat())
        children = sorted(directory.iterdir(), key=lambda p: p.name)
        for path in children:
            if len(entries) >= MAX_ENTRIES:
                raise ValueError("Checkpoint exceeds entry limit")
            relative = path.relative_to(root).as_posix()
            _static_path(relative)
            sandbox.resolver.resolve(relative)
            info = path.lstat()
            if _unsafe_link(info):
                raise ValueError("Checkpoint rejects symlink/reparse entries")
            if stat.S_ISDIR(info.st_mode):
                entries.append({"path": relative, "type": "directory"})
                visit(path)
            elif stat.S_ISREG(info.st_mode):
                # A hard link can alias bytes outside the workspace. Reject all
                # multi-link regular files instead of pretending to prove origin.
                if info.st_nlink != 1:
                    raise ValueError("Checkpoint rejects hard-linked files")
                limit = min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - total)
                if info.st_size > limit:
                    raise ValueError("Checkpoint exceeds byte limit")
                flags = (os.O_RDONLY | getattr(os, "O_BINARY", 0)
                         | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
                fd = os.open(path, flags)
                with os.fdopen(fd, "rb") as stream:
                    opened = os.fstat(stream.fileno())
                    if _fingerprint(info) != _fingerprint(opened) or not stat.S_ISREG(opened.st_mode):
                        raise CheckpointIntegrityError("File changed during checkpoint capture")
                    data = stream.read(limit + 1)
                    after = os.fstat(stream.fileno())
                if (len(data) > limit or _fingerprint(info) != _fingerprint(after)
                        or _fingerprint(info) != _fingerprint(path.lstat())):
                    raise CheckpointIntegrityError("File changed during checkpoint capture")
                total += len(data)
                artifacts[relative] = data
                entries.append({"path": relative, "type": "file", "size_bytes": len(data), "sha256": _sha(data)})
            else:
                raise ValueError("Checkpoint supports regular files and directories only")
        if before != _fingerprint(directory.lstat()):
            raise CheckpointIntegrityError("Directory changed during checkpoint capture")
    visit(root)
    text = canonical_json_bytes({"schema_version": 1, "entries": entries}).decode("utf-8")
    _manifest(text)
    return text, artifacts


def _manifest(text):
    from .agent_episode_storage import _validate_manifest
    value = _validate_manifest(text)
    # Limits intentionally equal the existing bounded seed manifest protocol.
    if len(text.encode("utf-8")) > MAX_MANIFEST_BYTES or len(value["entries"]) > MAX_ENTRIES:
        raise CheckpointIntegrityError("Checkpoint manifest exceeds bounds")
    return value


def _admit(raw, boundary):
    events, run = raw["events"], raw["run"]
    recorded_calls = {e["tool_call_id"] for e in events}
    if any(b["tool_call_id"] not in recorded_calls for b in raw["bindings"]):
        raise CheckpointIntegrityError("Unstarted Skill binding lies beyond checkpoint event prefix")
    calls = {e["tool_call_id"] for e in events if e["event_type"] == "TOOL_RESULT"}
    pending = [e["tool_call_id"] for e in events if e["event_type"] == "TOOL_INTENT" and e["tool_call_id"] not in calls]
    if pending:
        raise CheckpointIntegrityError("Unresolved TOOL_INTENT: " + ", ".join(pending))
    if run["status"] in ("COMPLETED", "FAILED") and run["ended_at"] is not None:
        return "TERMINAL", None
    if (run["status"] != "RUNNING" or run["ended_at"] is not None
            or type(boundary) is not ControlledCaptureBoundary
            or boundary.run_id != run["run_id"] or type(boundary.event_cursor_seq) is not int
            or boundary.event_cursor_seq != len(events) or not events
            or events[-1]["event_type"] != "STEP_CONFIRMED"):
        raise CheckpointIntegrityError("RUNNING checkpoint requires an exact exclusive STEP_CONFIRMED barrier")
    _text(boundary.exclusive_execution_id)
    return "CONTROLLED_STEP", asdict(boundary)


def create_checkpoint(connection, run_id, workspace_path, *, capture_boundary=None):
    """Capture evidence only. Caller excludes execution and external writers.

    Metadata and every bounded BLOB publish together at successful COMMIT.
    The sampled filesystem is not part of that SQLite atomic transaction.
    """
    _text(run_id)
    _check_write_context(connection)
    with _read_snapshot(connection):
        _guard_schema(connection)
        before = _raw(connection, run_id)
        cursor = len(before["events"])
        prefix = _prefix(before, cursor)
        identity = _task_identity(before["run"])
        skill, plan = _skill_identity(connection, before), _plan_identity(connection, before)
        kind, boundary = _admit(before, capture_boundary)
    root = _directory(workspace_path)
    if (_directory(before["run"]["workspace_path"]) != root
            or before["run"]["workspace_path"] != str(root)):
        raise CheckpointIntegrityError("Workspace is not bound to Run")
    # Reuse frozen validators without nesting their owned read transactions.
    for report, valid in ((inspect_run(connection, run_id), lambda r: r["trace"]["consistent"]),
                          (inspect_skill_trace(connection, run_id), lambda r: r["consistent"]),
                          (inspect_planning_provenance(connection, run_id), lambda r: r["consistent"])):
        if not valid(report):
            raise CheckpointIntegrityError("Run evidence cannot certify a checkpoint")
    manifest, artifacts = _capture_workspace(root)
    with _read_snapshot(connection):
        _guard_schema(connection)
        if _raw(connection, run_id) != before:
            raise CheckpointIntegrityError("Execution evidence changed during capture")
    again, again_artifacts = _capture_workspace(root)
    if (again, again_artifacts) != (manifest, artifacts):
        raise CheckpointIntegrityError("Workspace changed during checkpoint capture")
    metadata = dict(checkpoint_id="checkpoint_" + uuid4().hex, schema_version=1,
        run_id=run_id, checkpoint_kind=kind, event_cursor_seq=cursor, event_prefix_sha256=prefix,
        task_spec_sha256=identity["task_spec_sha256"],
        skill_id=skill["skill_id"] if skill else None, skill_version=skill["skill_version"] if skill else None,
        card_sha256=skill["card_sha256"] if skill else None,
        proposal_id=plan["proposal_id"] if plan else None, plan_sha256=plan["plan_sha256"] if plan else None,
        workspace_root=str(root), workspace_manifest_json=manifest,
        workspace_manifest_sha256=_sha(manifest.encode("utf-8")), captured_at=utc_now())
    snapshot = {"schema_version": 1, "metadata": metadata, "run_identity": identity,
        "captured_run_state": {k: before["run"][k] for k in ("status", "ended_at")},
        "capture_boundary": boundary, "skill": skill, "plan": plan, "bindings": before["bindings"]}
    text = canonical_json_bytes(snapshot).decode("utf-8")
    if len(text.encode("utf-8")) > MAX_SNAPSHOT_BYTES:
        raise ValueError("Checkpoint metadata exceeds limit")
    record = CheckpointRecord(**metadata, snapshot_json=text, snapshot_sha256=_sha(text.encode("utf-8")))
    with _skill_transaction(connection):
        _guard_schema(connection)
        if _raw(connection, run_id) != before:
            raise CheckpointIntegrityError("Execution evidence changed before checkpoint publication")
        _skill_identity(connection, before)
        _plan_identity(connection, before)
        keys = tuple(asdict(record))
        _insert_one(connection, "INSERT INTO main.checkpoint_records (" + ",".join(keys)
                    + ") VALUES (" + ",".join("?" for _ in keys) + ")", tuple(asdict(record).values()))
        for path, data in artifacts.items():
            _insert_one(connection, "INSERT INTO main.checkpoint_artifacts "
                "(checkpoint_id,path,size_bytes,sha256,content) VALUES (?,?,?,?,?)",
                (record.checkpoint_id, path, len(data), _sha(data), data))
        _stored(record)
        _artifacts(connection, record)
        if _raw(connection, run_id) != before:
            raise CheckpointIntegrityError("Execution evidence changed during publication")
    return record


def _load(connection, checkpoint_id):
    rows = _rows(connection, "SELECT * FROM main.checkpoint_records WHERE checkpoint_id=?", (checkpoint_id,))
    if len(rows) != 1:
        raise CheckpointIntegrityError("Checkpoint does not exist uniquely")
    try:
        return CheckpointRecord(**dict(rows[0]))
    except TypeError:
        raise CheckpointIntegrityError("Malformed checkpoint row") from None


def _stored(record):
    data = asdict(record)
    for key, value in data.items():
        if key in ("schema_version", "event_cursor_seq", "skill_version"):
            continue
        if value is None and key in ("skill_id", "card_sha256", "proposal_id", "plan_sha256"):
            continue
        _text(value)
        if key.endswith("sha256") and not _HASH.fullmatch(value):
            raise CheckpointIntegrityError("Invalid checkpoint digest")
    if type(record.schema_version) is not int or record.schema_version != 1 or type(record.event_cursor_seq) is not int or record.event_cursor_seq < 1:
        raise CheckpointIntegrityError("Invalid checkpoint version or cursor")
    if (record.skill_id is None) != (record.skill_version is None) or (record.skill_id is None) != (record.card_sha256 is None):
        raise CheckpointIntegrityError("Incomplete Skill identity")
    if record.skill_id is not None:
        SkillRef(record.skill_id, record.skill_version)
    if (record.proposal_id is None) != (record.plan_sha256 is None):
        raise CheckpointIntegrityError("Incomplete Plan identity")
    if not Path(record.workspace_root).is_absolute():
        raise CheckpointIntegrityError("Relative checkpoint workspace")
    manifest = _manifest(record.workspace_manifest_json)
    if _sha(canonical_json_bytes(manifest)) != record.workspace_manifest_sha256:
        raise CheckpointIntegrityError("Manifest digest mismatch")
    snapshot = _json(record.snapshot_json, MAX_SNAPSHOT_BYTES)
    if _sha(record.snapshot_json.encode("utf-8")) != record.snapshot_sha256:
        raise CheckpointIntegrityError("Snapshot digest mismatch")
    if (type(snapshot) is not dict or snapshot.keys() != {"schema_version", "metadata", "run_identity",
            "captured_run_state", "capture_boundary", "skill", "plan", "bindings"}
            or type(snapshot["schema_version"]) is not int or snapshot["schema_version"] != 1
            or snapshot["metadata"] != {k: v for k, v in data.items() if k not in ("snapshot_json", "snapshot_sha256")}):
        raise CheckpointIntegrityError("Checkpoint metadata is not bound to snapshot")
    expected_skill = None if record.skill_id is None else {"skill_id": record.skill_id,
        "skill_version": record.skill_version, "card_sha256": record.card_sha256}
    expected_plan = None if record.proposal_id is None else {"proposal_id": record.proposal_id,
        "plan_sha256": record.plan_sha256, "approved_plan_sha256": record.plan_sha256}
    if snapshot["skill"] != expected_skill or snapshot["plan"] != expected_plan:
        raise CheckpointIntegrityError("Snapshot provenance identity mismatch")
    return snapshot


def _artifacts(connection, record):
    expected = {e["path"]: e for e in _manifest(record.workspace_manifest_json)["entries"] if e["type"] == "file"}
    rows = _rows(connection, "SELECT * FROM main.checkpoint_artifacts WHERE checkpoint_id=? ORDER BY path", (record.checkpoint_id,))
    if len(rows) != len(expected) or {r["path"] for r in rows} != set(expected):
        raise CheckpointIntegrityError("Artifact set disagrees with complete manifest")
    for row in rows:
        item, data = expected[row["path"]], row["content"]
        if (type(data) is not bytes or type(row["size_bytes"]) is not int
                or len(data) != row["size_bytes"] or len(data) != item["size_bytes"]
                or _sha(data) != row["sha256"] or _sha(data) != item["sha256"]):
            raise CheckpointIntegrityError("Artifact byte/size/hash mismatch")


def get_checkpoint(connection, checkpoint_id):
    _text(checkpoint_id)
    with _read_snapshot(connection):
        _guard_schema(connection)
        record = _load(connection, checkpoint_id)
        _stored(record)
        _artifacts(connection, record)
        return record


def list_checkpoints(connection, run_id):
    _text(run_id)
    with _read_snapshot(connection):
        _guard_schema(connection)
        records = []
        for row in _rows(connection, "SELECT checkpoint_id FROM main.checkpoint_records WHERE run_id=? ORDER BY event_cursor_seq,checkpoint_id", (run_id,)):
            record = _load(connection, row[0])
            _stored(record)
            _artifacts(connection, record)
            records.append(record)
        return records


def verify_checkpoint(connection, checkpoint_id, *, compare_workspace=False):
    """Verify separate evidence dimensions; never authorize resume or restore.

    Later events/bindings and mutable terminal Run state are outside the anchor.
    Optional current-tree comparison is a bounded observation, not atomic I/O.
    """
    _text(checkpoint_id)
    if type(compare_workspace) is not bool:
        raise ValueError("compare_workspace must be bool")
    checks, all_issues = {}, []

    def check(name, action, applicable=True):
        try:
            value = action()
            checks[name] = {"status": "VALID" if applicable else "NOT_APPLICABLE", "issues": []}
            return value
        except (ValueError, TypeError, KeyError, OSError, RuntimeError) as error:
            issue = {"code": name.upper(), "message": str(error)}
            checks[name] = {"status": "INVALID", "issues": [issue]}
            all_issues.append(issue)
            return None

    with _read_snapshot(connection):
        _guard_schema(connection)
        record = _load(connection, checkpoint_id)
        snapshot = check("stored_checkpoint_integrity", lambda: _stored(record))

        def prefix_check():
            raw = _raw(connection, record.run_id, record.event_cursor_seq)
            if _prefix(raw, record.event_cursor_seq) != record.event_prefix_sha256:
                raise CheckpointIntegrityError("Anchored event prefix changed")
            if snapshot is None or _task_identity(raw["run"]) != snapshot["run_identity"]:
                raise CheckpointIntegrityError("Checkpoint Run identity mismatch")
            if record.task_spec_sha256 != raw["run"]["task_spec_sha256"] or record.workspace_root != raw["run"]["workspace_path"]:
                raise CheckpointIntegrityError("Checkpoint Run digest/workspace mismatch")
            captured = {**raw["run"], **snapshot["captured_run_state"]}
            boundary = snapshot["capture_boundary"]
            boundary = ControlledCaptureBoundary(**boundary) if boundary is not None else None
            if _admit({**raw, "run": captured}, boundary)[0] != record.checkpoint_kind:
                raise CheckpointIntegrityError("Invalid historical capture boundary")
            return raw
        raw = check("event_prefix_integrity", prefix_check)

        def skill_check():
            if raw is None or snapshot is None:
                raise CheckpointIntegrityError("Run prefix unavailable for Skill verification")
            if raw["bindings"] != snapshot["bindings"] or _skill_identity(connection, raw) != snapshot["skill"]:
                raise CheckpointIntegrityError("Historical Skill binding mismatch")
        check("skill_reference_integrity", skill_check, record.skill_id is not None)

        def plan_check():
            if raw is None or snapshot is None:
                raise CheckpointIntegrityError("Run prefix unavailable for Plan verification")
            if _plan_identity(connection, raw) != snapshot["plan"]:
                raise CheckpointIntegrityError("Plan provenance mismatch")
        check("plan_provenance_integrity", plan_check, record.proposal_id is not None)
        check("artifact_snapshot_integrity", lambda: _artifacts(connection, record))
    current = {"status": "NOT_COMPARED", "paths": []}
    if compare_workspace:
        try:
            text, _ = _capture_workspace(record.workspace_root)
            old = {e["path"]: e for e in _manifest(record.workspace_manifest_json)["entries"]}
            new = {e["path"]: e for e in _manifest(text)["entries"]}
            paths = sorted(p for p in old.keys() | new.keys() if old.get(p) != new.get(p))
            current = {"status": "DIFFERENT" if paths else "MATCH", "paths": paths}
        except (ValueError, OSError, RuntimeError) as error:
            current = {"status": "UNAVAILABLE", "paths": [], "message": str(error)}
    return {"schema_version": 1, "checkpoint_id": checkpoint_id, "run_id": record.run_id,
        "event_cursor_seq": record.event_cursor_seq, "checks": checks,
        "current_workspace_difference": current, "integrity_issues": all_issues}
