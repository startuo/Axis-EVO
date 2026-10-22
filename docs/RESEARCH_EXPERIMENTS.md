# 隔离研究协议

研究 API 在一次性数据库和工作目录中复现已批准的条件，普通产品库仅被读取和备份。当前只支持工程 dry-run 与显式 LIVE_PILOT；正式 FINAL_HOLDOUT 执行在本阶段拒绝。

## 数据与批准

`load_research_dataset(root, manifest_path)` 读取版本化 manifest。每个 case 固定 `task_family`、`case_role`、TaskSpec/seed/Oracle 摘要、工具策略、模型 profile 和执行预算。路径是相对数据根的 canonical 路径；现有 Sandbox 检查链接与越界。角色为 DEVELOPMENT、GATE、FINAL_HOLDOUT；同一 family 和相同 seed+Oracle 指纹不能跨角色。

`RESEARCH_DATA` 的 FINAL_HOLDOUT 内容不会在开发加载时打开。`ENGINEERING_FIXTURE` 可核对所有合成输入，但不是正式盲测。相同 OS 账户仍能读取本地文件，不能声称密码学强制盲性。私有 Oracle 和协议中的完整 Suite 仅留本地。

```python
from axis_evo.research_dataset import load_research_dataset
from axis_evo.research_runner import (
    build_research_protocol, create_research_experiment,
    execute_research_experiment, inspect_research_experiment,
    seal_research_experiment, export_research_results,
)
```

API 顺序：

1. `build_research_protocol(connection, dataset, baseline_ref, candidate_ref, model_profile, *, source_commit, case_role="DEVELOPMENT", run_kind="ENGINEERING_DRY_RUN", gate_assessment_id=None)` 生成不可变事实，固定全部 case、顺序和 attempt IDs。
2. 调用方审查完整私有协议并批准其 `fact_sha256`。
3. `create_research_experiment(source_connection, new_output_directory, dataset, protocol, approved_protocol_sha256)` 建立隔离副本、显式应用 015；输出目录须全新。
4. `execute_research_experiment(directory, dataset, adapter, approved_protocol_sha256)` 再核对所有输入、实际 adapter 和完整 Core Trial census。仅未提交 slots 可继续；已提交无 Result 保留 UNKNOWN，已有 Result 可重新观察，均不再次调用模型。
5. `seal_research_experiment(directory, approved_protocol_sha256)` 明确封存包含缺失结果的 census。封存后不接受新调用或晚到结果改变原结论。
6. `inspect_research_experiment(directory)` 只读；`export_research_results(directory, new_export_directory)` 导出 whitelist JSON、CSV、Markdown，不覆盖原输出。

摘要是显式调用方批准标识，不认证人的身份。`source_commit` 是调用方标签，独立记录的 Python/SQL 源码清单与 SHA 才证明本地字节；导出明确区分两者，不把标签伪装成 Git 认证。

## A/B/C 与缺失事实

A 固定原 TRUSTED v1；B 在封闭模拟使用同一精确候选，不能绕过生产信任；C 使用原 Gate/独立批准与激活后选定的版本，不合格则保持已激活 reference。同一版本在多个条件中共享同一 Trial，而不是重复抽样。Comparison、完整祖先链、独立激活和候选池在协议批准前固定。

015 仅在一次性副本增加 append-only `research_experiments`、`research_submissions`、`research_observations`、`research_seals`。submission 在模型调用前 COMMIT。导出保留所有声明的 case、失败、UNKNOWN 和未提交；不把没有调用记录的 slot 算成功。配对差异给出完成配对数、缺失数与最坏情况边界；Wilson 区间仅作工程描述，不证明小样本总体收益。

模型调用统计单位是本地 adapter attempt。缺失 Result 时给出上下界；不能据此断言远端已处理或已计费。冻结 transport 不提供可靠 usage，故 `TOKEN_USAGE_UNAVAILABLE`、费用为 null。单独连接诊断的 usage 不填入演化实验。

预算：32 cases、256 KiB dataset manifest、2 MiB 完整协议、64 次最大声明调用、每 case/version 一次、64 KiB 响应、10 Plan steps；源库备份 64 MiB、单表 8192 行/最多64表，研究库 256 MiB。超限拒绝，不截取有利子集。框架不提供任意 shell 或正式研究网页执行按钮。

产品 Web 只读取管理员放在固定 `data_dir/research/<project_id>/experiment_<uuid>` 根下的最多八个快照；浏览器不能指定任意路径。读取不迁移、不联机、不改生命周期。

正式研究前必须另行冻结 task families、候选选择、模型实际参数、Gate、排除/缺失规则、分析协议、数据与 Oracle SHA、批准源码版本。当前工程夹具、离线正负控制及连接测试均不能替代正式论文结果。
