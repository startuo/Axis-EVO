# Axis-Evo Phase 1 / Step 4 交付报告

Step 4 实现 Inspector + Crash-State Detection。完整回归为 **444 passed, 8 skipped in 18.20s**，0 failed、0 warnings。Step 1–3 的 34 个既有源码、测试、fixture 与配置文件，均与本轮开始前的 SHA-256 基线一致；没有修改冻结实现、SQLite schema 或依赖，没有 Git commit。

## 1. 新增文件与实现边界

- `src/axis_evo/inspector.py`
- `tests/unit/test_inspector.py`
- `tests/integration/test_inspector_crash.py`
- 本报告 `STEP4_DELIVERY_REPORT.md`
- 审查包 `axis-evo-step4-review.zip`；其根目录含额外的 `REVIEW_MANIFEST.txt`。

没有修改既有文件。运行时仍为 stdlib-only，没有增加框架目录、持久化结构或新事件类型。

## 2. Public API 与 CLI

均位于 `src/axis_evo/inspector.py`：

| API | 位置 | 行为 |
|---|---|---|
| `inspect_run(connection, run_id) -> dict[str, Any]` | 177 行 | 拒绝空 ID、找不到的 run、活动 caller transaction；一次参数化 `LEFT JOIN SELECT ... ORDER BY e.seq` 获取已提交 run/event 快照 |
| `inspect_database(database_path, run_id) -> dict[str, Any]` | 356 行 | 仅打开既有主数据库，URI `mode=ro`，包含已提交 WAL；关闭所拥有的连接 |
| `format_inspection_json(report) -> str` | 373 行 | `ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False` |
| `format_inspection_text(report) -> str` | 377 行 | 显示存储状态、last event、观察、pending targets、完整性问题及不归因说明 |

已实现最小模块 CLI，默认 text，可选择 json：

```text
python -m axis_evo.inspector <database> <run_id>
python -m axis_evo.inspector <database> <run_id> --format json
```

CLI 使用同一 `mode=ro` API。没有修改其他 CLI 文件，不调用 Runner、Tool 或验收引擎。

## 3. 实际 inspection schema v1

固定顶层字段为 `inspection_schema_version`, `run`, `trace`, `observations`, `pending_invocations`, `current_state_issues`。正常 Crash B 输出形状：

```json
{
  "inspection_schema_version": 1,
  "run": {
    "run_id": "run_crash", "task_id": "demo_runner", "status": "RUNNING",
    "workspace_path": "<recorded absolute workspace>", "started_at": "<recorded timestamp>", "ended_at": null
  },
  "trace": {
    "event_count": 5, "last_seq": 5, "last_event_type": "TOOL_INTENT",
    "consistent": true, "issues": []
  },
  "observations": ["UNFINISHED_RUN", "EXECUTION_RESULT_UNKNOWN", "EXTERNAL_STATE_CHANGED"],
  "pending_invocations": [{
    "step_id": "step_crash", "tool_call_id": "<recorded call ID>", "tool_name": "write_file",
    "intent_seq": 5, "execution_result_unknown": true, "post_observation_present": false,
    "targets": [{
      "path": "config.json",
      "before": {"exists": true, "sha256": "<64 lowercase hex characters>", "size_bytes": 16},
      "current": {"observable": true, "exists": true, "sha256": "<64 lowercase hex characters>", "size_bytes": 16},
      "external_state_changed": true
    }]
  }],
  "current_state_issues": []
}
```

类型与异常形状也属于 v1：

- `inspection_schema_version` 固定整数 1；`event_count` 为非负整数；`consistent`、`post_observation_present` 为 bool；`execution_result_unknown` 固定 true。
- 正常 `run` 文本字段为 str，`ended_at` 为 str/null；正常 `last_seq` 为 int/null，`last_event_type` 为 str/null；正常 `step_id` 为 str/null，`intent_seq` 为 int。
- 对畸形 SQLite 元数据，这些字段保留可编码的 JSON scalar（str/int/有限 float/bool/null）；BLOB、非有限值、不可 UTF-8 编码的值输出 null 并报告完整性问题。输出的 null 不改写内部原始事实；例如非 NULL 的坏 `ended_at` 不会被当作 SQL NULL 而产生 `UNFINISHED_RUN`。
- `tool_call_id` 为非空 str；`tool_name` 为 str/null，null 表示 intent payload 不可用。
- `before` 为上述状态对象或 null；只有可信且一致的历史证据才返回非 null。
- 文件存在时，状态的 `sha256` 为 64 位小写十六进制 str，`size_bytes` 为非负 exact int；不存在时二者为 null，`exists` 为 exact bool。
- `current` 是 `{observable: true, exists, sha256, size_bytes}` 或 `{observable: false, reason: str}`。
- `external_state_changed` 为 bool/null；证据或当前状态无法建立比较时为 null。
- 每个 issue 必含 `code: str, message: str`；可含 `seq: JSON scalar`、`tool_call_id: str`、`path: str`，仅输出适用字段。
- `observations` 仅使用下述三个固定值，顺序固定。pending 按 intent 的 seq 顺序，targets 保留 intent 声明顺序；issues 依稳定检查顺序生成。

报告不含检查时刻、随机 ID、process ID、文件内容、推荐动作、置信度、故障归因、技能或信任字段。Event 的 schema_version 与 inspection_schema_version 是两个独立协议。

## 4. 三个事实观察的冻结定义

- `UNFINISHED_RUN`：原始 runs row 为 `status=RUNNING AND ended_at IS NULL`。Inspector 不改变它。
- `EXECUTION_RESULT_UNKNOWN`：同 run_id + tool_call_id 恰好一条已提交 TOOL_INTENT，且没有任何已记录 TOOL_RESULT。坏 result payload 仍代表 result row 存在，因此抑制“缺失结果”；重复 intent 只报告完整性问题，不挑一条作为 pending 依据。
- `EXTERNAL_STATE_CHANGED`：至少一个 pending target 的可信 PRE/intent before 与当前安全可观察状态不同。不存在→存在、存在→不存在、SHA 不同或大小不同均为变化。

变化不证明工具执行、成功或导致了变化；未变不证明未执行。POST_TOOL 不能替代 TOOL_RESULT，STEP_CONFIRMED 缺失不会使已存在 result 变成 unknown。不存在 intent 的 planned prefix 仅保留 unfinished 和真实 last event。

## 5. 证据完整性检查

事件以 seq 为唯一顺序权威，检查从 1 开始的连续严格递增序列、task_id 对应关系、schema_version=1、支持的 event type、文本 envelope 类型、invocation identity、重复 intent/result、result 在 intent 前、planned 与 intent 的 step/tool/arguments 匹配。

JSON payload 必须为对象，禁止重复键、非有限数字及不可 UTF-8 编码的字符串/键；按实际生产契约检查工具、观察、planned/confirmed、run started/task loaded、validation 和 completion 的 shape。不能解析的同 invocation 额外事件也会阻断可信 before，不能通过忽略坏行制造唯一事实。

每个 intent 的目标（包括已存 result 的调用）审计恰好一条先于 intent 的同 call/path PRE_TOOL，核对 step/task/schema 与 exact exists/hash/size。缺失、重复、矛盾或类型损坏使 before 不可信。独立有效目标仍可比较；同一路径重复目标不能任选第一条。

终态检查 runs.status、ended_at、terminal type/数量/末尾位置及时间一致性。COMPLETED 还检查其引用的最新前置 VALIDATION_PASSED。只报告，不修复、不重解释 row。

持久证据 issue codes：`SEQ_INCONSISTENT`, `TASK_ID_MISMATCH`, `UNSUPPORTED_EVENT_SCHEMA`, `UNSUPPORTED_EVENT_TYPE`, `INVALID_EVENT_PAYLOAD`, `INVALID_EVENT_ENVELOPE`, `INVALID_RUN_METADATA`, `INVOCATION_IDENTITY_MISMATCH`, `RUN_TERMINAL_STATE_MISMATCH`, `DUPLICATE_TOOL_INTENT`, `DUPLICATE_TOOL_RESULT`, `PRE_OBSERVATION_MISSING`, `PRE_OBSERVATION_DUPLICATE`, `PRE_OBSERVATION_INTENT_MISMATCH`。

## 6. 当前文件状态与不可观察行为

仅 pending intent 明确声明的 target 调用既有 `Sandbox.observe_file()`，不扫描整个工作区、不另建哈希实现、不解码或规范化内容。安全的绝对 `nested/..` 工作区写法保留 Step 2 兼容性；相对/损坏/缺失 workspace 或根目录重定向不会被猜测为有效根。

外逸 symlink、目录目标、缺失 parent、权限或 IO 失败返回 `observable=false`、`external_state_changed=null`，保留数据库级事实。`WORKSPACE_UNAVAILABLE` 与 `CURRENT_TARGET_UNOBSERVABLE` 放在 `current_state_issues`；这些当前环境问题本身不把完好的历史 trace 标成损坏。

## 7. 严格只读边界

连接 API 只发一条 SELECT；不 INSERT/UPDATE/DELETE、不 append_event/finish_run、不 commit/rollback caller、不修改 caller row_factory 或 PRAGMA。活动 caller transaction 在查询前拒绝。path API 不初始化 migrations、不切换 journal_mode。

按本轮用户明确确认的冻结定义：**Axis-Evo runs/events/schema 与任务 workspace 严格只读；允许 SQLite 自身在 mode=ro 下创建/维护内部 -wal/-shm 协调 sidecars。** 测试精确比较逻辑数据库快照、schema、workspace 文件路径/bytes/mtime；数据库目录物理零变化不是验收条件。普通检查禁止 `immutable=1`，必须读取已提交 WAL。

## 8. 新测试及对抗审查

新增 unit 文件 105 个用例（102 pass、3 个实际 symlink 权限 skip），integration 文件 6 个用例。全部 22 项要求均有对应：真实写后 hard exit、写前 hard exit、父进程第三方变更、创建/删除/原始 hash/独立 size 分支、result/POST 边界、正常完成、planned/validation/confirmation prefixes、PRE 匹配/缺失/重复/矛盾、重复 intent/result、逆序 timestamps、query_only 与完整 DB/FS 快照、workspace 不可用、外逸 symlink、non-mutating unknown、稳定 JSON/text/CLI、禁止因果与恢复结论。

额外覆盖 BLOB 元数据、重复 JSON keys、截断额外 PRE、surrogate 字符、非有限数字、bool/int 状态歧义、错误 tool_name/step/planned 参数、跨 run 同 call ID、resolved invocation 的 PRE 审计、safe path spelling、已提交 WAL、关闭 WAL 连接后的 sidecar 边界。

实施前 A/B/C 只读审查完成；由单一 owner 编辑。最终 D/E/F 复核已通过，独立复现的损坏证据反例已修复并加入新测试；终审十问第 9 项为 YES，其余均为 NO。没有编辑旧测试或更新其预期值。

## 9. 精确验证结果

Python **3.12.10**。

| 命令 | 最后结果 |
|---|---|
| `python -m pytest -q tests/unit/test_inspector.py` | 102 passed, 3 skipped in 3.18s |
| `python -m pytest -q tests/integration/test_inspector_crash.py` | 6 passed in 1.87s |
| `python -m pytest -q tests/integration/test_hard_crash.py tests/integration/test_tool_execution.py::test_hard_exit_after_external_effect_preserves_crash_window_b tests/integration/test_runner.py::test_runner_hard_exit_preserves_crash_window_b tests/integration/test_finish_run.py::test_hard_exit_inside_terminal_transaction_leaves_no_partial_transition` | 4 passed in 0.94s |
| `python -m pytest -q -rs -k symlink` | 8 skipped, 444 deselected in 0.34s |
| **`python -m pytest -q`** | **444 passed, 8 skipped in 18.20s；0 failed、0 warnings** |

本轮开发早期新测试的包装参数冲突，以及终审发现的 Inspector 边界问题均已修正；上表为最终源码状态的验证结果。

## 10. 所有 skipped 测试与实际原因

以下 8 项均实际触发 **WinError 1314：客户端没有所需的特权（A required privilege is not held by the client）**；不是按 Windows 平台固定跳过。保留原 5 项 skip，新加 3 项：

1. `tests/integration/test_runner.py::test_external_symlink_assertion_preflight_blocks_mutating_plan`
2. `tests/unit/test_sandbox.py::test_external_symlink_target_is_rejected`
3. `tests/unit/test_sandbox.py::test_external_symlink_parent_blocks_existing_and_new_files`
4. `tests/unit/test_sandbox.py::test_internal_symlink_is_allowed`
5. `tests/unit/test_sandbox.py::test_seed_copy_preserves_external_symlink_without_copying_target`
6. `tests/unit/test_inspector.py::test_external_symlink_is_not_followed_for_comparison[target]`
7. 同函数 `[parent]`
8. 同函数 `[root]`

因此本环境没有执行这 8 个 symlink 分支；生产 containment 未放宽，支持 symlink 的环境会实际运行新测试。

## 11. 冻结确认与剩余限制

34 个本轮前文件逐个 SHA-256 对比无差异，包括 storage/tools/sandbox/runner/validators/events/models/task_spec/hashing/plugins/__init__、001_phase1.sql、所有既有 tests/fixtures 和配置。现目录不是 Git repository（`git rev-parse --show-toplevel` 返回 not a git repository）；git status 不适用，未初始化仓库、未 commit。

Crash Window B 在原 Step 2、Step 3 和新 Inspector 真子进程测试中仍可复现；终态原子事务的既有硬退出测试仍通过。

没有实现 Recovery、Checkpoint、Skill、Trust、LLM、Phase 2 或下一阶段工作。schema、索引、migration、依赖均未改。

当前比较反映实际读取时的各个文件状态，不是整个 workspace 的原子快照；安全路径检查复用冻结 Sandbox，未引入并发文件系统锁或因果证明。当前观察可因外部变化而不可用，此时保守返回 null。严重到 SQLite 无法执行查询的损坏会抛 SQLite error；可解析的畸形执行证据以 issue 报告。Inspector 的小型报告不包含 file contents 或恢复决策。
