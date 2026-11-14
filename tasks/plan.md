# M4 · Agent-Native Workspace

产品基线 c98cab27471d59803cfedc4cc9ec7a394acdf038；学术基线 12c789b187a6bf8332b8d5222d00cc0702d4bdc8。版本保持 0.1.0 Preview。

目标：选择本地工作区后自然描述目标，Agent 在持久授权内发现知识、选择 Skill、调用工具、验证交付并处理反馈。历史研究结果独立保留。

## 已核对的架构

- 旧 conversation_replies 是无工具对话；旧 Runtime 是固定 Plan/Approval/Runner，旧 adapter 拒绝原生 tool_calls。
- ProviderStore 已有配置修订、凭据引用、网络边界；Sandbox 有 Windows 路径身份与安全打开；Core 有 Tool Intent/Result、观察、Inspector。
- SkillManager、修订、Gate 和反馈存在，但用户需要在独立工程页面手动操作。
- M3 已有原生 Edge 回执及文档版本，桥接保留 UNKNOWN，不可重放。

## 实施决策

1. 新产品 Agent 层使用独立持久记录与有界原生工具回路。复用现有 Core 类与 Provider 网络实现，不修改封存实验规则。
2. 工作区与知识/Skill 来源由本机用户在设置中授权；工具只能引用授权 ID。材料不能创建授权。读取有预算，写入保存原版本并核对实际字节。
3. 工具注册表统一本地文件、Skill、Edge；模型只提交结构化请求，宿主逐项验证。派发前记事实；未知副作用停止，重启不重放。
4. UI 默认 Chat/Work、统一设置；技术证据按需展开。保持同一目标、交付物与反馈上下文。
5. 演化复用 Skill 版本与 Gate，独立任务证据/评价/反馈分栏；自动采用必须满足用户策略，修订者自评不能作为唯一依据。

## 验收

隔离工作区真实文件 → 原生 tool_calls → Skill 使用 → 文档交付 → 后续修订/反馈，核对磁盘、SQLite、浏览器 UI。外部 Provider/原生扩展与离线夹具分开记录。必要边界覆盖路径逃逸、撤销、并发、未知结果、无重复执行。

禁止读取用户原始知识库。测试与夹具只留本地；公开必要源码/说明与 docs/TEST_RESULTS.md；完成后提交推送功能分支并生成完整精简 ZIP。
