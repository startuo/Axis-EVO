"""Read and verify local project check receipts."""

import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import sqlite3
import sys

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


def snapshot(root, db_path):
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
            kind = info.st_mode & STAT_KIND
            if kind == DIRECTORY:
                digest.update(canonical(["d", rel.as_posix()]) + b"\n")
                visit(path)
            elif kind == REGULAR:
                digest.update(canonical(["f", rel.as_posix(), file_sha(path)]) + b"\n")
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

def warnings(active, results):
    return [{"intentId": key, "path": path, "status": "UNKNOWN", "pending": key not in results}
            for key, path in active.items()]


def markdown_text(value):
    return re.sub(r"[^\w .:/-]", lambda match: f"&#{ord(match[0])};",
                  " ".join(str(value).split()))


def report(intents, results, fences):
    print("# Project check delivery receipt\n")
    print("## Checks\n")
    print("| Check | Status | Exit code | Input snapshot SHA-256 | Intent ID | Receipt ID |")
    print("| --- | --- | ---: | --- | --- | --- |")
    for key, (_, intent) in intents.items():
        receipt, status, code = results.get(key, (None, "UNKNOWN", None))
        fields = [markdown_text(intent["name"]), status, code, intent["snapshotSha256"], key, receipt]
        print("| " + " | ".join("-" if value is None else str(value) for value in fields) + " |")
    print("\n## Unresolved UNKNOWN fences\n")
    if not fences:
        print("None.")
    for fence in fences:
        message = " (completion receipt missing)" if fence["pending"] else ""
        print(f"- Intent {fence['intentId']} at {markdown_text(fence['path'])}{message}.")
    print("\n## Freshness\n")
    print("Run compare against the current project before relying on a receipt.")


def compare(root, db_path, supplied_paths, intents, results, fences):
    if not results:
        send({"status": "NO_RESULT", "fences": fences})
        return 2
    parent = next(reversed(results))
    receipt, status, code = results[parent]
    intent = intents[parent][1]
    expected = intent["protected"]
    paths = protected_paths(root, db_path, supplied_paths) if supplied_paths else expected
    current = snapshot(root, db_path)
    protected = protected_digests(root, paths, allow_missing=True)
    changes = sorted(path for path in expected.keys() | protected.keys()
                     if expected.get(path, "") != protected.get(path, ""))
    fresh = current == intent["snapshotSha256"] and not changes
    send({"status": "CURRENT" if fresh else "STALE", "resultStatus": status, "exitCode": code,
          "intentId": parent, "receiptId": receipt, "snapshotSha256": current,
          "receiptSnapshotSha256": intent["snapshotSha256"],
          "protected": protected, "protectedChanges": changes, "fences": fences})
    return 0 if fresh else 1


def add_location_options(parser):
    parser.add_argument("--project", default=argparse.SUPPRESS)
    parser.add_argument("--db", default=argparse.SUPPRESS)


def main():
    parser = argparse.ArgumentParser(description="Inspect the local project check ledger.")
    add_location_options(parser)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("verify", "compare", "report"):
        command = commands.add_parser(name)
        add_location_options(command)
        if name == "compare":
            command.add_argument("--protect", action="append", default=[])
    args = parser.parse_args()
    if not getattr(args, "project", None):
        parser.error("--project is required")
    db = None
    try:
        root, db_path, project_key = locations(args.project, getattr(args, "db", None))
        db = sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA synchronous=FULL")
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        intents, results, active = read_ledger(db, project_key)
        fences = warnings(active, results)
        if args.command == "compare":
            return compare(root, db_path, args.protect, intents, results, fences)
        if args.command == "verify":
            count = db.execute("SELECT COUNT(*) FROM records").fetchone()[0]
            send({"status": "VERIFIED", "records": count, "fences": fences})
        else:
            report(intents, results, fences)
        return 0
    except (OSError, sqlite3.Error, ValueError, KeyError) as error:
        send({"status": "ERROR", "detail": str(error)})
        return 2
    finally:
        if db is not None:
            db.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
