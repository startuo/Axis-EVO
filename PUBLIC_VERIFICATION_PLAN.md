# Public verification plan — Phase 3 / Step 3

Current corrected source bytes: `4b2f516405e2d2d7ee2613758f43f41475eb9c33`. Original milestone source: `406a0db1af87c48f3a696cfcda17fa9b3ead7467`. The following documentation-only publication commit has the same production bytes. The private manifest records both commits and the verified remote SHA; it is not a claim that a document can contain its own future commit hash.

Verification environment: Windows 11 build 22631, Python 3.12.10 and 3.13.5, SQLite 3.49.1, pytest 9.1.1. Current production SHA-256 manifest digest: `5e2bd3d3221e2d45b8e4f2d5cfa3505adc453123e3db1ba16f5b3c5270dac6f5` (SHA-256 over sorted compact JSON mapping each `src/axis_evo/*.py` and migration path to its raw-file digest). The private ZIP includes the mapping and every test/fixture byte.

## Public repository alone

The public source and `examples/consumer.py` allow an independent consumer to run a real deterministic task, inspect persisted events and a failed task, examine transaction/immutable SQL contracts, and construct their own disposable checks. These demonstrations do not reproduce the complete private security/fault/Oracle test suite or establish OS-level isolation, exactly-once external effects, general recovery safety, or Skill causality.

In a new clone, with Python 3.11+ (this correction was verified on 3.12.10 and 3.13.5), use PowerShell:

```powershell
git clone https://github.com/startuo/Axis-EVO.git
Set-Location Axis-EVO
git checkout 4b2f516405e2d2d7ee2613758f43f41475eb9c33
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
- Historical original full suite: `1991 passed, 14 skipped in 397.47s (0:06:37)`, 2005 collected, zero failures/errors. No warning summary was reported; no warning filter was added. The Python3.13 classification correction and actual current warnings/results are documented below; deprecated frozen API callers remain disclosed.
- Gate A passed before Gate B began: 1722 passed / 14 skipped / 1736 collected.
- Baseline historical counts remain historical; they are not presented as fresh Linux or remote CI results.

## External CI and licensing decisions

No GitHub Actions verification workflow was added or claimed to have run. Public external CI would require owner authorization to publish an appropriate test/fixture subset (or a separately authorized private CI evidence-access arrangement), explicit Windows/Linux jobs and Python versions, offline default model transport, artifact retention, and an actual successful remote run. Hidden Oracle access and test-publication policy must be decided first; this document grants no publication permission.

Options for the owner include [MIT](https://choosealicense.com/licenses/mit/) (permissive, preserving notices), [Apache-2.0](https://choosealicense.com/licenses/apache-2.0/) (permissive with an express patent grant and stated conditions), or [GPL-3.0](https://choosealicense.com/licenses/gpl-3.0/) (copyleft conditions on distribution). [GitHub's licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository) explains that public visibility alone is not a general permission to reuse, modify or redistribute; GitHub's viewing/forking terms are a separate boundary. Owner approval is required before choosing a project license.

## Current evidence limits

Descriptor/path checks reject tested hard-link/redirection attacks within the documented supported model; they are not a complete hostile OS sandbox. SQLite first-event admission serializes supported coordinator invocations across connections/processes, not arbitrary direct-SQL/old-binary writers. Shadow simulation uses in-memory file bytes and never grants SHADOW production authority. Hidden Oracle checks demonstrate constructed regressions, not model understanding or causal Skill defects. Declared planning parameters are retained in request evidence; the frozen real adapter does not translate them into provider sampling options. Existing Recovery is preserved; no new Recovery algorithm or Phase 3 / Step 4 work was started.

## Phase 3 / Step 3 compatibility correction — 2026-10-12

This is a compatibility correction, not a new milestone. User baseline: `9dd4c2284aa3595ded7dc7dd388b5991045665aa`. Owner documentation commit `d99d796d71288e435a70ba745447fe091a936258` was preserved. Tests ran in that HEAD's working tree with the one source correction below; the tested production bytes are now exactly committed as `4b2f516405e2d2d7ee2613758f43f41475eb9c33`. Raw crash ledgers truthfully retain the execution-time HEAD; later documentation-only commits do not change source or test bytes.

The original Python3.13.5 ten failures were reproduced before editing using an isolated actual Windows Python3.13.5 runtime. The user's Linux3.13.5 result (1990 passed/10 failed/5 skipped) is independent external evidence, not a locally repeated Linux run. Both local versions used Windows11 build22631, SQLite3.49.1 and pytest9.1.1.

| Python / phase | Command | Actual result |
| --- | --- | --- |
| 3.13.5 / before313 | `python -m pytest -q tests/unit/test_skill_trust.py` | 10 failed, 126 passed, 9050 warnings in 8.96s |
| 3.12.10 / targeted312-final | `python -m pytest -q tests/unit/test_skill_trust.py tests/unit/test_shadow_path_compatibility.py` | 182 passed in 8.13s |
| 3.13.5 / targeted313-final | `python -m pytest -q tests/unit/test_skill_trust.py tests/unit/test_shadow_path_compatibility.py` | 182 passed, 9180 warnings in 7.95s |
| 3.12.10 / full312 | `python -m pytest -q` | 2037 passed, 14 skipped in 322.71s (0:05:22) |
| 3.13.5 / full313 | `python -m pytest -q` | 2037 passed, 14 skipped, 73562 warnings in 287.97s (0:04:47) |

All 2005 original cases plus 46 new cases were collected in each final full run. Existing test source and assertions were unchanged. New private cases cover exact original Plan bytes/arguments/hash, nonportable aliases, invalid mixed-step Plans, unauthorized tools, traversal/absolute/drive/stream/device/NUL paths, malformed JSON, schema and original byte limits. Complete logs/XML/JSON, including the first new adversarial failure and subsequent passing reruns, remain in the private review package.

### Root cause and exact correction

The Shadow boundary invoked frozen production `_validated_plan()` before its own portable-path classification. This implicitly relied on Python3.12 `PureWindowsPath.is_reserved()` behavior. Python3.13 broadened reserved-name checks, so an ordinary `ValueError` was caught as `PLANNING_INVALID` before Shadow could emit `SimulationUnsupported` / `UNSUPPORTED`. The original validation matrix exercised Python3.12 only; disclosing deprecation debt did not verify cross-version behavior. This was our boundary-ordering and compatibility-coverage omission. The failing cases remained fail-closed; they did not establish unsafe execution.

Only `src/axis_evo/shadow_evaluation.py` changed in production. It now uses a detached validation-only filename spelling to isolate nonportable simulation forms from version-dependent reserved-name checks. That spelling preserves UTF-8 length and retains separators, traversal, drive, stream and device rejection. The frozen validator still validates the entire Plan, exact schema, all tool permissions and arguments, and limits before any `UNSUPPORTED` result. Original canonical Plan bytes/digest and original arguments are retained; the validation spelling is never persisted or executed. Ambiguous space-suffixed `..` segments are additionally conservatively rejected inside Shadow, without claiming a demonstrated host escape.

Frozen production planning validation was not weakened. Malformed/unauthorized/unsafe/oversized Plans remain `PLANNING_INVALID`; unsupported simulation does not grant execution authorization. No Runner, SkillManager, historical migration, schema, dependency, observation, transaction or Crash Window B behavior changed. No automatic state transition, new Recovery or Step4 work was added.

Python3.13 behavior reference: [official pathlib documentation](https://docs.python.org/3.13/library/pathlib.html#pathlib.PurePath.is_reserved).

### Warnings, skips and runtime limits

- before313: 9050 warnings. F:\嵌入式开发\毕设\axis-evo\src\axis_evo\skill_planner.py:121: DeprecationWarning: pathlib.PurePath.is_reserved() is deprecated and scheduled for removal in Python 3.15. Use os.path.isreserved() to detect reserved paths on Windows.
- targeted312-final: 0 warnings. No pytest warning summary.
- targeted313-final: 9180 warnings. F:\嵌入式开发\毕设\axis-evo\src\axis_evo\skill_planner.py:121: DeprecationWarning: pathlib.PurePath.is_reserved() is deprecated and scheduled for removal in Python 3.15. Use os.path.isreserved() to detect reserved paths on Windows.
- full312: 0 warnings. No pytest warning summary.
- full313: 73562 warnings. F:\嵌入式开发\毕设\axis-evo\src\axis_evo\sandbox.py:166: DeprecationWarning: pathlib.PurePath.is_reserved() is deprecated and scheduled for removal in Python 3.15. Use os.path.isreserved() to detect reserved paths on Windows.; F:\嵌入式开发\毕设\axis-evo\src\axis_evo\skill_planner.py:121: DeprecationWarning: pathlib.PurePath.is_reserved() is deprecated and scheduled for removal in Python 3.15. Use os.path.isreserved() to detect reserved paths on Windows.; F:\嵌入式开发\毕设\axis-evo\src\axis_evo\validators.py:38: DeprecationWarning: pathlib.PurePath.is_reserved() is deprecated and scheduled for removal in Python 3.15. Use os.path.isreserved() to detect reserved paths on Windows.

No warning filters were added. Python3.13 warnings remain from frozen `skill_planner.py:121`, `sandbox.py:166` and `validators.py:38` `PureWindowsPath.is_reserved()` callers as actually listed above. This deprecated API is scheduled for removal in3.15; replacing frozen callers is outside this correction. Full raw warning counts/messages/locations are retained. Isolated3.13 runtime installation emitted one cross-filesystem hardlink-to-copy fallback warning; no project dependency change, global PATH change or registry registration occurred.

- Python 3.12.10 `tests.integration.test_agent_episode::test_external_seed_symlink_is_rejected_before_episode_persistence`: Creating symlinks requires OS support and Windows symlink privilege
- Python 3.12.10 `tests.integration.test_agent_episode::test_episode_workspace_symlink_redirection_is_rejected_before_dispatch`: Creating symlinks requires OS support and Windows symlink privilege
- Python 3.12.10 `tests.integration.test_runner::test_external_symlink_assertion_preflight_blocks_mutating_plan`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_assertio0\\outside.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_assertio0\\task_assets\\seed\\external_link.txt'
- Python 3.12.10 `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[external_file]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_symlink_capture_rejected_0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_symlink_capture_rejected_0\\work\\link'
- Python 3.12.10 `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[internal_file]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_symlink_capture_rejected_1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_symlink_capture_rejected_1\\work\\link'
- Python 3.12.10 `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[ancestor]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_symlink_capture_rejected_2\\work' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_symlink_capture_rejected_2\\alias'
- Python 3.12.10 `tests.unit.test_checkpoint_manager::test_fifo_rejected_without_blocking`: POSIX FIFO is unavailable on Windows
- Python 3.12.10 `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[target]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_is_not_f0\\outside\\config.json' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_is_not_f0\\workspace\\config.json'
- Python 3.12.10 `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[parent]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_is_not_f1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_is_not_f1\\workspace\\parent'
- Python 3.12.10 `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[root]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_is_not_f2\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_is_not_f2\\workspace'
- Python 3.12.10 `tests.unit.test_sandbox::test_external_symlink_target_is_rejected`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_target_i0\\secret.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_target_i0\\workspace\\link.txt'
- Python 3.12.10 `tests.unit.test_sandbox::test_external_symlink_parent_blocks_existing_and_new_files`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_parent_b0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_parent_b0\\workspace\\link'
- Python 3.12.10 `tests.unit.test_sandbox::test_internal_symlink_is_allowed`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_internal_symlink_is_allow0\\workspace\\target.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_internal_symlink_is_allow0\\workspace\\link.txt'
- Python 3.12.10 `tests.unit.test_sandbox::test_seed_copy_preserves_external_symlink_without_copying_target`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_seed_copy_preserves_exter0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_seed_copy_preserves_exter0\\seed\\link'
- Python 3.13.5 `tests.integration.test_agent_episode::test_external_seed_symlink_is_rejected_before_episode_persistence`: Creating symlinks requires OS support and Windows symlink privilege
- Python 3.13.5 `tests.integration.test_agent_episode::test_episode_workspace_symlink_redirection_is_rejected_before_dispatch`: Creating symlinks requires OS support and Windows symlink privilege
- Python 3.13.5 `tests.integration.test_runner::test_external_symlink_assertion_preflight_blocks_mutating_plan`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_assertio0\\outside.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_assertio0\\task_assets\\seed\\external_link.txt'
- Python 3.13.5 `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[external_file]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_symlink_capture_rejected_0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_symlink_capture_rejected_0\\work\\link'
- Python 3.13.5 `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[internal_file]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_symlink_capture_rejected_1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_symlink_capture_rejected_1\\work\\link'
- Python 3.13.5 `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[ancestor]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_symlink_capture_rejected_2\\work' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_symlink_capture_rejected_2\\alias'
- Python 3.13.5 `tests.unit.test_checkpoint_manager::test_fifo_rejected_without_blocking`: POSIX FIFO is unavailable on Windows
- Python 3.13.5 `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[target]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_is_not_f0\\outside\\config.json' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_is_not_f0\\workspace\\config.json'
- Python 3.13.5 `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[parent]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_is_not_f1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_is_not_f1\\workspace\\parent'
- Python 3.13.5 `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[root]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_is_not_f2\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_is_not_f2\\workspace'
- Python 3.13.5 `tests.unit.test_sandbox::test_external_symlink_target_is_rejected`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_target_i0\\secret.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_target_i0\\workspace\\link.txt'
- Python 3.13.5 `tests.unit.test_sandbox::test_external_symlink_parent_blocks_existing_and_new_files`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_parent_b0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_parent_b0\\workspace\\link'
- Python 3.13.5 `tests.unit.test_sandbox::test_internal_symlink_is_allowed`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_internal_symlink_is_allow0\\workspace\\target.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_internal_symlink_is_allow0\\workspace\\link.txt'
- Python 3.13.5 `tests.unit.test_sandbox::test_seed_copy_preserves_external_symlink_without_copying_target`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_seed_copy_preserves_exter0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_seed_copy_preserves_exter0\\seed\\link'

The final local skips are 13 Windows symlink privilege cases and one POSIX FIFO case per runtime. No skip is reported as passed. No fresh Linux or live-provider run was performed; model adapter tests remain offline.

### Freeze and publication evidence

Compatibility baseline inventory: 102 existing production/test/fixture files; 101 unchanged; only Shadow changed. New test file: `tests/unit/test_shadow_path_compatibility.py` (46 cases, private).

- Shadow before SHA-256: `239102e68b23fd317d6a1fa8fcb67493f86c6ed1ffdc9089f3a92aa5593c43f9`.
- Shadow after SHA-256: `02f39e8539142ece2586bab5b5b4e141e83580d1242e0d8f5dc4c7e7304fa7f1`.
- Current production manifest SHA-256: `5e2bd3d3221e2d45b8e4f2d5cfa3505adc453123e3db1ba16f5b3c5270dac6f5`.
- Complete current 103-file production/test/fixture manifest SHA-256: `e9bf13c82a6b56fb2ae15a1d53aae2d8d49b443cd5684f4977cdfa5900254e24`.

Independent read-only review checked 3567 path combinations (no frozen-danger rejection bypass or UTF-8-length change), 480 invalid mixed Plans (all PLANNING_INVALID), and directly executed all46 new assertions on Python3.12. These are finite deterministic checks, not universal safety proof. Old Runner/SkillManager/frozen Planner and migrations001-009 are byte-identical to the compatibility baseline. The earlier GateA three authorized changes remain historical, not changes made by this correction.

Only the corrected source and necessary public documentation/test results are committed. Tests/fixtures/hidden Oracles/raw evidence/delivery reports/review ZIP remain local/private under AGENTS.md. Final Git and archive identity, byte count/member count/CRC and member digests are recorded after push in REVIEW_MANIFEST.txt and the private verified publication record. The review ZIP remains mandatory. No Step4.
