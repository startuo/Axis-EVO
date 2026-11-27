"""Run a project check and retain its local receipt."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid

IGNORED = {".git", ".axis-receipts", "node_modules", "__pycache__", ".venv"}
STAT_KIND = 0o170000
REGULAR = 0o100000
DIRECTORY = 0o040000
RESULTS = {"PASSED", "FAILED", "TIMED_OUT", "UNKNOWN"}

SCHEMA = (
    """CREATE TABLE records(
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK(kind IN ('tool_intent', 'tool_result', 'fence_cleared')),
        run_id TEXT NOT NULL,
        parent_id TEXT REFERENCES records(id),
        payload_json TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        CHECK((kind = 'tool_intent') = (parent_id IS NULL)),
        UNIQUE(run_id, kind)
    )""",
    """CREATE TABLE fenced_paths(
        path_key TEXT NOT NULL,
        intent_id TEXT NOT NULL PRIMARY KEY REFERENCES records(id)
    )""",
    """CREATE TRIGGER records_no_update BEFORE UPDATE ON records
        BEGIN SELECT RAISE(ABORT, 'immutable record'); END""",
    """CREATE TRIGGER records_no_delete BEFORE DELETE ON records
        BEGIN SELECT RAISE(ABORT, 'immutable record'); END""",
    """CREATE TRIGGER records_no_replace BEFORE INSERT ON records
        WHEN EXISTS(SELECT 1 FROM records WHERE seq = NEW.seq OR id = NEW.id
                    OR (run_id = NEW.run_id AND kind = NEW.kind))
        BEGIN SELECT RAISE(ABORT, 'immutable identity'); END""",
)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def redirected(info):
    return (info.st_mode & STAT_KIND == 0o120000
            or bool(getattr(info, "st_file_attributes", 0) & 0x400))


def plain_stat(path):
    for item in (*reversed(path.parents), path):
        try:
            info = item.lstat()
        except FileNotFoundError:
            return None
        if redirected(info):
            raise ValueError(f"Redirected path component: {item.name}")
    return info


def path_key(path):
    return Path(os.path.normcase(str(path))).as_posix()


def omitted_paths(db_path):
    return {Path(str(db_path) + suffix) for suffix in ("", "-wal", "-shm", "-journal")}


def locations(project, database):
    root = Path(project).absolute()
    info = plain_stat(root)
    if info is None or info.st_mode & STAT_KIND != DIRECTORY:
        raise ValueError("Invalid project directory")
    root = root.resolve(strict=True)
    db_path = root / (database or ".axis-receipts/receipts.sqlite3")
    plain_stat(db_path)
    db_path = db_path.resolve()
    for path in omitted_paths(db_path):
        info = plain_stat(path)
        if info and (info.st_mode & STAT_KIND != REGULAR or info.st_nlink != 1):
            raise ValueError("Invalid ledger file")
    return root, db_path, sha(canonical(path_key(root)))


def relative(root, value):
    rel = Path(value.replace(chr(92), "/"))
    if not value or rel.anchor or ":" in value or ".." in rel.parts or rel.is_reserved():
        raise ValueError(f"Invalid relative path: {value}")
    if os.name == "nt" and any(p.endswith((" ", ".")) for p in rel.parts):
        raise ValueError(f"Ambiguous path: {value}")
    candidate = root / rel
    plain_stat(candidate)
    return candidate.resolve().relative_to(root).as_posix()


def protected_paths(root, db_path, values):
    paths = {relative(root, value) for value in values}
    excluded = omitted_paths(db_path)
    for name in paths:
        if (name == "." or IGNORED.intersection(p.casefold() for p in Path(name).parts)
                or root / name in excluded):
            raise ValueError(f"Protected file is outside the snapshot: {name}")
    return sorted(paths)


def file_sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def protected_digests(root, paths, *, allow_missing=False):
    values = {}
    for name in paths:
        path = root / name
        try:
            info = plain_stat(path)
            if info is None or info.st_mode & STAT_KIND != REGULAR:
                raise ValueError(f"Invalid protected file: {name}")
            values[name] = file_sha(path)
        except (OSError, ValueError):
            if not allow_missing:
                raise
            values[name] = None
    return values


def snapshot(root, db_path, stage=None):
    excluded = omitted_paths(db_path)
    digest = hashlib.sha256()

    def visit(folder):
        for path in sorted(folder.iterdir(), key=lambda child: child.name):
            if path in excluded or path.name.casefold() in IGNORED:
                continue
            info = path.lstat()
            if redirected(info):
                continue
            rel = path.relative_to(root)
            target = stage / rel if stage is not None else path
            kind = info.st_mode & STAT_KIND
            if kind == DIRECTORY:
                if stage is not None:
                    target.mkdir()
                    target.chmod(0o755)
                digest.update(canonical(["d", rel.as_posix()]) + b"\n")
                visit(path)
            elif kind == REGULAR:
                if stage is not None:
                    shutil.copyfile(path, target)
                    target.chmod(0o755 if info.st_mode & 0o111 else 0o644)
                digest.update(canonical(["f", rel.as_posix(), file_sha(target)]) + b"\n")
            else:
                raise ValueError(f"Unsupported file: {rel}")

    visit(root)
    return digest.hexdigest()


def schema_rows(db):
    return [row[0] for row in db.execute(
        "SELECT sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' ORDER BY sql"
    )]


def check_schema(db):
    if schema_rows(db) != sorted(SCHEMA) or db.execute("PRAGMA journal_mode").fetchone()[0] != "wal":
        raise ValueError("Invalid schema or journal mode")


def read_ledger(db, project_key):
    check_schema(db)
    intents, results, active = {}, {}, {}
    for row in db.execute("SELECT * FROM records ORDER BY seq"):
        identity, kind, run = row["id"], row["kind"], row["run_id"]
        raw = row["payload_json"].encode()
        payload = json.loads(raw)
        if not isinstance(payload, dict) or canonical(payload) != raw or sha(raw) != row["payload_sha256"]:
            raise ValueError(f"Invalid payload at sequence {row['seq']}")
        if kind == "tool_intent":
            if payload["projectKey"] != project_key:
                raise ValueError("Ledger belongs to another project")
            intents[identity] = (run, payload)
            active[identity] = payload["fencePath"]
        else:
            parent = row["parent_id"]
            if parent not in intents or intents[parent][0] != run:
                raise ValueError(f"Invalid intent reference at sequence {row['seq']}")
            if kind == "tool_result":
                status = payload["status"]
                if status not in RESULTS:
                    raise ValueError(f"Invalid status at sequence {row['seq']}")
                results[parent] = (row["id"], status, payload["exitCode"])
                if status != "UNKNOWN":
                    del active[parent]
            elif parent not in active or parent not in results or not payload["reason"].strip():
                raise ValueError(f"Invalid clearance at sequence {row['seq']}")
            else:
                del active[parent]
    if active != dict(db.execute("SELECT intent_id, path_key FROM fenced_paths")):
        raise ValueError("Fence projection mismatch")
    return intents, results, active


def send(value):
    print(json.dumps(value, ensure_ascii=True))

def initialize(db):
    db.execute("PRAGMA synchronous=FULL")
    db.execute("PRAGMA foreign_keys=ON")
    if not schema_rows(db):
        db.execute("PRAGMA journal_mode=WAL")
        with db:
            db.execute("BEGIN IMMEDIATE")
            if not schema_rows(db):
                for statement in SCHEMA:
                    db.execute(statement)


def append(db, kind, run_id, payload, parent=None):
    record_id = uuid.uuid4().hex
    raw = canonical(payload)
    checksum = sha(raw)
    created = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    db.execute(
        "INSERT INTO records(id,kind,run_id,parent_id,payload_json,payload_sha256,created_at) "
        "VALUES(?,?,?,?,?,?,?)",
        (record_id, kind, run_id, parent, raw.decode(), checksum, created),
    )
    return {"id": record_id, "kind": kind, "runId": run_id,
            "parentId": parent, "createdAt": created, "payloadSha256": checksum}


def overlaps(left, right):
    return "." in (left, right) or left == right or left.startswith(right + "/") or right.startswith(left + "/")


def reserve(db, root, db_path, project_key, args, command, stage):
    with db:
        db.execute("BEGIN IMMEDIATE")
        _, _, active = read_ledger(db, project_key)
        fence = path_key(Path(relative(root, args.fence_path)))
        blocked = {key: path for key, path in active.items() if overlaps(fence, path)}
        if blocked:
            return None, {"status": "BLOCKED", "fences": blocked}
        paths = protected_paths(root, db_path, args.protect)
        protected = protected_digests(root, paths)
        snapshot_sha = snapshot(root, db_path, stage)
        if stage and protected_digests(stage, paths) != protected:
            raise ValueError("Protected copy differs")
        intent = {"projectKey": project_key, "name": args.name, "argv": command,
                  "timeoutSeconds": args.timeout, "dockerImage": args.docker_image,
                  "fencePath": fence, "snapshotSha256": snapshot_sha, "protected": protected}
        meta = append(db, "tool_intent", uuid.uuid4().hex, intent)
        db.execute("INSERT INTO fenced_paths(path_key,intent_id) VALUES(?,?)", (fence, meta["id"]))
        return meta, intent


def finish(db, project_key, meta, intent, result):
    with db:
        db.execute("BEGIN IMMEDIATE")
        _, results, active = read_ledger(db, project_key)
        if meta["id"] not in active or meta["id"] in results:
            raise ValueError("Intent already has a result")
        receipt = append(db, "tool_result", meta["runId"], result, meta["id"])
        if result["status"] != "UNKNOWN":
            db.execute("DELETE FROM fenced_paths WHERE intent_id=?", (meta["id"],))
    send({**receipt, **result, "intentId": meta["id"], "name": intent["name"],
          "snapshotSha256": intent["snapshotSha256"], "protectedBefore": intent["protected"]})


def acknowledge(db, project_key, identity, reason):
    with db:
        db.execute("BEGIN IMMEDIATE")
        intents, results, active = read_ledger(db, project_key)
        if identity not in active:
            raise ValueError("Intent has no outstanding fence")
        run_id = intents[identity][0]
        if identity not in results:
            append(db, "tool_result", run_id,
                   outcome("UNKNOWN", detail="No completion receipt"), identity)
        clearance = append(db, "fence_cleared", run_id, {"reason": reason}, identity)
        db.execute("DELETE FROM fenced_paths WHERE intent_id=?", (identity,))
    send({**clearance, "status": "FENCE_CLEARED", "intentId": identity, "path": active[identity]})
    return 0


def summarize(stream):
    limit = 2048
    size = stream.seek(0, os.SEEK_END)
    stream.seek(0)
    truncated = size > limit * 2
    head = stream.read(limit if truncated else size)
    if truncated:
        stream.seek(-limit, os.SEEK_END)
    return {"bytes": size, "head": head.decode(errors="replace"),
            "tail": stream.read(limit).decode(errors="replace"), "truncated": truncated}


def outcome(status, code=None, detail=None):
    return {"status": status, "exitCode": code, "detail": detail}


def host_check(root, argv, timeout, stdout, stderr):
    try:
        if os.name == "nt":
            program = argv[0]
            if "/" in program or chr(92) in program:
                program = str(root / program)
            target = shutil.which(program)
            if not target or Path(target).suffix.lower() not in {".exe", ".com"}:
                raise ValueError("Select a native Windows program")
            argv = [str(Path(target).absolute()), *argv[1:]]
        code = subprocess.run(argv, cwd=root, shell=False, stdin=subprocess.DEVNULL,
                              stdout=stdout, stderr=stderr, timeout=timeout).returncode
    except subprocess.TimeoutExpired:
        return outcome("TIMED_OUT", detail="Host command timed out")
    except KeyboardInterrupt:
        return outcome("UNKNOWN", detail="Host interrupted")
    except (OSError, ValueError) as error:
        return outcome("FAILED", detail=str(error))
    if code < 0 or code == 0xC000013A:
        return outcome("UNKNOWN", code, "Host interrupted")
    return outcome("PASSED" if code == 0 else "FAILED", code)


def docker_create(name, entrypoint, *, workdir=None):
    command = [
        "container", "create", "--pull=never", "--network=none", "--no-healthcheck",
        "--cap-drop=ALL", "--security-opt=no-new-privileges", f"--name={name}",
        f"--entrypoint={entrypoint}",
    ]
    if workdir is not None:
        command += ["--read-only", "--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=64m",
                    "--user=65534:65534", f"--workdir={workdir}"]
    return command


def docker_call(cli, args, timeout=15):
    proc = subprocess.run([*cli, *args], stdin=subprocess.DEVNULL, capture_output=True,
                          encoding="utf-8", errors="replace", timeout=timeout)
    if proc.returncode:
        raise ValueError(f"Docker {args[:2]}: {proc.stderr.strip()[-512:]}")
    return proc.stdout.strip()


def local_docker():
    binary = shutil.which("docker.exe" if os.name == "nt" else "docker")
    if not binary:
        raise ValueError("Docker CLI unavailable")
    cli = [str(Path(binary).absolute())]
    host = docker_call(cli, ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"])
    scheme, _, address = host.partition(":")
    if not ((scheme == "unix" and address.startswith("///"))
            or (scheme == "npipe" and address.startswith(("////./pipe/", "//./pipe/")))):
        raise ValueError("Local Docker required")
    return [*cli, f"--host={host}"]


def docker_check(image, argv, timeout, stage, run_id, stdout, stderr):
    stage_name, name = "axis-stage-" + run_id, "axis-check-" + run_id
    tag, workdir = "axis-check-copy:" + run_id, "/" + name
    cleanup, issues = [], []
    phase = "setup"
    try:
        cli = local_docker()
        image_id, platform, volumes = docker_call(cli, [
            "image", "inspect", "--format", '{{.Id}} {{.Os}} {{json (index .Config "Volumes")}}', image
        ]).split(maxsplit=2)
        if platform != "linux" or json.loads(volumes):
            raise ValueError("Expected Linux image without volumes")
        cleanup.append(["container", "rm", "-f", stage_name])
        docker_call(cli, [*docker_create(stage_name, "/bin/true"), image_id])
        docker_call(cli, ["container", "cp", str(stage), f"{stage_name}:{workdir}"], 60)
        cleanup.append(["image", "rm", tag])
        docker_call(cli, ["container", "commit", stage_name, tag], 60)
        cleanup.append(["container", "rm", "-f", name])
        docker_call(cli, [*docker_create(name, argv[0], workdir=workdir), tag, *argv[1:]])
        phase = "run"
        subprocess.run([*cli, "container", "start", "--attach", name], stdin=subprocess.DEVNULL,
                       stdout=stdout, stderr=stderr, timeout=timeout)
        phase = "confirm"
        state = json.loads(docker_call(cli, [
            "container", "inspect", "--format", "{{json .State}}", name
        ]))
        if state["Status"] != "exited" or state["Error"] or state["StartedAt"].startswith("0001-"):
            raise ValueError("Unconfirmed Docker exit")
        code = state["ExitCode"]
        result = outcome("PASSED" if code == 0 else "FAILED", code)
    except subprocess.TimeoutExpired:
        result = outcome("UNKNOWN" if phase == "confirm" else "TIMED_OUT", detail="Docker timed out")
    except KeyboardInterrupt:
        result = outcome("UNKNOWN", detail="Docker interrupted")
    except (OSError, ValueError, KeyError) as error:
        result = outcome("FAILED" if phase == "setup" else "UNKNOWN", detail=str(error))
    for command in reversed(cleanup):
        try:
            docker_call(cli, command)
        except (subprocess.TimeoutExpired, OSError, ValueError, KeyboardInterrupt) as error:
            if command[-1] == name and phase == "run":
                result["status"] = "UNKNOWN"
            if "No such" not in str(error):
                issues.append(f"{command[-1]}: {error}")
    if issues:
        result["cleanupIssues"] = issues
    return result


def run_check(db, root, db_path, project_key, args, command, stage=None):
    meta, intent = reserve(db, root, db_path, project_key, args, command, stage)
    if meta is None:
        send(intent)
        return 2
    start = time.monotonic()
    try:
        with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
            if stage is None:
                result = host_check(root, command, args.timeout, stdout, stderr)
            else:
                result = docker_check(args.docker_image, command, args.timeout, stage,
                                      meta["runId"], stdout, stderr)
            result["stdout"], result["stderr"] = summarize(stdout), summarize(stderr)
        after = protected_digests(root, intent["protected"], allow_missing=True)
        changed = [path for path, value in intent["protected"].items() if after[path] != value]
        result.update(protectedAfter=after, protectedChanged=changed)
        if changed and result["status"] == "PASSED":
            result.update(status="FAILED", detail="Protected files changed")
    except (KeyboardInterrupt, OSError) as error:
        result = outcome("UNKNOWN", detail=str(error) or "Check was interrupted")
    result["durationMs"] = round((time.monotonic() - start) * 1000)
    finish(db, project_key, meta, intent, result)
    return {"PASSED": 0, "FAILED": 1, "TIMED_OUT": 124, "UNKNOWN": 125}[result["status"]]


def main():
    parser = argparse.ArgumentParser(description="Record a check.")
    parser.add_argument("--project", required=True)
    parser.add_argument("--db")
    parser.add_argument("--name")
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--protect", action="append", default=[])
    parser.add_argument("--fence-path", default=".")
    parser.add_argument("--docker-image")
    parser.add_argument("--ack-unknown")
    parser.add_argument("--reason")
    options = sys.argv[1:]
    cut = options.index("--") if "--" in options else len(options)
    args = parser.parse_args(options[:cut])
    command = options[cut + 1:]
    if args.ack_unknown:
        if command or not (args.reason or "").strip():
            parser.error("Provide --reason and omit the check command")
    elif not (command and command[0] and (args.name or "").strip()) or args.reason is not None:
        parser.error("Provide --name and a check command after --")
    if not 1 <= args.timeout <= 300:
        parser.error("--timeout must be between 1 and 300 seconds")
    if args.docker_image and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/@:-]*", args.docker_image):
        parser.error("Invalid Docker image")

    db = None
    try:
        root, db_path, project_key = locations(args.project, args.db)
        if args.ack_unknown and not db_path.exists():
            raise ValueError("Missing ledger")
        db_path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(db_path, isolation_level=None)
        db.row_factory = sqlite3.Row
        initialize(db)
        if args.ack_unknown:
            return acknowledge(db, project_key, args.ack_unknown, args.reason.strip())
        if not args.docker_image:
            return run_check(db, root, db_path, project_key, args, command)
        with tempfile.TemporaryDirectory() as tmp:
            stage = Path(tmp) / "snapshot"
            stage.mkdir()
            stage.chmod(0o755)
            return run_check(db, root, db_path, project_key, args, command, stage)
    except (OSError, sqlite3.Error, ValueError, KeyError) as error:
        send({"status": "ERROR", "detail": str(error)})
        return 2
    except KeyboardInterrupt:
        send({"status": "UNKNOWN", "detail": "Interrupted"})
        return 125
    finally:
        if db:
            db.close()


if __name__ == "__main__":
    sys.exit(main())
