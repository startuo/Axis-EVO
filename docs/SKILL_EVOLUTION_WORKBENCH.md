# Skill 演化工作台

入口：Runtime → 更多功能 → **Skills · 演化工作区**。工作台读取当前项目的真实注册表，不会把开发 Codex Skills 当成 Axis-Evo SkillCard。

## 管理员准备

先按 [工作台启动说明](WORKBENCH_SETUP.md) 配置 Core 数据库、受控 workspace、Provider 凭据环境引用和精确 TRUSTED Skill。凭据只在后端配置，浏览器不接收 API Key。

演化使用已有 Core 治理，不能通过浏览器自动初始化或绕过。已有迁移 001–004 的数据库可由管理员显式按依赖顺序初始化：

```python
from axis_evo.storage import connect_database
from axis_evo.agent_episode_storage import initialize_agent_episode_schema
from axis_evo.checkpoint_storage import initialize_checkpoint_schema
from axis_evo.recovery_storage import initialize_recovery_schema
from axis_evo.skill_trust_storage import initialize_skill_trust_schema
from axis_evo.skill_evolution import initialize_skill_evolution_schema, enable_evolution_governance
from axis_evo.shadow_evaluation import create_shadow_suite
import json

connection = connect_database("/absolute/path/to/core.sqlite3")
try:
    for initialize in (
        initialize_agent_episode_schema, initialize_checkpoint_schema,
        initialize_recovery_schema, initialize_skill_trust_schema,
        initialize_skill_evolution_schema,
    ):
        initialize(connection)
    with open("/absolute/path/to/admin-reviewed-suite.json", encoding="utf-8") as stream:
        definition = json.load(stream)
    suite = create_shadow_suite(connection, definition)
    enable_evolution_governance(connection, {
        "policy_id": "evolution-gate-v1",
        "suite_id": suite.data["suite_id"],
        "suite_sha256": suite.fact_sha256,
        "minimum_eligible_cases": 5,
        "repetitions_per_case": 1,
    })
finally:
    connection.close()
```

套件必须满足既有 Core schema，且包含管理员独立确定的初始文件与 Oracle；接口见 [Core 演化说明](SKILL_EVOLUTION.md)。Web 配对入口最多接受五个用例的完整套件，最多十次模型请求；超限整套拒绝，不截取子集。Oracle 不发送给模型。治理一旦启用不可用修改套件来筛掉失败结果。未初始化时，页面只展示注册表并明确提示缺少治理。

要让后续任务选择明确激活的后代版本，可在对应 Runtime 项目的后台 JSON 中设置 `"allow_evolved_skills": true`。默认 `false`，继续只允许配置中的精确 `skill_refs`。开启后只额外准入配置锚点同 family、工具未扩张、通过既有晋升门控且被单独激活为首选的精确 TRUSTED 后代；不会选择“最新版本”或所有 TRUSTED 版本。

Web 服务显式初始化独立的迁移 `web_api/migrations/013_web_skill_evolution.sql`。它不修改 Core migrations 001–010，也不改变历史 Web migrations 011–012。

## 使用流程

1. 选择精确版本，查看 Card 摘要、instructions、历史 Run 与归因限制。
2. 选择历史证据，填写改进目标。`EVIDENCE_DRIVEN` 必须选实际历史 Run；`USER_REQUESTED` 可提出尚无缺陷证据的新要求。
3. 建立 Evolution Case，再单独调用修订模型。请求固定源版本、Card、完整历史 Assessment、所选上下文和 Provider revision。
4. 审阅建议与逐行差异。可以编辑、保存新身份稿件或拒绝。编辑后旧稿和旧摘要仍保留。
5. 准备 Core CALLER 修订提案，核对完整稿件，输入精确摘要批准创建 CANDIDATE。
6. 单独确认 Card 摘要进入 SHADOW，再运行后台封闭套件配对评估。
7. 只有 Gate eligible 时才能准备晋升提案；确认精确晋升摘要后 Core 原子提交 TRUSTED 及其回执。
8. 单独准备和批准首选激活。版本状态、路由选择与任务成功是三类不同事实。
9. 用此精确版本创建新任务；任务 Plan 仍必须再次明确批准，由原 Runner 执行并独立验收。

“选择原 TRUSTED 版本”是新的明确路由选择，保留所有旧版本、激活事件和 Runs。

从一个已独立验收成功的 Run 也可请求 Trace-to-Skill。该流程创建新 family 的 v1 CANDIDATE，并在外部不可变事实中绑定源 Run、验收事件、生成和批准；可进入 SHADOW。当前不为它伪造 Core 演化候选回执，因此不支持该新 family 的治理晋升或自动任务准入。

## 修订协议与限制

模型返回唯一严格 JSON 对象，顶层必须恰为 `schema_version`、`source_skill_ref`、`source_card_sha256`、`draft`。`schema_version` 必须为整数 1。`draft` 必须恰含：

```text
name, description, instructions, allowed_tools, change_summary,
reason_codes, supporting_evidence_ids, declared_risks, expected_behavior_change
```

拒绝重复键、未知键、围栏、额外文字、非有限数、非法 Unicode、身份替换、无依据证据 ID 和工具扩权。不自动修复模型响应。工具限于源 Card 的 `read_file`、`write_file`、`patch_file` 子集；不开放 shell 或 `run_tests`。

默认预算：请求 128 KiB、assistant content 64 KiB、稿件 48 KiB、instructions 32 KiB、其他文本 8 KiB、名称 256 UTF-8 bytes、列表 64 个不同成员、JSON 深度 32。Web 事实单条 192 KiB、总量 8192，单 Case 报告 256 条事实/768 KiB；演化 Worker 单并发、队列 8。所有限制超出即拒绝，不截断或执行部分建议。

模型复用已有 ProviderStore 和受限 transport；收到的是完整无密钥修订 JSON，不获得数据库、文件工具或 shell 对象。实际 wire 参数为配置的 `model`、`stream=false`、`n=1`；其他 Provider 默认参数没有被本地显式固定。模型别名也不等于远端权重的密码学身份。

## 事实、失败与只读审查

`web_evolution_facts` 以 append-only 事实记录 Case、Generation Intent/Claim/Result、稿件、Core 桥接、操作批准/结果、进程观察和 Trace 来源。UPDATE、DELETE、REPLACE 被拒绝，调用身份唯一。

Generation Intent 和 Claim 在网络调用前分别 COMMIT；外部模型 I/O 不持有 SQLite write transaction。记录的请求 SHA 是实际送入 Adapter 的 canonical UTF-8 字节；响应 SHA 是实际 assistant content 字节，不冒称 HTTP envelope 或 Provider 身份证明。

Web 与 Core 跨库操作不是原子事务：先记录 Intent，再调用原 Core，最后记录回执。缺少回执表示未确认；已有 Claim、批准或操作身份不会自动重放。必须人工核对既有 Core 事实，不可把网络错误当成回滚证明。

读取会重验事实摘要、请求/响应/完整稿件及批准关联；不迁移 Core、不联系模型、不修复事实。独立 Inspector、UNKNOWN、Checkpoint、Recovery 和任务事实语义均保持原样。

## 当前边界

- 建议、候选、Shadow 模拟通过、TRUSTED、首选路由及实际任务验收各自独立；不证明模型内心理解、语义遵循、泛化改进或 Skill 因果。
- Gate v1 要求完整 trial census 和可比较工具集。工具缩减可生成候选，但当前晋升会判为 INCOMPARABLE；旧 SHADOW reference trial 限制连续多代晋升，不能丢弃旧试验绕开。
- 回归候选保持 SHADOW，旧可信版本保留。没有新增 DEGRADED、QUARANTINED 或全局停用状态，不提供假隔离徽标。
- Shadow 是内存文件模拟，不能代替真实 Runner 的文件效应与独立 Acceptance。
- 当前证据可支持受控功能验证，正式论文比较实验尚未开展。真实联机结果与离线模型替身结果分别记录于 [测试结果](TEST_RESULTS.md)。
