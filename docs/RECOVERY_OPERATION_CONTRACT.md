# Recovery Operation Contract v0

这是未来 Adapter 的只读设计说明，不是已实现的外部业务协议或重试权限。
当前执行能力仅覆盖 `controlled-files-v1`，由可信内建实现和 Core 核验决定。

| Field | Meaning |
|---|---|
| operation_id | 独立操作身份，与原 invocation 和恢复 lineage 关联 |
| operation_kind | 可信 Adapter 声明的操作种类，模型文本不能授权 |
| effect_class | 声明并核验的实际效果边界；不能只看 mutating 标记 |
| idempotency_scope | 外部系统承诺的去重范围及有效时间；当前未实现 |
| idempotency_key | 外部系统接收并持久化的操作键；不从缺响应推断效果 |
| expected_postcondition | 可由可信状态读取得到证据的精确后置条件 |
| reconciliation_capability | 核验接口、证据来源、可识别与不可识别的状态 |
| precondition_identity | 执行前状态版本、内容 digest 或外部业务版本 |
| external_evidence_ref | 原始外部证据引用；不把模型陈述当执行事实 |

文件型实现以 Checkpoint 原始 BLOB/PRE/INTENT、当前完整目录 manifest 和 exact bytes 为证据，
仅能认证当前后置状态，不能证明原工具因果。恢复审批采纳该输入，并授权原 Plan 的精确非空 suffix。
单次 SQLite dispatch 预约防止本协议自动重复派发；它不提供文件系统或外部服务的 exactly-once。

未来 `set_price`、`decrement_inventory`、`create_order` 需要独立权限、操作身份、外部状态对账、
幂等契约及网络/OS 隔离设计。本阶段没有 Shopify/ERP Adapter，不创建订单、不扣库存、不发业务请求。
UNKNOWN 不授权重试，缺结果和文件未变也不证明未执行。
