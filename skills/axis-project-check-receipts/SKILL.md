---
name: axis-project-check-receipts
description: Run an approved local project check and record its result in an append-only SQLite ledger. Use for test or build evidence, fixed-file integrity checks, checking whether a prior result still applies, or resolving an uncertain run before retrying.
summary: Record local project checks, verify their evidence against current files, and pause retries when the previous outcome is unknown.
version: 0.1.0
license: MIT
tags:
  - developer-tools
  - testing
  - audit
keywords:
  - project check
  - SQLite receipts
  - snapshot hash
  - UNKNOWN fence
use_cases:
  - Record a local test or build check for delivery.
  - Verify that protected acceptance files kept the same bytes.
  - Check receipt freshness before citing a previous result.
  - Review an uncertain run before allowing a retry.
---

# Axis Project Check Receipts

Requires: Python 3.11+ (standard library only); Docker (optional, only for --docker-image isolated runs). No remote servers or network access required.

Extracted from the Axis-Evo check-and-receipt workflow

The MIT license covers this skill's files only.

## Run an approved check

Use the project directory and command arguments approved by the user. Run the corresponding Python script as supplied. Each script works from a temporary location with no companion files.

```text
python run_project_check.py --project ./example --name unit-tests --timeout 60 --protect tests/check_input.py -- python -m unittest discover -s tests
python inspect_receipts.py verify --project ./example
python inspect_receipts.py compare --project ./example
python inspect_receipts.py report --project ./example
```

The default ledger is `.axis-receipts/receipts.sqlite3` inside the project. Supply the same `--db` to both scripts for a custom ledger. A relative ledger path is relative to the project. The runner reads project files and writes the local ledger. A host check uses the caller's local permissions. Choose a trusted command and keep private values out of its arguments and output.

Use repeatable `--protect` for fixed input files. Supply `--fence-path` when the check's effects belong to a single project path. The default fence covers the whole project. For a read-only container copy, follow [Docker isolation](references/docker-isolation.md).

## Interpret the receipt

- Runner exit codes are 0 for `PASSED` or a successful acknowledgement, 1 for `FAILED`, 2 for `BLOCKED` or an input or ledger error, 124 for `TIMED_OUT`, and 125 for `UNKNOWN`.
- `verify` checks the ledger structure, payload hashes, and fence projection. Review its outstanding fences even when it reports `VERIFIED`.
- `compare` checks the latest result against the current input snapshot and protected files. It uses the recorded protected paths by default. An explicit `--protect` list checks that exact set. `CURRENT` has exit code 0, `STALE` has exit code 1, and a missing receipt or error has exit code 2. Cite a passing result only when its scope and freshness support the claim.
- `report` prints the [delivery receipt](templates/delivery-receipt.md) structure. Use the [ledger reference](references/schema-and-invariants.md) to interpret hashes and status.

## Resolve an UNKNOWN fence

An interrupt or missing completion leaves a fence. Verify the ledger to find the intent ID. Have the user confirm the earlier process has stopped, review its effects, and provide the reason before acknowledging the intent.

```text
python run_project_check.py --project ./example --ack-unknown INTENT_ID --reason "Reviewed the changed files and confirmed the prior process stopped."
```

The acknowledgement records the user's review and releases that intent's fence. Take a fresh receipt when a new check is approved.
