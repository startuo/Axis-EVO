# 多代 Skill 评估

Gate v1 继续作为默认策略。它按精确 Skill 版本核对历史 Trial 全集；曾作为候选的版本再作为 reference 时，旧 Trial 会进入 census，不能通过删行或只选本轮成功结果消除差异。

`evolution-gate-v2` 使用前瞻 campaign：在模型调用前固定直接父版本、候选版本、Card、Suite、Provider revision、实际支持的参数与全部 case/role/attempt。旧 Trial 作为带摘要的历史上下文保留。本轮每个 case 对 reference/candidate 各声明一次新 Trial；候选一生只有一个 campaign，不提供重新抽样入口。

## 显式启用

先按既有顺序初始化 Core、Skill、Trust、Evolution schema，并启用原有 `EVIDENCE_GATED` governance。管理员再调用：

```python
from axis_evo.evaluation_campaign_storage import initialize_evaluation_campaign_schema
from axis_evo.evaluation_campaign import enable_campaign_policy

initialize_evaluation_campaign_schema(connection)  # additive migration 014
scope = enable_campaign_policy(connection)          # 显式、不可变 opt-in
```

这不是读取时迁移；已有 v1 记录不被重写。已有候选 Trial、未决父版本 Trial、错误 lineage、非 SHADOW 候选、不可用父版本或少于五个 Suite cases 均拒绝创建 campaign。Web 启用还受既有五例上限约束。

## API

| 入口 | 作用 |
|---|---|
| `create_evaluation_campaign(connection, candidate_skill_ref, model_profile)` | 在自有事务内提交全部前瞻身份与 Trial IDs |
| `bind_campaign_adapter(adapter, profile)` | 核对实际 delegate 配置，返回不可变绑定 |
| `execute_evaluation_campaign(connection, campaign_id, bound_adapter)` | 提交调度 claim、全部 Intents；每次调用前提交唯一 claim，再执行原 Shadow 模拟 |
| `seal_evaluation_campaign(connection, campaign_id)` | 明确封存完整 census，包括缺失结果；不会重试 |
| `inspect_evaluation_campaign(connection, campaign_id)` | 只读、核对 schema/身份/摘要/完整 census |

`model_profile` 精确字段：`adapter_name`、`model_id`、`profile_id`、`profile_revision`、`config_sha256`、`effective_parameters`、`transport`。当前有效参数仅为 `{"model": model_id, "stream": false, "n": 1}`；不得声明未发送的 reasoning 参数。transport 固定实际类型、endpoint 和 timeout，或明确标为 injected-test。ProviderStore 仍拥有凭据与端点授权；此绑定不是新的网络代理，也不证明远端身份。

014 新增四张 append-only 表：`evaluation_policy_scopes`、`evaluation_campaigns`、`evaluation_dispatches`、`evaluation_campaign_receipts`。UPDATE、DELETE、REPLACE 均拒绝。模型 I/O 不持有 SQLite 写事务；EVALUATE/TRIAL/首次 FINALIZE claim 的顺序由 SQL 与 Core 共同核对。首次 FINALIZE 固定包含 null 的 census，后补结果不能把旧 UNKNOWN 封存改成合格。

## 晋升与激活

执行结束产生原 Comparison/Assessment。沿用 `propose_skill_promotion(..., gate_policy_id="evolution-gate-v2")`、精确摘要批准和 `promote_evaluated_skill(...)`。原事务原子提交状态与 receipt；不满足完整证据、失败、UNKNOWN、额外 attempt 或陈旧 Assessment 均不允许晋升。

晋升不等于激活。继续使用原 `propose_skill_activation` → 精确批准 → `activate_approved_skill`；选择旧 TRUSTED 祖先只是新的路由事件，不撤销或覆盖原版本。新任务仍须独立 Plan approval，由原 Runner 与独立 Acceptance 决定结果。

目前限制：至少五例、每 role/case 一次、直接 lineage 最多八层、历史上下文最多 256 Trial。Shadow 为有界文件模拟，不执行生产任务；合格不证明 Skill 因果效果或 holdout 泛化。已提交但无 Result 的调用保留 UNKNOWN，不自动重放。迁移 001–013、事件载荷、Runner、Inspector、Checkpoint/Recovery 的原语义不变。

Web 展示 ancestry、历史与本轮 Trial、策略与回执、精确批准和独立激活；只读证据无法补造缺失的 Core/Web 桥接。研究入口另见 [隔离研究协议](RESEARCH_EXPERIMENTS.md)。
