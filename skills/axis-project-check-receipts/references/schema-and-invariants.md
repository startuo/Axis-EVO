# SQLite receipts and UNKNOWN fences

## Ledger

Use one ledger per project location. With a custom ledger, pass the same `--db` on subsequent calls. The project key hashes the resolved project location. A relocated project requires a new ledger. The commands expect local SQLite storage with WAL, full synchronization, and foreign key checks. Inspection opens the database in read-only mode. SQLite may need access to its WAL and shared-memory sidecars.

| Field | Meaning |
| --- | --- |
| `seq` | Monotonic insertion sequence |
| `id` | Unique record identifier |
| `kind` | `tool_intent`, `tool_result`, or `fence_cleared` |
| `run_id` | Identity shared by one check's records |
| `parent_id` | Intent ID for a result or clearance |
| `payload_json` | Canonical JSON object |
| `payload_sha256` | SHA-256 of the canonical UTF-8 payload |
| `created_at` | UTC timestamp |

Canonical JSON sorts keys, uses compact separators and preserves Unicode in UTF-8. Each open checks the SQLite schema and triggers. Verification walks the records in sequence, checks hashes and intent relationships, and checks the fence projection. Triggers reject updates, deletes, and replacements of existing facts. The ledger provides local integrity checks. Its trust depends on control of the database files and directory.

## Snapshot and fixed inputs

Snapshot SHA-256 covers directory paths and file paths with file content hashes. The input is a stream of canonical JSON arrays, one per entry with a trailing line feed. Each directory contributes `["d", relativePath]` and each file contributes `["f", relativePath, contentSha256]`. Visit children by name in sorted depth-first order. Paths use forward slashes. The project root has no entry.

The snapshot skips `.git`, `.axis-receipts`, `node_modules`, `__pycache__`, `.venv`, the selected ledger and its sidecars, symbolic links, and reparse points. Project, ledger, fence and protected paths are checked for redirection on access. Use a stable project tree while reading or staging a snapshot. File modes and timestamps are outside the content digest. Protected files must be regular files included in the snapshot. The result records their before and after evidence. A byte change or a missing or unreadable protected file turns a passing check into a failure.

The result refers to the snapshot taken before the check. `compare` checks the latest result by ledger sequence and reports freshness separately from its outcome. The evidence covers file bytes at the two protected-file observations. A temporary change restored before the second observation can escape detection. Output keeps at most 4,096 bytes per stream, with two 2,048-byte excerpts for larger streams. Temporary output files can grow while the check is running.

## UNKNOWN and recovery

`fenced_paths` is a derived index that maps each outstanding intent to one normalized project-relative path. The runner reserves it in the same transaction as the intent, before launching the check. A fence blocks matching paths, ancestors and descendants. The default path `.` overlaps every path. Scope declarations should cover the effects of the approved command.

A confirmed exit or timeout releases the reservation. An `UNKNOWN` result keeps it. A crash can leave an intent without a result, which has the same blocking effect. The inspector labels that case as pending because the original check could still be running. Host timeouts apply to the direct process. Review any descendants when reconciling effects.

After checking the outcome, a human can supply a reason to release a fence. A missing result first receives an `UNKNOWN` receipt. The clearance and fence removal commit together. Earlier facts remain available for audit.
