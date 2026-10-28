# 任务反馈与受控修订

初始设计决策（2026-10-28）：基线 `3845e4bee018e86622725a43cc9516a7eba98bfd`，产品仍为 `0.1.0 Preview`。

## 已有能力与缺口

1. Runtime 的不可变 job identity 固定项目、TaskSpec、精确 SkillRef、Card 和模型配置摘要。实际 Run 通过 Plan proposal、批准摘要、plan_run_links 和 Skill bindings 关联；reserved_run_id 本身不是执行证明。
2. 对话 UI 已能查看 Core Run、工具事件和独立 `VALIDATION_*`，但没有用户评价的写入、重看或修订来源入口。
3. 规划失败可能只有 Web admission/worker/proposal，无 Core Run。这类记录必须明确“规划尝试、未执行、无独立验收”；不等同于 Skill 失败。
4. Core `agent_feedback` 是从已验证执行事实提取的反馈，`skill_evidence` 是历史证据分类，Assessment 是历史快照，修订模型输出是未验证建议，Research Oracle 是隔离评价依据。以上均不能代替用户评价。
5. Web evolution facts 已有追加、身份唯一、摘要和父子项目校验。其 kind 集合冻结，故新增 Web migration 018 的单表事实层，不修改 013 或 Core。
6. `EVIDENCE_DRIVEN` 继续使用当前完整 Assessment 与真实 Run。用户反馈另存 Web 关联，仅以带来源标签的有界 objective 进入既有修订协议；反馈 ID 不进入 Core supporting_evidence_ids。

## 最小架构

任务 → 可选用户反馈 → 服务端复核身份与执行证据 → 查看修订目标 → 显式批准该提案 → 既有 Evolution Case。模型生成、候选摘要批准、Shadow、Gate、晋升、激活仍是后续单独操作。

反馈固定 schema、项目/线程/对话轮次、精确 SkillRef/Card、实际 Run（可为空）、Core 证据摘要、终止事件及独立验收引用；用户评价、原因、说明、时间另列，初始归因为 `UNDETERMINED`。不存工具正文、Oracle 或凭据。更正追加关联记录，不覆盖旧反馈。

修订提案固定反馈摘要、当前完整历史摘要与目标。批准前再次复核；源版本、证据、Assessment 不可验证或变旧即拒绝。跨库顺序为 Web 授权事实 → 原 Core/Web Case → 关联回执。中断后保留未确认状态，绝不自动重放。

反馈是 Development 输入；不接收浏览器声明的 Run、SkillRef、Acceptance 或研究角色。当前仅接收已验证正常终止的文件 Run，以及无 dispatch/Run 的明确失败规划。UNKNOWN 或不完整执行继续保留原事实，不伪装为正常终止。

## 数据、接口与操作

新增 `web_api/migrations/018_web_task_feedback.sql`，只在既有 `runtime.sqlite3` 中增加 `web_feedback_facts`。四类事实：FEEDBACK、REVISION_PROPOSAL、REVISION_AUTH、REVISION_LINK。每条包括唯一 id、project/thread、kind、parent、slot、canonical body、SHA-256、服务端 UTC 时间。数据库触发器禁止 UPDATE、DELETE、REPLACE，验证 task/parent 同项目同线程；提交身份唯一。同一身份的并发请求只有一个提交，独立身份可以追加。

| 方法与 Runtime 路径（前缀 `/api/runtime/projects/{project}`） | 内容 |
|---|---|
| `GET /threads/{thread}/feedback` | 此任务完整有界反馈历史，复核同一任务的服务端来源 |
| `POST /threads/{thread}/feedback` | 精确字段 submissionId、evaluation、reason、comment、supersedesId |
| `GET /feedback/{id}` | 同项目的单条反馈与已验证来源 |
| `POST /feedback/{id}/revision-proposals` | 空对象；准备并固定反馈、当前完整历史、修订目标，无模型调用 |
| `POST /feedback-revisions/{proposal}/authorize` | approvedProposalSha256、profileId、profileRevision；明确授权建立原 Evolution Case |

evaluation 为 MET_EXPECTATIONS / NEEDS_IMPROVEMENT / UNABLE_TO_ASSESS；reason 可空，仅负面反馈可选 UNDERSTANDING / OUTPUT / PROCESS / OTHER。说明最多 2048 UTF-8 bytes；UI 最多 512 字符。单条 Web 事实 16 KiB、总量 8192、同任务全部反馈/桥接事实合计最多 128。达到容量后整条拒绝，不删除旧事实腾位，也不静默截断列表。

Core 来源只保存摘要与引用：精确 SkillRef/Card、任务/job 身份、proposal、真实 Run/status、终止事件、Core 原始事实闭包摘要和独立验收状态/事件；不复制工具输出正文或私有 Oracle。规划失败的 Run、验收与执行摘要为 null/NOT_AVAILABLE，不能触发 EVIDENCE_DRIVEN。未知执行不增加正常终止反馈。

正常界面只显示小型可选反馈、原因和说明；更正追加新事实，旧事实仍可重看。技术摘要在折叠详情。选择“基于反馈改进 Skill”仅准备目标，审阅后勾选授权并提交才建立既有 Case；调用模型、批准候选、Gate/晋升和激活各自独立。修订 objective 原文在批准前展示，提交绑定精确提案 SHA；正常反馈控件无需用户输入摘要。

## 显式准备与兼容

新目录沿用 `runtime_storage init`。现有库缺 018 时正常启动拒绝；管理员须停止对应服务后使用既有 `runtime_storage upgrade-copy` 产生全新副本，再独立恢复任务文件、审查原路径与配置并验证。该命令不原地迁移、不擅自重写历史 workspace，也不复制凭据。完整命令与限制见 [维护说明](RELEASE_OPERATIONS.md)。本轮仅测试隔离的新库与副本，未升级所有者当前运行库。

现有 schema 与触发器必须逐一匹配，TEMP shadowing、摘要不符、非法来源、过时历史或缺 Assessment 均拒绝。读取不创建迁移、不修复事实、不调用模型。单线程反馈列表只做一次完整源证据复核，避免每次更正重复扫描完整历史。

## 安全与证据边界

所有读写沿用精确 Host/Origin、HttpOnly SameSite cookie、CSRF 及本地项目授权。浏览器不能提供 Run/Skill/Acceptance 断言、文件路径或研究角色。反馈说明使用已有敏感内容检查与 React 文本转义；它不获工具、数据库或晋升权限。没有新凭据通道、网络服务、第三方依赖或 Shell 能力。

本地摘要检查证明字节一致性，不认证拥有完整数据库写权限的 OS 用户。Web 与 Core 仍不是分布式原子事务；源证据在提交前复核、后续读取与修订前再次核验。中断的授权可能留下无回执事实，须人工检查，不能将缺回执当成未执行或自动重试许可。源证据后来不可用时拒绝使用，原反馈保留在数据库，不隐式改写历史。

预实验见 [办公 Skill 预实验协议](OFFICE_SKILL_PILOT.md)，本轮结果与历史基线分别见 [测试记录](TEST_RESULTS.md)。
