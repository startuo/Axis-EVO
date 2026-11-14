# Agent 原生工具传输

M4 在产品 Web 层增加 `web_api.agent_provider.AgentProvider`，使用现有 ProviderStore 固定的配置版本。旧 `PlanningAdapter.plan()` 继续只接受文本计划，拒绝原生 `tool_calls`；学术 Core 和历史计划协议不受此适配器影响。

```python
provider = AgentProvider(providers, profile_snapshot, model_step_id)
message = provider.complete(messages, tools)
```

返回标准 assistant message，包括文本或最多 8 个 function call。函数名必须来自本轮工具目录；参数须是严格 JSON object；重复 call ID、不完整响应、截断及非成功 HTTP 均拒绝。调用方负责依据程序权限执行、保存意图及结果，并对跨轮 call ID 去重。模型返回工具调用不表示工具已经执行。

请求最多 256 KiB、响应最多 64 KiB、单个参数 object 最多 32 KiB；history 最多 128 条，工具目录最多 64 项。执行器应在较早层设定任务轮数、时间及文件预算。传输不自动重试；调用失败不得触发未知副作用的重放。每个模型步骤使用新 attempt ID，并由调用方记录 Provider revision、工具目录及结果摘要。

## 网络与凭据

每次 complete 重新调用 `ProviderStore.adapter()` 验证配置版本与当前权限。沿用已授权 HTTPS、明确配置的 CONNECT route 或 literal loopback Gateway；不增加 endpoint、不读取代理环境变量、不跟随 redirect。请求和完整响应都经过既有敏感内容检查；凭据只在请求时从已配置环境引用读取，不写入消息或磁盘。

HTTPS 沿用既有 socket operation timeout，DNS 检查和操作系统调度不构成总墙钟期限保证；上层需负责任务取消和 Worker 生命周期。此边界并非 OS 级沙箱。Local Gateway 沿用现有总 deadline 与严格 framing 检查。

## DeepSeek、MCP 与 Harness 的选择

- [DeepSeek Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/) 使用标准 `tools`、assistant `tool_calls` 和带 `tool_call_id` 的 tool result。M4 对官方 DeepSeek endpoint 显式关闭 thinking；不为 strict 模式切换 `/beta` endpoint，工具参数仍由后端校验。
- [DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/) 要求携带 tools 时回传历史 `reasoning_content`。适配器允许此字段作为不可信协议数据继续传递；它不是执行事实、独立评价或验收依据，也不应默认展示为工程证据。
- [MCP 2026-07-28 Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) 规定工具发现和调用协议，工具注解来自不可信来源时不能作为权限依据。原生 function tool 适配器不是 MCP client；接入 MCP 应额外建立服务授权、schema 到本地工具身份的绑定、撤销及结果不确定性处理，不能让远端目录自行新增权限。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md) 基于 Cordis 插件体系。工程选择是保留 Axis 自有执行事实、授权与 Skill 生命周期；将 Harness 视为可选上游 Gateway，而非嵌入它来替换 Runtime。这避免重复维护两套执行与插件权限语义。此项是架构判断，未宣称本机 Harness 联机已通过。

资料核对：2026-11-07。适配器的离线 HTTP 测试能验证协议与程序边界，不能替代实际 DeepSeek、第三方 MCP 服务或 Harness 联机验收；当轮测试结果统一见 [TEST_RESULTS.md](TEST_RESULTS.md)。
