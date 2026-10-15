# Runtime 进程与批准协议

默认 Runtime 使用真正的规划、执行进程。协调器内的一个调度线程只监督 `Popen`，不运行 Task 工具。规划进程得到所选凭据变量；执行进程使用固定最小环境，不得到 Provider Key、Web session 或 CSRF token。二者仍使用当前 OS 用户权限，这不是针对任意恶意代码的 OS 沙箱。

## 已提交事实与状态

Web 数据库 `runtime.sqlite3` 增加 `web_api/migrations/011_runtime_jobs.sql`。它不改变 Core 数据库 migrations 001–010。

| 对象 | 含义 |
|---|---|
| `runtime_jobs` | job/thread、项目、Skill/Card、Provider revision/config、TaskSpec、seed manifest 和预留 Run 身份；身份不可改写 |
| `runtime_dispatches` | 一次精确批准、proposal、Run、dispatch、Worker 关联；一 job / proposal / Run 一次 |
| `runtime_worker_claims` | 每 job/phase 一次的进程接收事实 |
| `runtime_worker_observations` | 启动、退出、终止请求、输出超限、监督丢失的追加事实 |

状态为 `QUEUED → PLANNING → AWAITING_APPROVAL → DISPATCH_RESERVED → EXECUTING → FINISHED / FAILED / OUTCOME_UNKNOWN`，另有规划失败路径。Web 线程的 `UNKNOWN` 对应 job 的 `OUTCOME_UNKNOWN`，不替代 Core Run 或 Inspector 分类。没有虚构的百分比或模型思维记录。

准入在创建私有快照前原子提交 thread/job/固定身份；复制失败属于有界的失败 job。网络规划期间没有 SQLite 写事务。批准时重新核验 proposal、TaskSpec、seed、Skill TRUSTED/Card、固定 Provider revision/config，然后在一个 owned `BEGIN IMMEDIATE` 中更新批准并写 dispatch。只有 COMMIT 成功才能启动执行 Worker。

Worker 再以 owned transaction 消费一次性 claim。Core 创建 Run 并提交不可变 plan_run_link，之后才产生 RUN_STARTED、STEP_PLANNED 和原有工具事件。工具执行在 SQLite transaction 外；`TOOL_INTENT` 先 COMMIT，POST/TOOL_RESULT 按原顺序记录。只有独立 Acceptance 和原子 terminal transition 可以产生完成事实。

重复请求、两浏览器竞争、RAISE(IGNORE)、触发器 abort、延迟 FK COMMIT 失败均不得产生第二次执行。保留身份后未能启动、进程中断或监督丢失时不自动重派。这里不承诺外部副作用 exactly once。

## 进程退出与重启

退出码是进程健康观察。已提交且一致的 Core terminal event/row 可以保持 COMPLETED/FAILED，即使 Worker 随后异常退出；缺失结果仍为 UNKNOWN。规划进程的退出不冒充执行进程退出。

一个 data_dir 同时只能有一个协调器，使用 OS 文件锁。重启读取已提交 Core 事实，将丢失监督单独记录；不凭历史 PID 盲杀进程，不重新消费旧批准。Recovery Child 的结果不改写 Source。此界面没有自动恢复或重试操作。

交互 Stop 暂不可用。监督器仍会在期限、输出超限或服务关闭时终止其持有句柄的进程；终止请求不证明无副作用。Windows 先挂起启动，绑定 Job Object 后恢复；关闭 Job 终止后代。POSIX 使用独立进程组，对正常父进程退出后的静默后代不提供等同 Job Object 的保证；本轮未在 Linux 验证。

## 预算

| 边界 | 限制 |
|---|---|
| 并发 / 队列 / 历史 | 1 Worker / 8 活跃待处理 job / 200 threads |
| 规划 / 执行进程 | profile timeout + 10s / 90s（轮询及 OS 调度有误差） |
| Worker 输出 | stdout/stderr 各 4096 bytes，超出即终止，原始输出丢弃 |
| Windows Job | 512 MiB，总 8 个进程，KILL_ON_JOB_CLOSE |
| Core pytest 输出 | stdout/stderr 各 4096 bytes，流式限制；超限 FAILED / OUTPUT_LIMIT_EXCEEDED |
| 事件 | 256 条轮询监督阈值；不是严格原子事件配额 |
| Web seed | 128 文件/目录、深度 8、64 KiB/文件、1 MiB 总计，仅无链接 UTF-8 普通文件 |
| Core seed | 4096 文件/链接、1024 目录、16 MiB/文件、64 MiB 总计；历史不跟随 symlink 语义保留 |
| Plan | 10 steps、32 KiB canonical Plan、16 KiB 单文本参数 |
| 模型 I/O | 128 KiB semantic request、64 KiB provider body；不截断后执行 |

Core pytest 环境只选择经验证的必要 OS 路径与固定 Python/pytest 开关，不复制 `os.environ`。Windows 的 `SYSTEMDRIVE` 从合法本地 `SYSTEMROOT` 推导，忽略独立注入值；Store Python 可能自行补入绝对路径 `PYTHONUSERBASE`，实测不继承父进程注入值。这些启动路径元数据不提供主机权限隔离。输出限制作用于产生过程，超限不会成为 SUCCESS。保留的极端 4 KiB NUL 双流结果经过 canonical JSON 后为 49,339 bytes，低于既有 64 KiB feedback 边界。Web 仍禁止 `run_tests` / pytest Acceptance。

## Provider 与真实验证

继续使用 `ProviderStore`、`RuntimeConfig`、冻结 `planning_adapter.py`。Endpoint 仅为管理员预置 exact HTTPS allowlist；拒绝 URL 凭据、重定向和已知私网地址。DNS 预检和 transport 二次解析不能提供 pinned-IP / DNS rebinding 保证；自定义 Endpoint 及 DNS 运营者是显式管理员信任边界。

当前实际 wire 只包含 `model`、`stream=false`、`n=1`、`messages`。`thinking`、`reasoning_effort`、`max_tokens` 和 retry 均未设置；UI 清楚标为不支持。Provider 默认思考行为可能仍生效，不声称关闭 thinking 或启用 Max。64 KiB body 限制可能拒绝很长的推理响应。

本轮核对 [DeepSeek 模型文档](https://api-docs.deepseek.com/quick_start/pricing/) 与 [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)：当前列出的 API ID 为 `deepseek-flash` / `deepseek-v4-pro`；历史 Harness 名称不能替代真实 API ID。具体 ID 必须按使用时的官方文档填写。该 Provider 当前默认 thinking 及支持的 reasoning_effort 不意味着本适配器已经发送或验证它们。`n=1` 的实际兼容性也须由真实连接测试确认。

没有配置可用凭据，当前真实烟测为 **LIVE_PROVIDER_VERIFICATION_PENDING**。离线 HTTPS double 证明本地 wire 构造与失败处理，不能证明远端收到请求、支持参数或模型遵循 Skill。

在安全终端配置凭据后，先停止同 data_dir 的 Web 协调器。以下值均应替换为已登记的本地 ID，密钥不出现在命令中：

```powershell
python -m examples.live_runtime_verification --workbench-config .local/workbench-runtime/workbench.json --runtime-config .local/workbench-runtime/runtime.json --phase connection --project configuration --profile-id <profile-id> --profile-revision 1 --live-provider
python -m examples.live_runtime_verification --workbench-config .local/workbench-runtime/workbench.json --runtime-config .local/workbench-runtime/runtime.json --phase plan --project configuration --profile-id <profile-id> --profile-revision 1 --skill-id configuration.patch --skill-version 1 --prompt "将 timeout=10 修改为 timeout=20" --live-provider
```

第二条只规划，查看返回的全部步骤、Skill/Card/TaskSpec/Profile 和 Plan SHA-256。明确审阅后另行执行：

```powershell
python -m examples.live_runtime_verification --workbench-config .local/workbench-runtime/workbench.json --runtime-config .local/workbench-runtime/runtime.json --phase execute --project configuration --thread-id <thread-id> --approved-plan-sha256 <exact-reviewed-sha256>
python -m examples.live_runtime_verification --workbench-config .local/workbench-runtime/workbench.json --runtime-config .local/workbench-runtime/runtime.json --phase inspect --project configuration --thread-id <thread-id>
```

CLI inspect 会取得协调器所有权并协调 Web 健康事实；它不等同于纯只读 Core ReadFacade。失败或 UNKNOWN 不自动重试。不要把完整 thread 输出上传到公共日志，其中仍可能包含任务内容；本工具不输出凭据。
