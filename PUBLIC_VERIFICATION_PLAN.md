# Public verification plan — Phase 3 / Step 3

Source tested: `406a0db1af87c48f3a696cfcda17fa9b3ead7467`. The following documentation-only publication commit has the same production bytes. The private manifest records both commits and the verified remote SHA; it is not a claim that a document can contain its own future commit hash.

Verification environment: Windows 11 build 22631, Python 3.12.10, SQLite 3.49.1, pytest 9.1.1. Production SHA-256 manifest digest: `a4fa83903168dfcedf24b8b2eab52e0df4a7f5ae29ea658f2b38342454fb3886` (SHA-256 over sorted compact JSON mapping each `src/axis_evo/*.py` and migration path to its raw-file digest). The private ZIP includes the mapping and every test/fixture byte.

## Public repository alone

The public source and `examples/consumer.py` allow an independent consumer to run a real deterministic task, inspect persisted events and a failed task, examine transaction/immutable SQL contracts, and construct their own disposable checks. These demonstrations do not reproduce the complete private security/fault/Oracle test suite or establish OS-level isolation, exactly-once external effects, general recovery safety, or Skill causality.

In a new clone, with Python 3.11+ (this delivery was verified on 3.12.10), use PowerShell:

```powershell
git clone https://github.com/startuo/Axis-EVO.git
Set-Location Axis-EVO
git checkout 406a0db1af87c48f3a696cfcda17fa9b3ead7467
$env:PYTHONPATH = (Join-Path (Get-Location) 'src')
python examples/consumer.py .local/demo-success
python examples/consumer.py .local/demo-failed --failed
```

Each output directory must be new. The example uses actual `connect_database`, `PluginRegistry`, `PatchFileTool`, `PlanStep`, `run_task`, and `inspect_database`; it creates its own seed and TaskSpec, with no private fixture or network dependency. Observed results here: success `COMPLETED`, failure `FAILED`, both `trace.consistent=true`. Its optional dependency installation alternative is `python -m pip install -e .`; the PYTHONPATH commands do not require it.

Inspect the recorded failed task again:

```powershell
python -c "import json; from axis_evo.inspector import inspect_database; print(json.dumps(inspect_database('.local/demo-failed/facts.sqlite3', 'public-consumer'), indent=2))"
```

For an existing interrupted database, call that same API with its actual database path and run ID. A `RUNNING` row with `ended_at=NULL` and no result may produce `UNFINISHED_RUN` and `EXECUTION_RESULT_UNKNOWN`; changed current state may add `EXTERNAL_STATE_CHANGED`. These observations never prove causality or authorize replay. The public example deliberately produces a normal failure; hard-exit cases are in the private review evidence. Inspector is logically read-only, including when its connection is `query_only=ON`; ordinary mode=ro WAL/SHM coordination is permitted, and no immutable=1 shortcut is used.

## Complete private reproduction

The existing publication policy in AGENTS.md excludes test source, fixtures, hidden Oracles, delivery reports and review ZIPs from public Git. They do exist locally and are included in `axis-evo-phase3-step3-review.zip`. Public test statistics are locally measured evidence, not a public CI badge.

An authorized reviewer should clone the published commit identified by REVIEW_MANIFEST, verify source and fixture SHA-256 values, overlay the ZIP's tests/fixtures and private evidence onto that clone, and run:

```powershell
python -m pip install -e '.[test]'
python -m pytest -q tests/integration/test_safety_hardening.py
python -m pytest -q tests/unit/test_skill_trust.py
python -m pytest -q tests/integration/test_skill_trust_storage.py
python -m pytest -q tests/integration/test_skill_trust_crash.py
python -m pytest -q
```

The frozen historical fault harness reads `git rev-parse HEAD`; therefore the complete suite requires the clone's Git metadata. A bare extracted ZIP intentionally has no .git and is not claimed to run that full harness unchanged. Tests use disposable temporary directories. Windows symlink tests require the corresponding OS privilege; one FIFO case requires POSIX. Fresh Linux testing was unavailable for this milestone. The private evidence includes raw pytest logs/JUnit, baseline and frozen hashes, actual hard-exit records, exact benchmark/Oracle identities, and offline adapter-call ledgers. No real provider call or token cost was measured; token usage is null. Private replay scripts expect a Git clone for their local .git evidence output.

## Source and result association

- Implementation commit above: complete tested production source, the public consumer and README.
- Final publication commit: documentation-only addition of this plan and the new `docs/TEST_RESULTS.md` section; production and test bytes stay unchanged.
- Final full suite: `1991 passed, 14 skipped in 397.47s (0:06:37)`, 2005 collected, zero failures/errors. No warning summary was reported; no warning filter was added. `PureWindowsPath.is_reserved()` compatibility/deprecation debt on later Python versions remains disclosed.
- Gate A passed before Gate B began: 1722 passed / 14 skipped / 1736 collected.
- Baseline historical counts remain historical; they are not presented as fresh Linux or remote CI results.

## External CI and licensing decisions

No GitHub Actions verification workflow was added or claimed to have run. Public external CI would require owner authorization to publish an appropriate test/fixture subset (or a separately authorized private CI evidence-access arrangement), explicit Windows/Linux jobs and Python versions, offline default model transport, artifact retention, and an actual successful remote run. Hidden Oracle access and test-publication policy must be decided first; this document grants no publication permission.

No LICENSE was selected or generated. Options for the owner include [MIT](https://choosealicense.com/licenses/mit/) (permissive, preserving notices), [Apache-2.0](https://choosealicense.com/licenses/apache-2.0/) (permissive with an express patent grant and stated conditions), or [GPL-3.0](https://choosealicense.com/licenses/gpl-3.0/) (copyleft conditions on distribution). [GitHub's licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository) explains that public visibility alone is not a general permission to reuse, modify or redistribute; GitHub's viewing/forking terms are a separate boundary. Owner approval is required before choosing a project license.

## Current evidence limits

Descriptor/path checks reject tested hard-link/redirection attacks within the documented supported model; they are not a complete hostile OS sandbox. SQLite first-event admission serializes supported coordinator invocations across connections/processes, not arbitrary direct-SQL/old-binary writers. Shadow simulation uses in-memory file bytes and never grants SHADOW production authority. Hidden Oracle checks demonstrate constructed regressions, not model understanding or causal Skill defects. Declared planning parameters are retained in request evidence; the frozen real adapter does not translate them into provider sampling options. Existing Recovery is preserved; no new Recovery algorithm or Phase 3 / Step 4 work was started.
