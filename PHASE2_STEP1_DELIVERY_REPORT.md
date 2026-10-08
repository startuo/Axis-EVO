Axis-Evo Phase 2 / Step 1 交付报告

阶段：Skill Card + Immutable Version Registry + Lifecycle + Lineage。
环境：Python 3.12.10；SQLite 3.49.1；Windows-11-10.0.22631-SP0。
验证时间（UTC）：2026-10-08T02:02:13.079547+00:00。本报告记录当前实际源码与测试结果。

**1. 新增生产文件**

- `src/axis_evo/skill_card.py`
- `src/axis_evo/skill_storage.py`
- `src/axis_evo/skill_manager.py`
- `src/axis_evo/migrations/002_phase2_skills.sql`

新增测试为 `tests/unit/test_skill_card.py`、`tests/integration/test_skill_manager.py`。
新增交付物为本报告和 `axis-evo-phase2-step1-review.zip`（内含 `REVIEW_MANIFEST.txt`）。
没有修改既有生产源码、测试、配置或依赖。

**2. 精确 Phase 2 schema**

三个表均为 `WITHOUT ROWID`。`skills` 以 `skill_id` 为主键；`skill_versions` 以
`(skill_id, skill_version)` 为主键并外键关联逻辑身份及来源版本；`skill_state_events`
以 `(skill_id, skill_version, transition_seq)` 为主键并外键关联版本。
没有修改 `runs`、`events` 或 migration 001。下面直接列出当前 migration 002 的内容：

```sql
CREATE TABLE IF NOT EXISTS skills (
    skill_id TEXT PRIMARY KEY NOT NULL CHECK (
        typeof(skill_id) = 'text' AND length(skill_id) BETWEEN 1 AND 128
        AND instr(skill_id, char(0)) = 0 AND skill_id GLOB '[A-Za-z0-9]*'
        AND skill_id NOT GLOB '*[^A-Za-z0-9._-]*'
    ),
    created_at TEXT NOT NULL CHECK (typeof(created_at) = 'text' AND length(trim(created_at)) > 0)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS skill_versions (
    skill_id TEXT NOT NULL,
    skill_version INTEGER NOT NULL CHECK (typeof(skill_version) = 'integer' AND skill_version >= 1),
    schema_version INTEGER NOT NULL CHECK (typeof(schema_version) = 'integer' AND schema_version = 1),
    card_json TEXT NOT NULL CHECK (typeof(card_json) = 'text'),
    card_sha256 TEXT NOT NULL CHECK (
        typeof(card_sha256) = 'text' AND length(card_sha256) = 64
        AND instr(card_sha256, char(0)) = 0 AND card_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    source_kind TEXT NOT NULL,
    source_skill_id TEXT NULL,
    source_skill_version INTEGER NULL,
    created_at TEXT NOT NULL CHECK (typeof(created_at) = 'text' AND length(trim(created_at)) > 0),
    PRIMARY KEY (skill_id, skill_version),
    FOREIGN KEY (skill_id) REFERENCES skills(skill_id),
    FOREIGN KEY (source_skill_id, source_skill_version) REFERENCES skill_versions(skill_id, skill_version),
    CHECK (
        (source_kind = 'MANUAL' AND skill_version = 1 AND source_skill_id IS NULL AND source_skill_version IS NULL)
        OR (source_kind = 'DERIVED' AND source_skill_id IS NOT NULL AND source_skill_version IS NOT NULL
            AND typeof(source_skill_version) = 'integer' AND source_skill_version >= 1)
    )
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS skill_state_events (
    skill_id TEXT NOT NULL,
    skill_version INTEGER NOT NULL CHECK (typeof(skill_version) = 'integer' AND skill_version >= 1),
    transition_seq INTEGER NOT NULL CHECK (typeof(transition_seq) = 'integer' AND transition_seq >= 1),
    state TEXT NOT NULL,
    occurred_at TEXT NOT NULL CHECK (typeof(occurred_at) = 'text' AND length(trim(occurred_at)) > 0),
    PRIMARY KEY (skill_id, skill_version, transition_seq),
    FOREIGN KEY (skill_id, skill_version) REFERENCES skill_versions(skill_id, skill_version),
    CHECK (
        (transition_seq = 1 AND state = 'CANDIDATE')
        OR (transition_seq = 2 AND state = 'SHADOW')
        OR (transition_seq = 3 AND state = 'TRUSTED')
    )
) WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS skills_insert_guard BEFORE INSERT ON skills
BEGIN
    SELECT CASE WHEN EXISTS (SELECT 1 FROM skills WHERE skill_id = NEW.skill_id)
        THEN RAISE(ABORT, 'Skill identity already exists') END;
END;

CREATE TRIGGER IF NOT EXISTS skill_versions_insert_guard BEFORE INSERT ON skill_versions
BEGIN
    SELECT CASE WHEN NEW.skill_version != (
        SELECT COALESCE(MAX(skill_version), 0) + 1 FROM skill_versions WHERE skill_id = NEW.skill_id
    ) THEN RAISE(ABORT, 'Skill version must be the next committed version') END;
    SELECT CASE WHEN NEW.source_kind = 'DERIVED' AND NOT EXISTS (
        SELECT 1 FROM skill_versions
        WHERE skill_id = NEW.source_skill_id AND skill_version = NEW.source_skill_version
    ) THEN RAISE(ABORT, 'Derived source must already exist') END;
END;

CREATE TRIGGER IF NOT EXISTS skill_state_events_insert_guard BEFORE INSERT ON skill_state_events
BEGIN
    SELECT CASE WHEN NEW.transition_seq != (
        SELECT COALESCE(MAX(transition_seq), 0) + 1 FROM skill_state_events
        WHERE skill_id = NEW.skill_id AND skill_version = NEW.skill_version
    ) THEN RAISE(ABORT, 'Lifecycle transition must be the next committed sequence') END;
END;

CREATE TRIGGER IF NOT EXISTS skills_no_update BEFORE UPDATE ON skills
BEGIN SELECT RAISE(ABORT, 'Skill identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS skills_no_delete BEFORE DELETE ON skills
BEGIN SELECT RAISE(ABORT, 'Skill identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS skill_versions_no_update BEFORE UPDATE ON skill_versions
BEGIN SELECT RAISE(ABORT, 'Skill versions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS skill_versions_no_delete BEFORE DELETE ON skill_versions
BEGIN SELECT RAISE(ABORT, 'Skill versions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS skill_state_events_no_update BEFORE UPDATE ON skill_state_events
BEGIN SELECT RAISE(ABORT, 'Lifecycle history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS skill_state_events_no_delete BEFORE DELETE ON skill_state_events
BEGIN SELECT RAISE(ABORT, 'Lifecycle history is append-only'); END;
```

**3. Skill Card v1 schema**

仅允许以下八个顶层字段，拒绝未知字段、缺失字段、重复 JSON 键及错误类型：

```json
{
  "schema_version": 1,
  "skill_id": "example.skill",
  "skill_version": 1,
  "name": "Example",
  "description": "",
  "instructions": "Procedure stored as data",
  "allowed_tools": ["read_file", "patch_file", "run_tests"],
  "source": {"kind": "MANUAL"}
}
```

DERIVED 的唯一形状为 `{"kind":"DERIVED","skill_id":"source.skill","skill_version":1}`。
`schema_version` 必须是 exact int 1；版本必须是正 exact int，bool 不算 int。
name/instructions 必须是非空 UTF-8 字符串；description 可为空。allowed_tools 输入必须是
exact list，元素为唯一非空 exact str，保留顺序。拒绝 tuple、Python 容器/标量子类、
非字符串键、非有限 JSON 常量及无效 UTF-8；不执行 instructions、不验证插件安装情况。

**4. SkillRef 语义**

frozen `SkillRef(skill_id, skill_version)`；skill_id 是 exact str，严格匹配
`[A-Za-z0-9][A-Za-z0-9._-]{0,127}`，不修剪或重写；版本是 exact int >= 1。
SkillSource 和 SkillCard 同样 frozen，allowed_tools 保存为 tuple 快照；to_dict 返回独立的
JSON-native dict/list；嵌套来源复制为新冻结对象，调用方后续修改不能改变已记录内容。

**5. 版本分配**

`create_version()` 在取得 `BEGIN IMMEDIATE` 后查询该 skill_id 的 COUNT/MAX，检查身份和
连续版本历史，分配 `MAX + 1`。首版为 1；没有调用方指定版本号的入口。SQL insert guard
再次拒绝非下一个版本。并发写者通过真实 SQLite 写锁串行分配；失败回滚不消耗版本。

**6. Canonical hashing**

复用 Phase 1 `hashing.canonical_json_bytes(card.to_dict())`；不新增序列化器。
card_json 保存这些字节的 UTF-8 文本；card_sha256 是对完全相同字节计算的 SHA-256
小写 hex。读取严格比较原始持久文本字节与 canonical bytes，随后核对 hash、schema、
身份和 source 列；不匹配抛出 `SkillIntegrityError`，不归一化、不修复。

**7. Lineage**

新 skill v1 可 MANUAL，或从已经存在的其他 skill 版本 DERIVED。v>1 必须 DERIVED。
创建前验证来源版本及其历史/祖先；SQL 同时要求来源版本在 INSERT 前存在。
允许跨 skill 派生；拒绝缺失、自指、未来来源和读取时发现的循环；同 skill 来源必须早于目标。
来源列与 Card source 必须完全一致，生命周期晋升不改变来源。时间戳仅为审计元数据。

**8. Lifecycle**

每个新版本在创建事务内写入 seq=1 CANDIDATE。只有显式 `promote()` 可以追加：
`CANDIDATE → SHADOW → TRUSTED`（seq=1→2→3）。不允许跳级、回退、重复晋升或状态继承；
TRUSTED 来源派生的新版本仍从 CANDIDATE 开始。当前状态由有效历史最后一行推导。
Card 内没有 lifecycle/trust 字段，也没有自动晋升或质量评分。

**9. 不可变性**

三个表各自有 BEFORE UPDATE / DELETE 拒绝触发器，共六个；另有三个 INSERT guard。
WITHOUT ROWID 加 INSERT guard 阻止 INSERT OR REPLACE 绕过保护，覆盖 recursive_triggers
开/关两种实际 SQL 测试。没有 rename/delete/update API；晋升只追加历史，不改变 card_json、
card_sha256、SkillRef 或 source。

**10. 事务边界**

创建：输入快照 → BEGIN IMMEDIATE → 版本/来源检查 → 可选逻辑身份 → immutable version
→ 初始 CANDIDATE → COMMIT → 返回。晋升：BEGIN IMMEDIATE → 完整性/下一状态检查
→ 追加事件 → COMMIT → 返回。复用冻结 storage._write_transaction()。
活动调用方事务会被拒绝且不提交/回滚调用方事务；foreign_keys 必须已开启，模块不改 PRAGMA。
异常含 COMMIT 失败均回滚；每次 INSERT 要求 rowcount==1，RAISE(IGNORE) 不能造成假成功。

**11. 显式初始化**

仅 `initialize_skill_schema(connection)` 应用 002；要求已有 runs/events 的 Axis-Evo 连接、
foreign_keys=ON、无活动调用方事务。通过 importlib.resources 读取 SQL，单次
BEGIN IMMEDIATE 应用并在 COMMIT 前将实际 sqlite_master 对象与同份 migration 的参考
schema 比较；错误/冲突/弱化 schema/额外关联对象均回滚。重复正常初始化幂等。
不改变连接 PRAGMA、runs/events、row_factory；无 import DDL，Manager 构造/读取不自动迁移。

**12. 新增测试**

Skill Card：95 个参数化用例；Manager：98 个参数化用例；共新增 193 个用例。
覆盖 exact types/strict JSON/canonical round trip/调用方变更、初次及后续版本/跨 skill 来源、
连续分配/真实并发/缺失中间版本、SQL UPDATE/DELETE/REPLACE 防护、生命周期和不继承、
真实 trigger ABORT/IGNORE、真实 COMMIT authorizer 拒绝、DDL 失败完整回滚、调用方事务、
query_only、弱 schema 拒绝、hash/身份/历史/来源损坏检测且不修复。
所有测试函数定位如下（含参数化函数，行号对应本包源码）：

- `tests/unit/test_skill_card.py:20` — `test_skill_ref_exact_identity`
- `tests/unit/test_skill_card.py:28` — `test_skill_ref_rejects_invalid_identifier`
- `tests/unit/test_skill_card.py:34` — `test_skill_ref_requires_positive_exact_integer`
- `tests/unit/test_skill_card.py:57` — `test_card_parser_rejects_invalid_field`
- `tests/unit/test_skill_card.py:64` — `test_card_parser_rejects_missing_field`
- `tests/unit/test_skill_card.py:71` — `test_card_parser_rejects_unknown_or_nonstring_key`
- `tests/unit/test_skill_card.py:77` — `test_card_snapshots_nested_input_and_returns_detached_json`
- `tests/unit/test_skill_card.py:96` — `test_card_round_trip_is_exact_canonical_json`
- `tests/unit/test_skill_card.py:107` — `test_card_accepts_empty_tools_description_and_preserves_text`
- `tests/unit/test_skill_card.py:122` — `test_card_json_rejects_malformed_or_ambiguous_json`
- `tests/unit/test_skill_card.py:131` — `test_card_rejects_non_json_native_values`
- `tests/unit/test_skill_card.py:137` — `test_card_rejects_python_container_and_scalar_subclasses`
- `tests/unit/test_skill_card.py:160` — `test_source_shapes_and_later_manual_card_rejection`
- `tests/unit/test_skill_card.py:174` — `test_duplicate_keys_in_otherwise_valid_card_are_rejected`
- `tests/integration/test_skill_manager.py:63` — `test_skill_schema_initialization_is_explicit_atomic_and_idempotent`
- `tests/integration/test_skill_manager.py:86` — `test_skill_initializer_rolls_back_partial_schema_on_real_ddl_failure`
- `tests/integration/test_skill_manager.py:95` — `test_initializer_requires_phase1_connection_and_foreign_keys`
- `tests/integration/test_skill_manager.py:110` — `test_first_manual_version_and_exact_card_hash`
- `tests/integration/test_skill_manager.py:124` — `test_second_version_and_contiguous_allocations_preserve_old_bytes`
- `tests/integration/test_skill_manager.py:136` — `test_lifecycle_trust_does_not_inherit_and_hash_or_lineage_never_changes`
- `tests/integration/test_skill_manager.py:159` — `test_missing_source_leaves_no_partial_new_skill`
- `tests/integration/test_skill_manager.py:168` — `test_manual_revision_is_rejected_without_consuming_version`
- `tests/integration/test_skill_manager.py:179` — `test_atomic_creation_rolls_back_on_real_trigger_failure`
- `tests/integration/test_skill_manager.py:199` — `test_commit_failure_rolls_back_all_skill_facts`
- `tests/integration/test_skill_manager.py:221` — `test_failed_revision_does_not_advance_version`
- `tests/integration/test_skill_manager.py:235` — `test_failed_promotion_does_not_advance_transition_sequence`
- `tests/integration/test_skill_manager.py:252` — `test_invalid_lifecycle_transitions_preserve_history`
- `tests/integration/test_skill_manager.py:271` — `test_immutable_rows_reject_direct_sql_mutation`
- `tests/integration/test_skill_manager.py:282` — `test_replace_cannot_bypass_immutability`
- `tests/integration/test_skill_manager.py:303` — `test_sql_rejects_skipped_manual_missing_self_or_forward_source`
- `tests/integration/test_skill_manager.py:315` — `test_schema_checks_reject_invalid_version_fields`
- `tests/integration/test_skill_manager.py:325` — `test_sql_lifecycle_backstop_rejects_invalid_initial_or_next_transition`
- `tests/integration/test_skill_manager.py:337` — `test_caller_mutation_before_begin_and_after_commit_cannot_change_card`
- `tests/integration/test_skill_manager.py:352` — `test_skill_write_rejects_and_preserves_active_caller_transaction`
- `tests/integration/test_skill_manager.py:375` — `test_query_only_reads_never_write_initialize_or_change_connection_settings`
- `tests/integration/test_skill_manager.py:397` — `test_get_version_rejects_persisted_disagreement_without_repair`
- `tests/integration/test_skill_manager.py:427` — `test_all_lifecycle_read_and_promote_apis_reject_corrupted_history`
- `tests/integration/test_skill_manager.py:454` — `test_read_and_derived_creation_reject_corrupt_lineage`
- `tests/integration/test_skill_manager.py:478` — `test_orphan_identity_or_version_is_detected_not_repaired`
- `tests/integration/test_skill_manager.py:493` — `test_version_allocation_and_state_order_are_inside_owned_transactions`
- `tests/integration/test_skill_manager.py:510` — `test_concurrent_version_allocation_is_contiguous_and_durable`
- `tests/integration/test_skill_manager.py:540` — `test_initializer_rejects_existing_weakened_or_unexpected_schema_atomically`
- `tests/integration/test_skill_manager.py:561` — `test_missing_middle_version_is_rejected_by_reads_promotion_and_derivation`
- `tests/integration/test_skill_manager.py:586` — `test_version_with_missing_logical_identity_is_rejected_without_repair`
- `tests/integration/test_skill_manager.py:600` — `test_invalid_earlier_version_cannot_hide_behind_count_equal_max`
- `tests/integration/test_skill_manager.py:630` — `test_initializer_commit_failure_rolls_back_all_migration_objects`

**13. Focused tests**

- `python -m pytest -q tests/unit/test_skill_card.py` → `95 passed in 0.11s`；exit=0。
- `python -m pytest -q tests/integration/test_skill_manager.py` → `98 passed in 3.00s`；exit=0。

**14. 完整回归**

- `python -m pytest -q` → `672 passed, 8 skipped in 25.52s`；exit=0。

退出码 0；失败 0；pytest 未报告 warnings。完整结果来自当前实际工作区，非 mock 结果。
Phase 1 的 hard crash、Crash Window B、Inspector WAL/read-only、Runner 和 Acceptance
测试保持原样并包含在本次完整回归中。

**15. Skipped tests 与原因**

共 8 个既有 symlink 用例因 Windows `[WinError 1314]`（原始错误：`客户端没有所需的特权。`）
跳过；新增 Skill 测试没有 skip。本次 skip 审计命令 `python -m pytest -q -rs -k symlink`
结果为 `8 skipped, 672 deselected in 0.27s`，退出码 0。具体 nodeid：

- `tests/integration/test_runner.py::test_external_symlink_assertion_preflight_blocks_mutating_plan`
- `tests/unit/test_inspector.py::test_external_symlink_is_not_followed_for_comparison[target]`
- `tests/unit/test_inspector.py::test_external_symlink_is_not_followed_for_comparison[parent]`
- `tests/unit/test_inspector.py::test_external_symlink_is_not_followed_for_comparison[root]`
- `tests/unit/test_sandbox.py::test_external_symlink_target_is_rejected`
- `tests/unit/test_sandbox.py::test_external_symlink_parent_blocks_existing_and_new_files`
- `tests/unit/test_sandbox.py::test_internal_symlink_is_allowed`
- `tests/unit/test_sandbox.py::test_seed_copy_preserves_external_symlink_without_copying_target`

Inspector 三个参数化用例原始 reason 前缀：
`OS symlink privilege unavailable: [WinError 1314]`。
其余五个原始 reason 前缀：
`OS cannot create the symlink required by this subcase: [WinError 1314]`。

**16. Phase 1 SHA-256 冻结检查**

本轮实施前记录的 13 个生产文件，当前全部相同（含 __init__.py 和 migration 001）。
测试执行前后与打包前后均核对；33 个旧源码/测试/fixture 的双列完整比较见 ZIP manifest。

| 文件 | 实施前 SHA-256 | 当前比较 |
| --- | --- | --- |
| `src/axis_evo/__init__.py` | `6b5994c4a777a58c3aae7c73e37747107e1a9c7d5c6d77796a7434760647f330` | 相同 |
| `src/axis_evo/events.py` | `b28ef2c515aee0dc1d14422301c7a7da238d526a65c3cfbd9ada9d2967788534` | 相同 |
| `src/axis_evo/hashing.py` | `7d71f6dca49509c03e95baef10ad37bbbf1ae5b41c1a492332bc9e8442d15d95` | 相同 |
| `src/axis_evo/inspector.py` | `416ef8ecda3b5ee19cdb2f8d628f8b7a944fdfcd8a904070ba914c3211c358c0` | 相同 |
| `src/axis_evo/models.py` | `41d9b701eeda3ec63515761910504f209b5bcd2faf1782d0bcdf4ea1c8d63eed` | 相同 |
| `src/axis_evo/plugins.py` | `a81a8772524edc09cad71e568f6f8cbe472e4a82f6aa46b3747da0fb7b421e54` | 相同 |
| `src/axis_evo/runner.py` | `c0bdab29696808dd6aa58b8f7ed691ffaf39e0b39f4fb4f71e0679bbc4d3d547` | 相同 |
| `src/axis_evo/sandbox.py` | `ab44a8f4ea0c40106553f4aad7f6f83bd25472ffe37f937630e0cbdf09d609b8` | 相同 |
| `src/axis_evo/storage.py` | `6528d98d65dbf229410283328b03e77d3109f2dc5b69b09a430fd03b1ca3a86d` | 相同 |
| `src/axis_evo/task_spec.py` | `472bd445c7e2a2cfc5f58bc50d382b6c397d062cbe1b5f33f094dd28d82e8fb2` | 相同 |
| `src/axis_evo/tools.py` | `9f3827c37937dae01cc422d240b1c4cc37d83ed9f4044577f0d874bf35bf0f73` | 相同 |
| `src/axis_evo/validators.py` | `f2450872553ceb4e2f4c69836db4c2d20566b9a4a05b2e2e1269e883dfbb1783` | 相同 |
| `src/axis_evo/migrations/001_phase1.sql` | `e1bb685bd6c358e9828a3a3e427c735012dabc0216a69adf8c6d956744d05e93` | 相同 |

**17. migration 001**

`src/axis_evo/migrations/001_phase1.sql` SHA-256 为
`e1bb685bd6c358e9828a3a3e427c735012dabc0216a69adf8c6d956744d05e93`，与实施前一致。
普通 connect_database() 的 Phase 1-only schema 行为不变。

**18. 既有测试**

20/20 个旧 tests/fixtures 文件 SHA-256 与本轮实施前一致。无修改、删除、弱化或恢复历史测试。
既有 README、pyproject.toml、.gitignore、STEP2/STEP4 报告亦与原 Step 4 ZIP 的字节一致。

**19. Runner / Inspector / Tools**

runner.py、inspector.py、tools.py 均与实施前字节一致；storage.py、sandbox.py 和其他
Phase 1 文件同样不变。TOOL_INTENT COMMIT、Crash Window B、STEP_CONFIRMED、Acceptance、
原子终态及 Inspector read-only/WAL 边界均沿用冻结实现。

**20. 没有 Skill execution**

没有 Runner Skill binding、Skill selection/application、instructions 执行、自动演化或新 Event
关联字段；没有修改 PlanStep、TaskRunner、execute_tool_call。当前只提供不可变版本基础。

**21. 未进入后续范围 / Git**

没有实现 Trust Evaluator、trust score、Recovery、Checkpoint、retry/resume/compensation、
Model Adapter 或 UI；没有进入 Phase 2 / Step 2。未进行 Git commit。
实际目录不是 Git repository；`git status --short` 返回：

```text
fatal: not a git repository (or any of the parent directories): .git
```

**22. 当前限制与证据边界**

- 生命周期晋升是显式状态转换，没有质量评估、技能执行或实际信任结论。
- API 原子创建保证身份/版本/初态一起提交；原始 SQL 可独立插入部分合法行，读取会拒绝
  孤立版本或不完整历史。SQL 触发器不等同于阻止有权限的 DROP TRIGGER/PRAGMA/外部文件重写。
- SHA-256 验证持久内容的一致性，没有外部签名/锚点，不能鉴别全部字段同时被特权重写。
- 正常创建以来源预先存在阻止循环/未来引用；读取核对来源、连续性及循环。无全局创建序号，
  无法在管理员协调重写全部事实后凭时间戳重建原始跨 skill 创建因果顺序。
- 初始化要求与 migration 002 的实际 sqlite_master 定义一致；不自动接受或修复手工变体 schema。
- 当前实际共收集 680 个测试用例；减去新增 193 为旧用例 487（479 passed、8 skipped）。
  附件引用历史 Windows baseline 为 487 passed + 8 skipped（共 495），与本轮实施前真实
  文件库存有 8 个用例差异。没有通过补写/删除旧测试强行凑数；本报告采用实际测试结果。
- 本 Windows 环境的 8 个 symlink 用例因 WinError 1314 未执行，不能把这些 skip 声称为通过。
