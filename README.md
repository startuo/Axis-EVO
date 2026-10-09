<p align="center">
  <img src="docs/assets/Axis.png" alt="Axis-Evo" width="100%">
</p>

# Axis-Evo

**面向大语言模型智能体的可信执行事实与不可变技能版本研究原型。**

Axis-Evo is a research prototype for durable agent execution facts, deterministic
acceptance, crash-state inspection, immutable skill versioning, explicit
skill authorization, and auditable Skill-conditioned model planning.

记录“准备做什么、观察到什么、实际持久化了什么”，为后续技能使用、演化与中断恢复建立可审查的基础。

当前实现到 **Phase 2 / Step 3 — Skill-guided Planning + Immutable Plan Provenance**。
调用方显式选择 TRUSTED 的不可变 Skill 版本，模型只提出计划；Core 严格校验并持久化提案，
调用方确认精确 Plan digest 后，原有 Skill-bound Runner 才执行。旧的显式计划 API 保持兼容。
运行时代码仅依赖 Python 标准库，要求 **Python 3.11+**；测试使用 pytest。

## 项目解决什么问题

智能体执行一次文件修改时，工具返回的 SUCCESS、文件当前内容和数据库中的执行记录，
可能在进程崩溃后留下不同的证据。Axis-Evo 将这些事实分别记录，避免把不完整的执行证据
误判为任务完成，或者把一次外部状态变化直接归因给工具。

项目围绕三个问题展开：

- **执行事实是否可靠？** 意图先提交、事件有序持久化，工具执行前后由 Core 记录文件观察。
- **任务是否真正完成？** 最终完成由独立的确定性 Acceptance 授权，而非模型声明或工具自报。
- **技能版本是否可追溯？** 每个 Skill 由稳定身份和整数版本定位，内容不可变，来源明确，生命周期历史只追加。

Runner 只执行已经确定的计划。新规划路径支持一次模型请求，不包含执行中重规划或多轮工具调用循环。
恢复、信任评估与技能自动演化尚未实现。

## 已实现能力

| 模块 | 当前能力 |
| --- | --- |
| Foundation | 严格 TaskSpec JSON、Event Envelope v1、canonical JSON / SHA-256、SQLite 持久化、显式 PluginRegistry |
| Sandbox / Tools | seed-copy 工作区、路径边界、Core 文件观察，以及 read_file / write_file / patch_file / run_tests |
| Runner / Acceptance | 显式顺序计划、执行事实编排、文件断言、独立 pytest 验收、原子终态提交 |
| Inspector | 只读执行轨迹检查、invocation 闭合一致性检查、未结束运行和缺失结果识别、外部状态比较 |
| Skill Registry | Skill Card v1、不可变 SkillRef、连续版本分配、来源验证、追加式生命周期、读取完整性校验 |
| Skill Binding / Trace | 整份计划预检、精确版本和工具授权、调用前提交不可变绑定、独立只读关联视图 |
| Skill Planning / Provenance | 单次模型规划、严格 Plan v1、不可变提案、精确 digest 审批、Run 关联和只读规划证据 |

Sandbox 提供工作区路径约束和文件观察；当前没有容器或操作系统级进程隔离。
`run_tests` 是受限 pytest 子进程入口，PluginRegistry 只负责显式注册和检索。

## 核心工程契约

### 1. 执行事实先于外部副作用

SQLite 连接使用 `foreign_keys=ON`、`journal_mode=WAL`、`synchronous=FULL` 和
`busy_timeout=5000`。事件的 run-local `seq` 在 `BEGIN IMMEDIATE` 内分配，`append_event()`
只有在 COMMIT 成功后才返回；失败回滚。时间戳是审计元数据，事件顺序以 `seq` 为准。

变更型工具的正常执行路径为：

```text
PRE observation
→ FILE_OBSERVED(reason=PRE_TOOL)
→ TOOL_INTENT COMMIT
→ tool.execute
→ POST observation
→ FILE_OBSERVED(reason=POST_TOOL)
→ TOOL_RESULT
→ optional STEP_CONFIRMED
```

工具的外部执行位于 SQLite transaction 之外。SQLite 与文件系统没有被包装为一个原子事务，
因此保留了意图提交后、结果提交前可能发生中断的 **Crash Window B**。

执行前必须验证 run/workspace 绑定和 invocation ID。一个 run 内的 `tool_call_id` 只能标识一次调用尝试；
Runner 预先提交的、完全匹配的单条 STEP_PLANNED 是唯一兼容前缀。

### 2. 完整结果证据与任务成功分别判断

`STEP_CONFIRMED` 表示该 invocation 已有完整持久化结果证据，**不表示步骤成功**。
FAILED ToolResult 仍可被确认，随后 Runner 正常终止为 RUN_FAILED。

`RUN_COMPLETED` 必须由 `VALIDATION_PASSED` 支持。工具 SUCCESS、模型声明完成，
甚至计划中主动调用 `run_tests` 通过，都不能替代最终 Acceptance。
终态 Event 与 `runs.status / ended_at` 在同一次 SQLite transaction 内原子提交。

文件断言支持 `exists`、`not_exists`、`contains`、`equals`。验收路径在计划执行前通过现有路径解析边界预检；
文本断言读取的原始字节必须与已记录 FileObservation 的 SHA-256 和大小一致，随后严格 UTF-8 解码，
不归一化换行。观察后内容发生变化会导致断言失败。

### 3. 崩溃后保留证据边界

硬退出可能留下 `RUNNING`、`ended_at=NULL` 和不完整事件前缀，不能自动补成 INTERRUPTED。
Inspector 依据实际记录报告：

| 观察 | 含义 |
| --- | --- |
| `UNFINISHED_RUN` | 持久化运行事实仍未结束 |
| `EXECUTION_RESULT_UNKNOWN` | invocation 已有 TOOL_INTENT，但缺少 TOOL_RESULT |
| `EXTERNAL_STATE_CHANGED` | 当前文件状态与已记录的执行前观察不同 |

文件变化不证明工具执行过；文件相同也不证明工具没有执行。Inspector 不重建缺失 ToolResult，
不执行恢复，也不修改 runs/events/schema 或任务工作区。
它通过 `mode=ro` 读取包括已提交 WAL 在内的事实，允许 SQLite 内部 WAL/SHM 协调 sidecar，
不使用可能漏读已提交 WAL 的 `immutable=1`。

### 4. Skill 内容不可变，生命周期只追加

Skill 使用以下身份定位一个不可变版本：

```text
SkillRef = skill_id + skill_version
```

- `skill_id` 严格匹配 `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`；`skill_version` 是正整数，bool 不算 int。
- 版本从 1 开始，在 `BEGIN IMMEDIATE` 内连续分配；失败不占版本号。
- 首版可 MANUAL，或 DERIVED 自已存在的其他 Skill 版本；后续版本必须 DERIVED。
- 支持跨 Skill 派生；来源必须预先存在，不能形成正常创建路径上的自指、未来引用或循环。
- 所有新版本从 CANDIDATE 开始，只能显式晋升 `CANDIDATE → SHADOW → TRUSTED`。
- 来源版本的 TRUSTED 状态不会继承给新版本；晋升不会改变 Card、hash 或来源。

Skill Card v1 只包含八个明确字段，生命周期不写入 Card：

```json
{
  "schema_version": 1,
  "skill_id": "config.timeout",
  "skill_version": 1,
  "name": "Update timeout",
  "description": "A recorded procedure for changing a timeout setting",
  "instructions": "Read the configuration, patch the value, then validate it.",
  "allowed_tools": ["read_file", "patch_file", "run_tests"],
  "source": {"kind": "MANUAL"}
}
```

DERIVED source 的固定形状为 `{"kind":"DERIVED","skill_id":"config.timeout","skill_version":1}`。
Card 使用现有 canonical JSON 字节计算 SHA-256；SQLite 触发器阻止既有身份、版本和历史行的修改/删除。
读取核对规范字节、hash、身份、来源、连续版本及生命周期历史；不一致抛出 `SkillIntegrityError`，不静默修复。

`TRUSTED` 当前只是显式生命周期状态，没有证据评分或 Trust Evaluator。
Card instructions 原文作为规划请求中的任务数据；执行授权仍由精确 SkillRef 和 allowed_tools 决定。
模型是否理解或遵循自然语言 instructions，不能由请求存在或任务成功推断。

### 5. Skill 授权绑定到一次调用

`run_task(..., *, run_id=None, skill_ref=None)` 增加可选的 keyword-only `skill_ref`。
默认 `None` 保留 legacy 执行，不要求 migration 002/003，也不增加 Skill 查询。
绑定模式只接受 exact `SkillRef`，不接受 dict、字符串或子类；不默认选择 latest，不回退版本。

整份计划在 Sandbox 和 run 创建前完成预检：参数是精确 JSON-native 快照，工具已注册，
指定版本及其历史通过完整性检查，当前状态为 TRUSTED，每一步工具名精确属于 allowed_tools。
空的绑定计划、越权的后续步骤和未初始化的 schema 都会拒绝。

每次调用先在独立 `BEGIN IMMEDIATE` 中复验授权并写入 `skill_invocation_bindings`，
COMMIT 成功后才继续原有 `STEP_PLANNED → PRE → TOOL_INTENT COMMIT → execute → POST → RESULT`。
外部工具执行仍位于事务之外。新表通过 `(run_id, tool_call_id)` 关联事件，
另以 `(run_id, step_id)` 唯一约束保证计划身份，保存精确 SkillRef、Card hash、参数 hash 和绑定时的 TRUSTED 状态。
SQL 触发器拒绝更新、删除、替换、终态 Run、非 TRUSTED、错误 Card hash 和越权工具；
完整 Card、canonical hash、来源及生命周期验证仍由 Core 的 SkillManager 负责。

`inspect_skill_trace()` 使用单一只读事务快照，区分 `stored_skill` 与 `verified_skill`，
按 `events.seq` 核对计划、意图和结果的身份及参数 hash，并检测绑定运行中的未绑定 intent。
绑定后尚未规划、规划后尚未产生 intent、intent 后尚无 result，均可属于有效中断前缀。
绑定证明持久化授权，不证明工具执行、任务成功、Skill 归因或重试安全；时间戳不作排序证据。

显式计划可继续只使用 Skill 授权；模型规划是可选入口，不改变原执行边界。

### 6. 模型提出计划，调用方确认 digest，Runner 执行

`generate_skill_plan()` 将已验证的完整 TaskSpec、精确 SkillRef、Card hash、instructions 原文、
allowed_tools、可信工具 schema、固定 Core policy、输出 schema 与资源限制组成 canonical JSON 请求。
适配器只接收这个不可变字符串，不获得 SQLite、Sandbox、Registry 或工具回调。
TaskSpec 和 Skill 文本都是任务数据，不能覆盖 Core 授权规则。

模型必须返回一个完整 JSON 对象：

```json
{
  "schema_version": 1,
  "steps": [{
    "step_id": "patch",
    "tool_name": "patch_file",
    "arguments": {"path": "config.json", "old": "\"timeout\": 10", "new": "\"timeout\": 20"}
  }]
}
```

顶层及 step 字段必须与上例完全一致。Core 拒绝 prose/fences、重复或未知键、截断、非有限数、
错误类型、重复/空 step ID、未知/越权工具和参数不匹配，不提取或修补 JSON。
只允许 Registry 中 exact 内置类型的 `read_file / write_file / patch_file / run_tests`，并与 Card allowlist 取交集。
前三者分别接收 `path`、`path/content`、`path/old/new` 字符串；patch 的 old 非空。
`run_tests` 接收 `{}` 或 `{"args": [string, ...]}`，还必须通过冻结的 pytest 参数白名单。
规划时仅检查可静态判定的路径形式；实际文件、父目录和 symlink 边界仍由 Sandbox 在执行时检查。
不自动探索或上传 seed/workspace 内容，也不声称静态验证保证未来调用成功。

| 限制 | 默认值 |
| --- | --- |
| Plan steps | 1–10 |
| 完整 semantic request | 128 KiB |
| provider response body / assistant response text | 各 64 KiB |
| canonical Plan JSON | 32 KiB |
| 单个文本参数 | 16 KiB |
| step ID / pytest args 数量 | 128 UTF-8 bytes / 64 |

不截断超限内容。request hash 是实际传给 adapter 并保存的 canonical UTF-8 字节的 SHA-256；
response hash 是原始 assistant response text 的 UTF-8 SHA-256；Plan hash 是校验后的 canonical Plan 字节的 SHA-256。
TaskSpec 与 Card 沿用既有 canonical digest，不能混用源文件或 pretty JSON hash。

提案生成期间先关闭读取快照，再调用 adapter；网络等待期间没有 SQLite 事务。
收到有效计划后，在独立 `BEGIN IMMEDIATE` 中复验精确 Card 与 TRUSTED 状态，插入提案并 COMMIT 后返回。
生成不创建 Run/workspace，不调用工具。被拒绝的规划尝试当前不保存为提案，也没有单独的失败尝试审计表。

执行时重新验证全部证据、TaskSpec、Skill 状态、注册工具和计划，要求调用方提交准确的小写 `plan_sha256`。
执行计划从 SQLite 重建，不能替换为调用方修改的列表。相同计划可以具有相同 digest；审批身份由明确的
`proposal_id + plan_sha256` 共同定位，不认证人类身份或证明人工阅读。
`plan_proposals / plan_run_links` 通过 SQL guards 拒绝 UPDATE、DELETE 和 REPLACE；一份提案只能关联一个 Run。

Runner 在 Sandbox 创建前预检提案，在 `create_run()` 后、`RUN_STARTED` 前提交关联，再进入原执行循环。
关联失败不能执行工具。由于 create_run 与关联使用独立事务，关联失败或并发消费的败方可能留下 seed copy
及无事件的 RUNNING Run；不伪造终态、不重试。工具失败后继续遵循冻结的 Runner 行为。

`inspect_planning_provenance()` 返回 `schema_version/run_id/mode/consistent/integrity_issues/proposal/steps`，
默认只显示 digest、身份与事件 seq，不返回完整请求/响应。它在单一只读快照中校验 schema、提案、Run 和调用绑定，
支持 `query_only=ON`，不迁移、不修复、不访问模型或 workspace。允许合法的不完整执行前缀。
无关联时显示 `LEGACY_UNPLANNED`；不能据此证明关联从未被有 DDL 权限的外部操作者删除。
此视图不替代原 Inspector 的 PRE/POST、闭合完整性或当前状态观察。

This phase provides auditable Skill-conditioned model planning and exact approved-Plan execution through the existing Runner.
It does not prove semantic obedience to Skill instructions or the absence of model error.

## 架构与目录

```mermaid
flowchart LR
    Task[TaskSpec + Verified Skill + Trusted Catalog] --> Request[Canonical Planning Request]
    Request --> Adapter[Planning Adapter]
    Adapter --> Validate[Strict Core Plan Validation]
    Validate --> Proposal[(Immutable Proposal)]
    Proposal --> Approval[Explicit Digest Approval]
    Approval --> Link[(Committed Run Link)]
    Link --> Runner
    Explicit[Legacy Explicit Plan] --> Runner
    Runner --> Core[Trusted Tool Invocation]
    Core --> Tools
    Tools --> Sandbox
    Sandbox --> Workspace[Task Workspace]
    Core --> Facts[(SQLite runs / events)]
    Runner --> Acceptance
    Acceptance --> Facts
    Facts --> Inspector[Read-only Inspector]
    Skills[SkillManager] --> Registry[(SQLite Skill Registry)]
    Registry --> Binding[Explicit Skill Authorization]
    Binding --> Runner
    Runner --> Bindings[(Immutable Invocation Bindings)]
    Bindings --> SkillTrace[Read-only Skill Trace]
    Facts --> SkillTrace
    Proposal --> PlanningTrace[Read-only Planning Provenance]
    Link --> PlanningTrace
    Facts --> PlanningTrace
```

Skill-aware Trace 与 Phase 1 Inspector 分开；原 Event Envelope、payload 与 Inspector 协议保持不变。

```text
src/axis_evo/
├── models.py                 # Task / Run / PlanStep / result / observation
├── events.py                 # Event Envelope 与事件类型
├── hashing.py                # canonical JSON 与 SHA-256
├── task_spec.py              # 严格 TaskSpec JSON 加载
├── storage.py                # SQLite 连接、事件与原子终态
├── plugins.py                # 最薄显式注册表
├── sandbox.py                # 路径解析、seed-copy、文件观察
├── tools.py                  # 文件工具、pytest 工具、可信调用入口
├── runner.py                 # 显式计划顺序执行
├── validators.py             # 独立确定性验收
├── inspector.py              # 只读检查与 CLI
├── skill_card.py             # SkillRef / SkillSource / SkillCard
├── skill_storage.py          # 显式 Skill schema 初始化
├── skill_manager.py          # 版本、来源、生命周期与完整性读取
├── skill_binding.py          # 显式授权、不可变调用绑定、只读 Skill trace
├── planning_adapter.py       # 窄规划接口、离线 double、可配置 HTTPS transport
├── skill_planner.py          # 请求构建、严格 Plan 校验、生成与审批执行
├── planning_provenance.py    # 不可变提案、关联、完整性检查与只读视图
└── migrations/
    ├── 001_phase1.sql        # runs / events
    ├── 002_phase2_skills.sql # skills / skill_versions / skill_state_events
    ├── 003_phase2_skill_bindings.sql # skill_invocation_bindings
    └── 004_phase2_skill_planning.sql # plan_proposals / plan_run_links

docs/
├── assets/Axis.png           # 项目封面原图
└── TEST_RESULTS.md           # 本地完整验证结果

README.md                    # 项目介绍与使用说明
AGENTS.md                    # 工程维护与提交规则
pyproject.toml               # 包配置与依赖声明
.gitignore                   # 本地材料与运行产物排除规则
```

测试源码、fixture、阶段交付报告和审查 ZIP 保留本地，不纳入远端仓库。

## 安装

从仓库根目录操作。Windows PowerShell：

```powershell
git clone https://github.com/startuo/Axis-EVO.git
cd Axis-EVO
python -m venv .venv
.\.venv\Scripts\python -m pip install -e .
```

Linux / macOS：

```bash
git clone https://github.com/startuo/Axis-EVO.git
cd Axis-EVO
python3 -m venv .venv
.venv/bin/python -m pip install -e .
```

当前没有第三方运行时依赖。任务需要使用 `run_tests` 或 pytest Acceptance 时，安装可选依赖
`python -m pip install -e ".[test]"`。项目自身的完整回归需在包含本地测试源码的审查包中运行。

## 最小任务示例

在项目根目录使用已安装本包的 Python 运行以下代码。示例自行创建 TaskSpec 和 seed，
复制到新工作区，把 timeout 从 10 改为 20，再执行独立文件断言验收。
每次生成新的任务、工作区与 run；数据保存在 Git 忽略的 `.local/` 下，无需测试 fixture。

```python
from pathlib import Path
from uuid import uuid4
import json

from axis_evo.inspector import inspect_database
from axis_evo.models import PlanStep
from axis_evo.plugins import PluginRegistry
from axis_evo.runner import run_task
from axis_evo.storage import connect_database
from axis_evo.tools import PatchFileTool

state_dir = Path(".local").resolve()
state_dir.mkdir(exist_ok=True)
task_dir = state_dir / f"task_{uuid4().hex}"
seed_dir = task_dir / "seed"
seed_dir.mkdir(parents=True)
(seed_dir / "config.json").write_bytes(b'{"timeout": 10}\n')
task_path = task_dir / "task.json"
task_path.write_text(json.dumps({
    "schema_version": 1,
    "task_id": "demo_timeout",
    "title": "Update timeout",
    "goal": "Change timeout from 10 to 20",
    "workspace": {"seed_dir": "seed"},
    "acceptance": {
        "pytest": {"enabled": False, "args": []},
        "file_assertions": [{
            "path": "config.json", "operator": "equals",
            "expected": '{"timeout": 20}\n',
        }],
    },
}), encoding="utf-8")
database = state_dir / "demo.sqlite3"
workspace = state_dir / f"workspace_{uuid4().hex}"
registry = PluginRegistry()
registry.register(PatchFileTool())

connection = connect_database(database)
try:
    run = run_task(
        connection,
        task_path,
        workspace,
        [PlanStep("update_timeout", "patch_file", {
            "path": "config.json",
            "old": '"timeout": 10',
            "new": '"timeout": 20',
        })],
        registry,
    )
finally:
    connection.close()

report = inspect_database(database, run.run_id)
print("run_id:", run.run_id)
print("status:", run.status)
print("trace.consistent:", report["trace"]["consistent"])
```

正常输出中 `status` 为 `COMPLETED`，`trace.consistent` 为 `True`。
没有调用模型，`model_plugin` 使用默认的 `explicit_plan` 审计标签。

Inspector 也提供 CLI，下面的 `RUN_ID` 替换为运行输出的实际 ID：

```powershell
.\.venv\Scripts\python -m axis_evo.inspector .local/demo.sqlite3 RUN_ID
.\.venv\Scripts\python -m axis_evo.inspector .local/demo.sqlite3 RUN_ID --format json
```

## Skill Registry 示例

下面的独立示例在临时数据库中演示创建、晋升和派生，不执行 Skill：

```python
from pathlib import Path
from tempfile import TemporaryDirectory

from axis_evo.skill_card import SkillSource
from axis_evo.skill_manager import SkillManager
from axis_evo.skill_storage import initialize_skill_schema
from axis_evo.storage import connect_database

with TemporaryDirectory() as directory:
    connection = connect_database(Path(directory) / "skills.sqlite3")
    try:
        initialize_skill_schema(connection)
        manager = SkillManager(connection)
        first = manager.create_version(
            "config.timeout",
            name="Update timeout",
            description="A recorded configuration-edit procedure",
            instructions="Read, patch, then validate the configuration.",
            allowed_tools=["read_file", "patch_file", "run_tests"],
        )
        manager.promote(first.skill_id, first.skill_version, "SHADOW")
        manager.promote(first.skill_id, first.skill_version, "TRUSTED")
        second = manager.create_version(
            "config.timeout",
            name="Update timeout v2",
            description="A derived procedure",
            instructions="Inspect the value, patch it once, then validate.",
            allowed_tools=["read_file", "patch_file", "run_tests"],
            source=SkillSource("DERIVED", first.ref),
        )
        print(first.ref, manager.get_current_state(first.skill_id, 1))
        print(second.ref, manager.get_current_state(second.skill_id, 2))
    finally:
        connection.close()
```

输出分别为 v1 TRUSTED 和 v2 CANDIDATE。`connect_database()` 本身仍只初始化 Phase 1；
只有显式调用 `initialize_skill_schema()` 才增加三个 Skill 表。Manager 构造和读取不自动迁移。
写 API 拒绝已有调用方事务；调用方负责关闭连接。

完整公开方法为：`create_version()`、`get_version()`、`list_versions()`、
`get_current_state()`、`get_state_history()`、`promote()`。

## 显式 Skill 绑定用法

在上面的最小任务示例中，于调用 `run_task()` 前显式初始化并选择版本：

```python
from axis_evo.skill_binding import initialize_skill_binding_schema, inspect_skill_trace
from axis_evo.skill_manager import SkillManager
from axis_evo.skill_storage import initialize_skill_schema

initialize_skill_schema(connection)
initialize_skill_binding_schema(connection)
manager = SkillManager(connection)
card = manager.create_version(
    "config.timeout",
    name="Update timeout",
    description="Authorize the explicit timeout patch",
    instructions="Read, patch, then validate the configuration.",
    allowed_tools=["patch_file"],
)
manager.promote(card.skill_id, card.skill_version, "SHADOW")
manager.promote(card.skill_id, card.skill_version, "TRUSTED")
```

随后在同一个 `run_task(...)` 调用中增加 `skill_ref=card.ref`，并在连接关闭前读取
`inspect_skill_trace(connection, run.run_id)`。此初始化示例使用新数据库；已有 Skill 应通过明确的
`SkillRef(skill_id, skill_version)` 选择，而不是重新创建版本或猜测 latest。

新模块提供四个入口：`initialize_skill_binding_schema(connection)`、
`preflight_skill_binding(connection, steps, skill_ref)`、
`record_skill_invocation_binding(connection, run_id, tool_call_id, step, skill_ref)`、
`inspect_skill_trace(connection, run_id)`。通常使用 Runner 完成预检和写入。
initializer 与 writer 要求 `foreign_keys=ON`；四个入口拒绝调用方活动事务，
并拒绝相关事实表被同名 TEMP table/view 遮蔽。无关 TEMP 对象允许存在。
SQLite 必须支持 JSON1；初始化会显式探测，不支持时明确拒绝，不静默降级授权规则。

Trace 的稳定顶层字段为 `schema_version / run_id / mode / consistent / issues / invocations`；
每项 invocation 含 step/call/tool、stored/verified Skill 身份、参数 hash、绑定状态及三个事件 seq。
`verified_skill=null` 表示版本身份未能完整验证，不能按存储引用宣称已验证。
零绑定行显示 `LEGACY_UNBOUND`。没有运行级绑定标记，因此无法仅凭该视图识别所有绑定被外部删除的情形。
该视图不替代 Phase 1 Inspector 的 PRE/POST 观察与 invocation 闭合检查。

## 模型规划 API 与离线示例

公开入口位于 `skill_planner.py / planning_provenance.py`：

```python
generate_skill_plan(connection, task_spec_path, skill_ref, tool_registry, model_adapter) -> PlanProposal
get_plan_proposal(connection, proposal_id) -> PlanProposal
execute_approved_skill_plan(connection, proposal_id, approved_plan_sha256,
                            task_spec_path, workspace_path, tool_registry, *, run_id=None) -> Run
inspect_planning_provenance(connection, run_id) -> dict
initialize_skill_planning_schema(connection) -> None
```

`PlanProposal` 是 frozen dataclass；`plan` 属性每次返回新的 PlanStep/arguments，持久证据存于不可变 JSON 字符串。
初始化顺序为 `connect_database → initialize_skill_schema → initialize_skill_binding_schema → initialize_skill_planning_schema`。
initializer 拒绝活动事务、缺失/弱前置 schema、`foreign_keys=OFF` 和大小写变体的 TEMP 事实遮蔽；
004 原子应用、可重复初始化，保留 PRAGMA。所有写入独占事务，活动调用方事务保持原样。
旧的显式或 Skill-bound Runner 均不要求 004。

下面是完整离线示例，不联系真实模型、不依赖本地 test fixture。两个 API 调用分别表示生成和调用方审批执行：

```python
from pathlib import Path
from tempfile import TemporaryDirectory
import json

from axis_evo.planning_adapter import StaticPlanningAdapter
from axis_evo.planning_provenance import initialize_skill_planning_schema, inspect_planning_provenance
from axis_evo.plugins import PluginRegistry
from axis_evo.skill_binding import initialize_skill_binding_schema
from axis_evo.skill_manager import SkillManager
from axis_evo.skill_planner import generate_skill_plan, execute_approved_skill_plan
from axis_evo.skill_storage import initialize_skill_schema
from axis_evo.storage import connect_database
from axis_evo.tools import PatchFileTool

with TemporaryDirectory() as directory:
    root = Path(directory)
    (root / "seed").mkdir()
    (root / "seed/config.json").write_bytes(b'{"timeout": 10}\n')
    task = root / "task.json"
    task.write_text(json.dumps({
        "schema_version": 1, "task_id": "guided_timeout", "title": "Update timeout",
        "goal": "Change timeout from 10 to 20",
        "workspace": {"seed_dir": "seed"},
        "acceptance": {"pytest": {"enabled": False, "args": []}, "file_assertions": [
            {"path": "config.json", "operator": "equals", "expected": '{"timeout": 20}\n'}]},
    }), encoding="utf-8")
    connection = connect_database(root / "facts.sqlite3")
    try:
        initialize_skill_schema(connection)
        initialize_skill_binding_schema(connection)
        initialize_skill_planning_schema(connection)
        manager = SkillManager(connection)
        card = manager.create_version("config.patch", name="Patch timeout", description="",
            instructions="Patch the timeout literal once; preserve other bytes.", allowed_tools=["patch_file"])
        manager.promote(card.skill_id, 1, "SHADOW")
        manager.promote(card.skill_id, 1, "TRUSTED")
        registry = PluginRegistry()
        registry.register(PatchFileTool())
        adapter = StaticPlanningAdapter(json.dumps({"schema_version": 1, "steps": [
            {"step_id": "patch", "tool_name": "patch_file", "arguments": {
                "path": "config.json", "old": '"timeout": 10', "new": '"timeout": 20'}}]}))
        proposal = generate_skill_plan(connection, task, card.ref, registry, adapter)
        print("Review proposal:", proposal.proposal_id, proposal.plan_json, proposal.plan_sha256)
        # Explicit trusted caller action for this deterministic example.
        # A real caller should review this exact proposal before confirming its digest.
        approved_digest = proposal.plan_sha256
        run = execute_approved_skill_plan(connection, proposal.proposal_id, approved_digest,
                                         task, root / "workspace", registry)
        print(run.status, inspect_planning_provenance(connection, run.run_id)["consistent"])
    finally:
        connection.close()
```

预期为 `COMPLETED True`。这证明真实 Core/Runner/SQLite 的离线链路，不能声称已验证远端模型服务。

## 显式启用真实模型 transport

`PlanningAdapter.plan(request_json: str) -> PlanningResponse(response_text, adapter_name, model_id)` 是窄接口。
适配器是受信任的本地 Python 代码，接口限制所传 authority，不是任意 Python 代码的安全沙箱。

`OpenAICompatiblePlanningAdapter` 使用 stdlib `http.client`，对完整 HTTPS chat/completions endpoint 做一次 POST。
配置示例（API key 在当前私有环境中另行设置，不写入代码、SQLite 或 Git）：

```python
import os
from axis_evo.planning_adapter import OpenAICompatiblePlanningAdapter

adapter = OpenAICompatiblePlanningAdapter(
    endpoint=os.environ["AXIS_EVO_MODEL_ENDPOINT"],  # full HTTPS URL including /chat/completions
    model_id=os.environ["AXIS_EVO_MODEL_ID"],
    api_key_env="AXIS_EVO_API_KEY",
    timeout_seconds=30,
)
# Explicitly calling generate_skill_plan(..., adapter) performs one real planning request.
```

没有强制模型版本。wire JSON 含 configured model、system policy、user semantic request、`n=1 / stream=false`；
不发送 provider tools/functions。只接受一个 assistant content 和 `finish_reason=stop`，拒绝截断及 provider tool calls。
不继承代理配置、不跟随重定向、不自动重试；明确拒绝 HTTP 错误、超限 body、坏 UTF-8/JSON 或缺失 content。
默认 30 秒是 socket operation timeout，不能保证 DNS 或整个请求的总时限；调用取消会传播。
固定分类异常不包含 provider body、URL、API key 或 Authorization header。

传输格式依据 [Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
和 [Python http.client](https://docs.python.org/3.12/library/http.client.html)。不同兼容服务仍需显式选择并自行核对兼容性。
数据库保留完整本地 semantic request 和原始 assistant text；它们可能含任务资料，应按本地证据管理。
配置标识不是 provider 身份认证；semantic request hash 不证明远端接收的 wire bytes，也不证明模型内部推理。
当前没有持久化 credential headers、HTTP debug logs 或 wire hash；没有运行真实 provider smoke test。
默认所有自动测试均为 fake/本地拦截 transport，不读取环境 key 后自动联系外网。
`run_tests` 在批准执行后会运行任务测试代码，不能称为无副作用规划检查；TRUSTED、schema 校验和审批也不保证任务语义安全。

## 验证记录

当前 Windows / Python 3.12.10 / SQLite 3.49.1 的本地完整回归结果：

```text
python -m pytest -q
1204 passed, 8 skipped in 49.45s
```

失败 0；pytest 未报告 warnings。8 个 skip 均为 Windows `WinError 1314` 符号链接权限限制，
具体 nodeid 与原因记录在 [测试结果](docs/TEST_RESULTS.md) 中，不计作通过。

测试使用真实生产代码、SQLite、并发连接和 subprocess hard exit，覆盖提交边界、Crash Window B、
路径约束、验收证据一致性、invocation 完整性、SQL 不可变性、真实 trigger / COMMIT 失败和 lineage 损坏。
进程硬退出测试验证已提交事实在进程退出后保留；没有声称验证断电或硬件故障。

详细命令和结果集中在 [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md)。
上述完整结果针对本地完整审查包；远端只保留实现、配置、使用说明及测试结果，
不包含项目自测源码、fixture、交付报告或审查 ZIP。需要完整复现时使用本地阶段审查包。

## 阶段状态与后续方向

| 阶段 | 状态 |
| --- | --- |
| Phase 1 / Step 1 — Foundation | 已完成、冻结 |
| Phase 1 / Step 2 — Sandbox + Tools + Core Observation | 已完成、冻结 |
| Phase 1 / Step 3 — Runner + Trace + Acceptance | 已完成、冻结 |
| Phase 1 / Step 4 — Inspector + Crash-State Detection | 已完成、冻结 |
| Phase 2 / Step 1 — Skill Card + Immutable Registry + Lifecycle + Lineage | 已实现、测试通过、审查包已交付 |
| Phase 2 / Step 2 — Explicit Skill Binding + Skill-aware Trace | 已实现，848 passed / 8 skipped，本地审查包已交付 |
| Phase 2 / Step 3 — Skill-guided Planning + Immutable Plan Provenance | 当前里程碑，独立回归与完整源码审查包交付 |
| 自动技能选择及演化 | 后续计划，尚未实现 |
| Trust Evaluator、Checkpoint、Recovery、多轮 LLM Tool Loop | 后续计划，尚未实现 |

当前版本没有自动技能应用、LLM 生成演化、trust score、故障归因、retry/resume/compensation 或 UI。
后续变更需要遵守已经冻结的执行证据和数据语义；新里程碑应独立实现、验证和审查。

项目维护：[startuo](https://github.com/startuo)。
