# 有界交互会话

Phase 4 / Step 4 在原有 Runtime 上组合多个独立任务。模型提供候选计划，Core 校验，调用方逐轮明确批准，原有隔离 Worker / Runner 执行，独立 Acceptance 决定完成。

## 每轮身份

一个 conversation 下最多 16 个顺序 turn。每轮固定 message、thread/job、TaskSpec、上下文摘要、SkillRef/Card、Provider revision/config、proposal、批准摘要、dispatch 和 Run。历史事实不可覆盖。Web `FINISHED` 与 Core `COMPLETED` 分别展示；工具成功不替代验收。

上一轮存在正常、可核验的 Core 终态时，下一轮可从上一轮**服务端绑定的工作区**捕获新 seed。捕获字节必须匹配继承 seed 与最新 POST/VALIDATION 文件事实；同一份已捕获字节用于模型上下文和新执行 seed。原工作区不改写。外部变化、路径重定向、缺失事实均拒绝续轮。该过程不证明原子文件系统快照或工具因果。

规划失败且没有批准、dispatch、Core Run 时，可由调用方新发一轮，以该轮固定的私有 seed 为起点。活动轮次、已保留但未完成的执行、UNKNOWN 均阻断默认续轮。没有自动重放、重规划、补偿或恢复。

## 上下文与边界

上下文是 canonical JSON，逐字位于 Core planning request 的 `task_spec.goal`，保存相同字节与 SHA-256。它是任务数据，不能授予工具权限、批准或完成权限。保留最近最多 4 轮用户输入、精确身份和核验后的简要终态证据；不将 raw Tool stdout 或模型推理作为授权。省略的历史 turn/file 标识明确列出，按完整消息/文件裁剪。

- 用户输入：8192 Unicode codepoints；拒绝未配对 surrogate。前端从 capabilities 取得相同上限，超限保留草稿并禁用提交。
- context：48 KiB；最多 10 个简要证据项。
- 文件上下文：最多 8 个 UTF-8 文件、单文件 8 KiB、合计 16 KiB。执行 seed 继续遵守原有 1 MiB / 128 文件等预算。
- planning request / response / canonical Plan 继续使用 Core 的 128 / 64 / 32 KiB 上限；最多 10 PlanSteps。
- 每轮 Web 观察最多 64 条、每条 4 KiB。辅助观察写入失败只产生不含原始错误正文的诊断，不能改写 Core 或阻断已提交 dispatch。续轮资格从只读核验的 Core 事实推导。

Acceptance 仍由后端配置的 TaskSpec 模板固定。可在 runtime configuration 的 project 中添加 `task_templates`（至多 8 项 `id: absolute task path`），浏览器只选择已配置 ID；不能提供主机路径或自定义验收。默认模板 ID 为 `default`。这不是任意环境的自主编码 Agent。

## API

`ConversationService(runtime)` 显式初始化 Web migration 012；Core schema 与 migration 001–010、Web migration 011 不变。

所有端点保留 Host / same-origin / 本地短期 session / CSRF / 64 KiB 请求预算。GET 也要求 session，mutation 另要求精确 Origin 和 CSRF。

| 方法 | `/api/runtime` 后的路径 | 返回 |
|---|---|---|
| GET | `/projects/{project}/conversations` | 有界目录摘要，不加载所有计划/事件 |
| POST | `/projects/{project}/conversations` | 新会话及首轮 |
| GET | `/projects/{project}/conversations/{conversation}` | 最多 16 轮身份/状态摘要 |
| POST | `/projects/{project}/conversations/{conversation}/turns` | 新的独立轮次 |
| GET | `/projects/{project}/conversations/{conversation}/turns/{turn}` | 选中轮的 thread、类型化事实来源与观察 |
| GET | `/projects/{project}/conversations/{conversation}/turns/{turn}/context` | canonical context、manifest、摘要 |
| POST | `/projects/{project}/conversations/{conversation}/turns/{turn}/approve` | 精确批准后的选中轮 |

新轮 body 仅含 `prompt`, `messageId` (`msg_` 加 32 位 lowercase hex), `profileId`, `profileRevision`, `skillRef`，可选 `taskTemplateId`。重复 message ID 拒绝；并发续轮仅有一个可提交。conversation、turn、message、context 和原 thread/job 在同一 owned SQLite transaction 提交。

批准 body 仍仅含 `proposalId`, `approvedPlanSha256`。批准不可跨轮复用；模型不能编写批准值。后端重新核验 proposal、TaskSpec、Skill、Provider 和上下文身份，然后复用既有一次性 dispatch / Core proposal-to-run 链。

migration 012 包含 conversation、turn、message、context、append-only observation 五个表。初始化器核验持久 schema、拒绝 TEMP shadowing / caller transaction，创建并核验不可 UPDATE/DELETE/REPLACE 的触发器。历史读取验证保存的快照，不重新解释当前模板。

## Provider 与验证

复用 ProviderStore 与现有 HTTPS transport。仅后端获得环境变量凭据，执行 Worker 不接收 Provider/session 凭据；不保存授权 header、密钥或完整环境。真实验证使用账号实际返回的 `deepseek-flash`，wire 为 Chat Completions `model`, `messages`, `stream=false`, `n=1`；未启用或宣称 reasoning 参数。

本机 VPN fake-IP DNS 返回保留网段。真实实验使用了仅限 `api.deepseek.com` 的临时管理员路由：无凭据 HTTPS 公共 DNS 查询，验证 global IP/TTL，进程内固定目的地址，同时保留原 hostname TLS 校验。未放宽生产地址校验。默认 transport 的重新解析边界仍存在；这次结果不能外推为所有网络/端点的认证。

实际请求、两次逐计划人工批准、独立执行和验收已完成。结果证明本地记录的请求/响应与执行链关联；不证明模型内部理解、Skill 因果或无模型错误。没有 OS 级通用代码沙箱、任意 shell、自动重试或 EXE。

本地审查包含完整测试和无凭据证据。公共库仅发布实现、说明及测试结果；见 [TEST_RESULTS.md](TEST_RESULTS.md)。
