# M6 Harness 工程基线

版本：0.1.0 Preview。结论：保留 Python Runtime，补齐当前缺口；尚不足以宣布通用 Coding Agent 成熟，尚未证明真实 Skill 自演化更经济。冻结 Core 和研究结论不修改。

## 实现依据与架构选择

本轮读取真实实现，以下 SHA 固定研究对象，不表示其未来 HEAD：

| 项目与实现 | 可借鉴的事实 | Axis M6 的取舍 |
| --- | --- | --- |
| [Codex ToolOrchestrator](https://github.com/openai/codex/blob/0184dfa6a48f0110dd9c6835522492908e5abcf3/codex-rs/core/src/tools/orchestrator.rs)、[process manager](https://github.com/openai/codex/blob/0184dfa6a48f0110dd9c6835522492908e5abcf3/codex-rs/core/src/unified_exec/process_manager.rs)、[compaction](https://github.com/openai/codex/blob/0184dfa6a48f0110dd9c6835522492908e5abcf3/codex-rs/core/src/compact.rs) | 执行协调集中处理权限、沙箱尝试和取消，统一执行器另管理进程生命周期；上下文压缩是单独机制 | 继续以宿主统一准入和派发事实为中心，补文件操作意图/原件与多路径 UNKNOWN 围栏；不照搬自动重试。现有临时容器不能替代持久终端会话 |
| [DeepSeek agent loop](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/core/agent-loop/src/agent.ts)、[native executor](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/core/tool-executor-native/src/index.ts)、[tool pairing](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/compaction/compaction/src/tool-pairing.ts) | session log 投影请求、明确阶段与 AbortController；预备步骤固定 toolSet，事件分发与 executor 分离 | Axis 保留当前工具注册/执行/Provider 分离，不先增加插件框架。软预算压缩保留工具配对和原用户要求；具体编排失败不能归因于 Python 语言 |
| [OMC task recovery checkpoint](https://github.com/Yeachan-Heo/oh-my-claudecode/blob/dec7e4188c0e3de6b92fb3d734ee5c95326021ed/src/team/task-recovery-checkpoint.ts) | checkpoint 核对 taskVersion、owner、claimToken、摘要，拒绝陈旧归属 | Axis 缓存绑定模型、材料、授权、Harness 与产物；预算恢复仅恢复记账。没有以“checkpoint”名义重放 UNKNOWN，也未实现多 Agent 接管 |

这些是实现阅读与工程推论，**没有同模型、同权限、同任务的跨 Harness 性能对照**。Codex 参考修复由外部工程 Agent 完成，与 Axis 的 DeepSeek 配置、工具和上下文条件不同，不能当作模型/框架速度胜负。

保留 Python 的理由：M5 已有可复用的 Core 字节核验、SQLite 追加事实、Provider 子进程取消和 Docker 执行器；M6 的阻碍集中在工具范围、上下文保留和验证成本。迁移 TypeScript/Rust 不会自动减少模型反复读取，也不能修复错误证据归因。本轮增加小模块，保留既有状态机与 Gate，不重写学术路径。

## 真实任务揭示的差距

公开 [python-slugify](https://github.com/un33k/python-slugify/tree/35aca63fc2672cba2c739ff6dff685a4f26a4f9a) 固定提交：给 CLI 添加 `--stdin --lines`，保留空行/CRLF/无末尾换行、透传原选项且默认行为不变。输入包含完整包、原测试与构建配置，但省略发布文档和 CI 元数据；所有省略与文件 SHA 在审查包列出。没有推送或修改该上游仓库。

- 原测试 133 passed、3 skipped、139 subtests；新增 8 项验收初始 6 failed、2 passed。依赖由宿主在固定镜像准备，模型无网络安装权限。
- Axis 首次 11 次请求、128,324 Token；换行唯一匹配失败，没有代码产物。修复 CRLF 后显式续跑 6 次、38,671 Token，仍反复读取，没有成功代码修改。任务均由宿主预算拒绝下一次派发后 FAILED，固定测试未变。
- 中间 24 KiB 软上下文目标可能过早丢弃活动源码；最终改为 48 KiB，硬 224 KiB。最终值只经过回归，没有再做完整真实模型代码验收，不能宣称已证明成本下降。
- 缩小为真实 CLI 源码审查后保存了文档，3 次请求、12,786 Token；最终回复仍触发预算预留停止。文档有错误源码行号、参数数据流和换行假设，因此“有产物”也不等于合格完成。
- 独立 Codex 参考修复用于检验任务可达性。其产物、固定测试和差异单独保存，绝不计入 Axis 自主完成率。

尚缺少持久交互终端、完整 Git 写工作流、关联 worktree Git 管理目录授权、Node 等依赖准备、任意二进制项目、跨任务稳定压缩策略、长任务安全接管、多 Agent 工具编排与通用语义评价。当前 Git 工具只是观察。Docker 可信 daemon/镜像/内核边界不变。

## 演化效率：机制证据与模型结果分开

确定性 HTTP 模型决策 + 实际 Core/文件执行验证：两次同条件演化中，完整隔离原版可复用，周期请求由 9 降至 5；产物被改动会失效，恢复为 9。这个 44.4% 降幅是受控用例，**不是生产平均节省**。缓存只复用已完成 REFERENCE，不复用普通原任务，也不增加独立样本数。无检查、未确认执行、材料故障、成本不足在修订前停止；主比较失败后不再执行历史案例。已有 Gate 的“至少一项改善且无回归”不变。

真实反馈来自上面已保存的源码审查报告。对行号、显式参数映射、文本流配置三个事实先固定问题/依据，再由 DeepSeek 生成指令候选。两侧使用同一带行号源码、固定问题、同一 Provider 配置，独立上下文、不提示候选身份；不调用 LLM Judge。这是有监督的静态诊断对照，**没有通过完整 Agent 工具评价管线**，没有隐藏测试或交叉顺序校准。

保留下来的完整诊断轮共 3 次请求、3,867 Token；原版 3/3，候选 3/3。候选回答 1,746 Token，比原版 1,626 多 7.4%。结论：无测得质量增益、无成本收益，不采用候选。首次诊断脚本误将候选指令文件覆盖为回答，故其比较不作为可复核结论；费用照计，独立重新生成的一轮完整保存指令、输出和固定检查，未伪称第一次证据完好。

全轮外部服务累计 26 次、187,535 Token、估算 ¥0.617406（Provider usage，非账单）。保守价格依据为 [DeepSeek 定价](https://api-docs.deepseek.com/quick_start/pricing/) 的 deepseek-flash 峰值输入/输出价格，按 10 CNY/USD、无缓存优惠估算；[接口 max_tokens](https://api-docs.deepseek.com/api/create-chat-completion/) 设为 4096。预算仍是原授权的 40 次/200,000 Token/¥20，未重置。预留不足会在实际用量尚未到上限时拒绝发送，这解释了未耗尽 200,000 Token 却停止任务。

工程判断：M6 更容易审查成本、减少已知无效周期和重复原版执行，但真实经济收益与完整自主进化仍未证明。继续发展现有 Harness 有价值，下一步应以真实完成率和单位合格产物成本为准；不应通过堆插件、改语言、放松 Gate 或扩大预算代替验证。

## Git 与研究身份

学术注释标签 `academic/thesis-freeze-2026-11-02` 精确指向 `12c789b187a6bf8332b8d5222d00cc0702d4bdc8`。公开冻结资料只证明既有 Pilot/评价范围；HUMAN_CALIBRATION=PENDING，正式 Holdout 未冻结、未运行，主研究未开始。标签与只读页面不改变这些结论。

祖先检查确认 academic → M3 `c98cab2` → M4 `30fb4bc` → M4 Fix `59f765c` → M5 `d5ff1ff`；main 安全快进并已推送到 M5 后开始 M6。删除已合并、无在用工作树的本地/远端 `feature/axis-next-m1-m2-edge`、`feature/axis-m4-agent-workspace`、`Axis/m4-fix-codex`。保留 `Axis/m5-autonomous-agent` 与有效历史工作树，因为它承载本地运行和验证材料；主目录未追踪研究资料未删除。M6 树保留本轮本地审查资料，短期功能分支验证后合并 main，不再作为另一条长期产品主线推进。

实际环境：Git 2.53.0、普通 CPython 3.12.10、Node 24.14.0/npm 11.9、Docker Desktop 4.70/Linux engine 29.4.0。未将 Microsoft Store Python 当作支持的受管进程环境。工作树登记均有效，没有进行无必要路径迁移、源码复制到主目录或强制推送。
