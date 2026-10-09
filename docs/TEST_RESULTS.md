# Phase 3 / Step 1 验证结果

日期：2026-10-09；Windows-11-10.0.22631-SP0；Python 3.12.10；SQLite 3.49.1。
预编辑 HEAD：`5ce6cb7bd6419d568ba6bbd1f72a25d309b6e4d1`。此前 1456 passed / 10 skipped / 1466 collected 是历史基线。

| Command | Actual result |
|---|---|
| python -m pytest -q tests/unit/test_checkpoint_manager.py | 25 passed, 4 skipped in 0.47s |
| python -m pytest -q tests/integration/test_checkpoint_storage.py | 25 passed in 10.90s |
| python -m pytest -q tests/integration/test_checkpoint_consistency.py | 37 passed in 15.87s |
| python -m pytest -q tests/fault_injection/test_fault_matrix.py | 12 passed in 6.81s |
| python -m pytest -q tests/integration/test_hard_crash.py | 1 passed in 0.28s |
| python -m pytest -q tests/integration/test_inspector_crash.py | 6 passed in 1.83s |
| python -m pytest -q tests/integration/test_skill_binding_crash.py | 2 passed in 0.54s |
| python -m pytest -q tests/integration/test_skill_guided_crash.py | 5 passed in 1.60s |
| python -m pytest -q tests/integration/test_agent_loop_crash.py | 7 passed in 2.49s |
| python -m pytest -q tests/experiments/test_agent_baseline.py | 11 passed in 8.83s |
| python -m pytest -q | 1555 passed, 14 skipped in 112.11s (0:01:52) |

完整收集 1569；通过 1555；失败 0；错误 0；跳过 14。
pytest 未报告 warnings，未新增过滤器。命令保持 `python -m pytest -q`；为收集审计结果，仅通过
`PYTEST_ADDOPTS=-ra --junitxml=<local .git path>` 启用 skip 明细和本地 JUnit 输出。

新增 103 cases；99 passed / 4 skipped。13 项 symlink skip 均为 Windows WinError 1314；1 项为 Windows 无 POSIX FIFO。
Windows junction 三项实际运行通过，不计入 symlink skip。未在本轮运行 Linux，不能把 Windows skip 记作 Linux pass。

## 完整 skip 明细

- `tests.integration.test_agent_episode::test_external_seed_symlink_is_rejected_before_episode_persistence`: Creating symlinks requires OS support and Windows symlink privilege
- `tests.integration.test_agent_episode::test_episode_workspace_symlink_redirection_is_rejected_before_dispatch`: Creating symlinks requires OS support and Windows symlink privilege
- `tests.integration.test_runner::test_external_symlink_assertion_preflight_blocks_mutating_plan`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_assertio0\\outside.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_assertio0\\task_assets\\seed\\external_link.txt'
- `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[external_file]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_symlink_capture_rejected_0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_symlink_capture_rejected_0\\work\\link'
- `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[internal_file]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_symlink_capture_rejected_1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_symlink_capture_rejected_1\\work\\link'
- `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[ancestor]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_symlink_capture_rejected_2\\work' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_symlink_capture_rejected_2\\alias'
- `tests.unit.test_checkpoint_manager::test_fifo_rejected_without_blocking`: POSIX FIFO is unavailable on Windows
- `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[target]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_is_not_f0\\outside\\config.json' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_is_not_f0\\workspace\\config.json'
- `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[parent]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_is_not_f1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_is_not_f1\\workspace\\parent'
- `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[root]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_is_not_f2\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_is_not_f2\\workspace'
- `tests.unit.test_sandbox::test_external_symlink_target_is_rejected`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_target_i0\\secret.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_target_i0\\workspace\\link.txt'
- `tests.unit.test_sandbox::test_external_symlink_parent_blocks_existing_and_new_files`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_parent_b0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_parent_b0\\workspace\\link'
- `tests.unit.test_sandbox::test_internal_symlink_is_allowed`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_internal_symlink_is_allow0\\workspace\\target.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_internal_symlink_is_allow0\\workspace\\link.txt'
- `tests.unit.test_sandbox::test_seed_copy_preserves_external_symlink_without_copying_target`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_seed_copy_preserves_exter0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_seed_copy_preserves_exter0\\seed\\link'

## 故障与冻结审计

独立 F0–F9 实验：7 个真实 exit70，3 个正常 exit0；F6 无已提交 checkpoint，F7 提交的 checkpoint 存活。
Crash B：先保存 Step1 checkpoint(cursor8, timeout15)，Step2 实际变为20，缺 TOOL_RESULT / STEP_CONFIRMED，
Run 保持 RUNNING / ended_at NULL；Inspector 为 UNFINISHED_RUN / EXECUTION_RESULT_UNKNOWN / EXTERNAL_STATE_CHANGED。
无 restore/retry/resume/Recovery。父进程直接读取 bytes；test-only ledger 只记录 execute 入口。
损坏检测样本 1/1；未知结果样本 2/2；oracle mismatch、错误确认和额外调用案例均0。这些是有限 fixture 的检出比例，不是普遍正确率。

66 个冻结 production/test/fixture、pyproject.toml 及5个已存在生成 metadata：72项 SHA256 全一致。
新模块与006显式启用；Runner、Tools、Inspector、001–005以及旧测试未改，依赖未改。
所有测试 offline；未运行真实模型 provider smoke test。检查只读允许 SQLite 内部 WAL/SHM 协调，不使用 immutable=1。

## 历史 Phase 2 / Step 4 记录

### Phase 2 / Step 4 验证结果

验证日期：2026-10-09。Windows；Python 3.12.10；SQLite 3.49.1。
预编辑 HEAD：7ae0e88681ce9d5cffa02359626736e52281b722。此前 Step3 记录为1204 passed / 8 skipped / 1212 collected；这不是本轮新结果。

| Command | Actual result |
| --- | --- |
| python -m pytest -q tests/unit/test_agent_feedback.py | 45 passed in 4.96s |
| python -m pytest -q tests/unit/test_agent_loop.py | 50 passed in 4.86s |
| python -m pytest -q tests/integration/test_agent_episode.py | 139 passed, 2 skipped in 21.23s |
| python -m pytest -q tests/integration/test_agent_loop_crash.py | 7 passed in 2.94s |
| python -m pytest -q tests/experiments/test_agent_baseline.py | 11 passed in 9.44s |
| python -m pytest -q tests/unit/test_skill_planner.py | 97 passed in 5.36s |
| python -m pytest -q tests/unit/test_planning_adapter.py | 152 passed in 0.26s |
| python -m pytest -q tests/integration/test_planning_provenance.py | 81 passed in 5.35s |
| python -m pytest -q tests/integration/test_skill_guided_run.py | 21 passed in 2.38s |
| python -m pytest -q tests/integration/test_skill_guided_crash.py | 5 passed in 1.85s |
| python -m pytest -q tests/integration/test_runner.py | 82 passed, 1 skipped in 5.63s |
| python -m pytest -q tests/integration/test_skill_aware_runner.py | 30 passed in 2.62s |
| python -m pytest -q tests/integration/test_skill_binding_crash.py | 2 passed in 0.60s |
| python -m pytest -q tests/integration/test_inspector_crash.py | 6 passed in 2.18s |
| python -m pytest -q | 1456 passed, 10 skipped in 90.64s (0:01:30) |

完整收集 1466；通过 1456；失败 0；错误 0；跳过 10；pytest未报告warnings。
相比1212项旧测试，新增254项，其中252通过、2项symlink skip，未弱化旧测试。
各次命令用PYTEST_ADDOPTS添加JUnit输出至.git/phase2-step4-tests-*.xml，未改变测试选择或skip。
最后一次验证期间生产与测试快照未变；最终完整结果针对当前所有源码与测试。

新证据：真实SQLite/Runner/Acceptance、模型调用前allocation COMMIT、v2 exact request和v1 saved golden、
exact approval/一次性dispatch、fresh原seed、反馈完整性、SQL ABORT/IGNORE/COMMIT失败、并发预算、
BLOB/manifest腐败、query_only、7个真实hard-exit边界、独立oracle七案例。
新测试分布为45 feedback、50 Agent API、141 Episode（139 passed/2 skipped）、7 crash、11 baseline。
旧frozen快照54项：52项byte-identical，仅2个授权Step3模块有additive v2变更；Runner、001–004、依赖和30个旧test/fixture unchanged。

精确skip nodeid与原因（不算通过）：

- tests.integration.test_agent_episode::test_external_seed_symlink_is_rejected_before_episode_persistence: Creating symlinks requires OS support and Windows symlink privilege
- tests.integration.test_agent_episode::test_episode_workspace_symlink_redirection_is_rejected_before_dispatch: Creating symlinks requires OS support and Windows symlink privilege
- tests.integration.test_runner::test_external_symlink_assertion_preflight_blocks_mutating_plan: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_assertio0\\outside.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_assertio0\\task_assets\\seed\\external_link.txt'
- tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[target]: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_is_not_f0\\outside\\config.json' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_is_not_f0\\workspace\\config.json'
- tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[parent]: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_is_not_f1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_is_not_f1\\workspace\\parent'
- tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[root]: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_is_not_f2\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_is_not_f2\\workspace'
- tests.unit.test_sandbox::test_external_symlink_target_is_rejected: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_target_i0\\secret.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_target_i0\\workspace\\link.txt'
- tests.unit.test_sandbox::test_external_symlink_parent_blocks_existing_and_new_files: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_parent_b0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_parent_b0\\workspace\\link'
- tests.unit.test_sandbox::test_internal_symlink_is_allowed: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_internal_symlink_is_allow0\\workspace\\target.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_internal_symlink_is_allow0\\workspace\\link.txt'
- tests.unit.test_sandbox::test_seed_copy_preserves_external_symlink_without_copying_target: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_seed_copy_preserves_exter0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_seed_copy_preserves_exter0\\seed\\link'

默认测试全部离线；真实provider smoke未运行，Linux与断电实验未运行。没有Recovery/Checkpoint/TrustEvaluator/自动Skill演化。
本地完整审查证据包括PHASE2_STEP4_DELIVERY_REPORT.md、AGENT_BASELINE_REPORT.md、axis-evo-phase2-step4-review.zip。
Git只提交实现/必要配置README/本测试结果，不提交tests、fixture、报告或ZIP。

---

以下保留此前历史验证记录，非本轮结果：

# Phase 2 / Step 3 验证结果

验证日期：2026-10-09。Windows；Python 3.12.10；SQLite 3.49.1。
实际baseline 49d408c2e40771751fc23401b7f475f46280e16d，预编辑848 passed / 8 skipped / 856 collected。

| Command | Actual result |
| --- | --- |
| python -m pytest -q tests/unit/test_skill_planner.py | 97 passed in 5.94s |
| python -m pytest -q tests/unit/test_planning_adapter.py | 152 passed in 0.28s |
| python -m pytest -q tests/integration/test_planning_provenance.py | 81 passed in 6.43s |
| python -m pytest -q tests/integration/test_skill_guided_run.py | 21 passed in 2.79s |
| python -m pytest -q tests/integration/test_skill_guided_crash.py | 5 passed in 1.86s |
| python -m pytest -q tests/integration/test_runner.py | 82 passed, 1 skipped in 5.88s |
| python -m pytest -q tests/integration/test_skill_aware_runner.py | 30 passed in 3.23s |
| python -m pytest -q tests/integration/test_skill_binding_crash.py | 2 passed in 0.90s |
| python -m pytest -q tests/integration/test_skill_manager.py | 98 passed in 3.21s |
| python -m pytest -q tests/integration/test_inspector_crash.py | 6 passed in 2.68s |
| python -m pytest -q | 1204 passed, 8 skipped in 49.45s |

full collected 1212；失败0，错误0；pytest未报告warnings。新增356项通过，无新增skip。
JUnit：.git/phase2-step3-tests-*.xml，不改变测试选择或skip；默认全离线。README独立demo实测COMPLETED True。

8项历史skip精确原因：

- tests/integration/test_runner.py::test_external_symlink_assertion_preflight_blocks_mutating_plan: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_assertio0\\outside.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_assertio0\\task_assets\\seed\\external_link.txt'
- tests/unit/test_inspector.py::test_external_symlink_is_not_followed_for_comparison[target]: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_is_not_f0\\outside\\config.json' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_is_not_f0\\workspace\\config.json'
- tests/unit/test_inspector.py::test_external_symlink_is_not_followed_for_comparison[parent]: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_is_not_f1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_is_not_f1\\workspace\\parent'
- tests/unit/test_inspector.py::test_external_symlink_is_not_followed_for_comparison[root]: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_is_not_f2\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_is_not_f2\\workspace'
- tests/unit/test_sandbox.py::test_external_symlink_target_is_rejected: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_target_i0\\secret.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_target_i0\\workspace\\link.txt'
- tests/unit/test_sandbox.py::test_external_symlink_parent_blocks_existing_and_new_files: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_parent_b0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_parent_b0\\workspace\\link'
- tests/unit/test_sandbox.py::test_internal_symlink_is_allowed: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_internal_symlink_is_allow0\\workspace\\target.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_internal_symlink_is_allow0\\workspace\\link.txt'
- tests/unit/test_sandbox.py::test_seed_copy_preserves_external_symlink_without_copying_target: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_seed_copy_preserves_exter0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_seed_copy_preserves_exter0\\seed\\link'

新增证据：actualrequest字节、严格Plan/limits/权限、无审批零Run/workspace、exacthash、Task变更、
proposal/cross-field/Skill损坏、SQL不可变性、TEMPshadow、真实ABORT/IGNORE/COMMIT失败、并发单消费、
query_only只读、legacy无需004、真实hard-exit/CrashB。CrashB保留proposal/link/Skillbinding及原UNKNOWN/CHANGED边界。

50项预编辑快照中仅runner.py改变，其余49项字节相同：18个冻结生产/SQL文件、25个旧测试/fixture、pyproject.toml；另5个既有egg-info元数据也一致，但不进入ZIP。
未运行真实provider、Linux或断电实验。没有Recovery/Checkpoint/TrustEvaluator/自动Skill演化或下一里程碑。
完整本地证据见axis-evo-phase2-step3-review.zip；Git仅实现/必要文档/本测试结果，无tests/fixtures/报告/ZIP。

---

以下保留此前Phase2Step2历史记录，非本轮结果：

# Phase 2 / Step 2 验证结果

验证日期：2026-10-08。Windows；Python 3.12.10；SQLite 3.49.1。
基线提交：`46cce8d5b45cc20b99336708180f395e1f96fa1e`。

| 命令 | 最新结果 |
| --- | --- |
| `python -m pytest -q tests/unit/test_skill_binding.py` | 144 passed in 6.31s |
| `python -m pytest -q tests/integration/test_skill_aware_runner.py` | 30 passed in 2.70s |
| `python -m pytest -q tests/integration/test_skill_binding_crash.py` | 2 passed in 0.70s |
| `python -m pytest -q tests/integration/test_runner.py` | 82 passed, 1 skipped in 6.35s |
| `python -m pytest -q tests/integration/test_inspector_crash.py` | 6 passed in 2.23s |
| `python -m pytest -q tests/integration/test_skill_manager.py` | 98 passed in 3.49s |
| `python -m pytest -q` | **848 passed, 8 skipped in 39.63s** |

完整回归收集 856 项；失败 0，错误 0，pytest 未报告 warnings。
完整测试使用 `PYTEST_ADDOPTS=--junitxml=.git/phase2-step2-pytest.xml` 保存本地结果，未改变测试选择或跳过规则。
相比基线 672 passed / 8 skipped，新增 176 项全部通过，无新增 skip。

8 项历史 skip 均因 Windows `WinError 1314`，当前进程无创建 symlink 所需权限：

- `tests/integration/test_runner.py::test_external_symlink_assertion_preflight_blocks_mutating_plan`
- `tests/unit/test_inspector.py::test_external_symlink_is_not_followed_for_comparison[target]`
- `tests/unit/test_inspector.py::test_external_symlink_is_not_followed_for_comparison[parent]`
- `tests/unit/test_inspector.py::test_external_symlink_is_not_followed_for_comparison[root]`
- `tests/unit/test_sandbox.py::test_external_symlink_target_is_rejected`
- `tests/unit/test_sandbox.py::test_external_symlink_parent_blocks_existing_and_new_files`
- `tests/unit/test_sandbox.py::test_internal_symlink_is_allowed`
- `tests/unit/test_sandbox.py::test_seed_copy_preserves_external_symlink_without_copying_target`

验证覆盖真实 SQLite SQL 拒绝、IGNORE/REPLACE、事务内复验、第二连接可见性、并发冲突、
真实 deferred-FK COMMIT 失败回滚、Card/历史/来源损坏、TEMP 同名事实遮蔽，以及两个 subprocess hard-exit 边界。
新绑定在 `STEP_PLANNED` 前提交；外部工具执行无外层 SQLite transaction；Crash Window B 保留。
既有 Runner 和 Inspector 崩溃回归继续通过，不增加工具执行或 Skill 归因结论。

冻结审计：40 项基线哈希中，仅授权的 `runner.py` 改变；其余 16 个旧生产文件、22 个旧测试/fixture、
`pyproject.toml` 均字节一致。迁移 001/002、storage/tools/sandbox/Inspector、Skill Registry 与依赖配置未改。
E/F/G 只读复审完成；发现的 TEMP namespace 问题已在新模块修复并独立复现验证关闭。

本记录针对**本地完整源码审查包**。按用户规则，Git 只上传实现、必要文档及测试结果；
全部测试源码、fixture 和交付报告已移出 Git 跟踪，本地原文件与审查包保留。
完整内容位于 `axis-evo-phase2-step2-review.zip`。远端不含项目自测源码，单独克隆远端无法复现上述测试数量。

以上证据验证进程硬退出后的提交持久性，未开展断电或硬件故障实验。
未开始 Phase 2 / Step 3、Recovery、Checkpoint、Trust Evaluator 或真实模型循环。

2026-10-08 仓库结构整理：仅更新发布文件布局与说明，生产源码、SQL、依赖、测试/fixture 原文件均未修改。
完整 pytest 结果沿用上述实现验证，本次未重复运行全量测试。
README legacy 与 Skill-bound 示例在独立临时目录运行均为 COMPLETED，Inspector trace 一致；绑定示例的 Skill trace 也一致。
56 个本地保留文件（源码、SQL、测试/fixture、报告、封面和审查包）哈希核对通过；Git 清理清单与文档链接检查通过。
