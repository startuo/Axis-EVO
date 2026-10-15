# Web Workbench

Phase 4 / Step 3 保留三个独立模式：离线 Demo、Core 只读审查、显式开启的本地 Runtime。Runtime 使用持久化 job/dispatch、独立规划与执行 Worker，以及现有 Skill planner、不可变 Plan Proposal、精确摘要审批、Runner 与独立 Acceptance。进程监督协议见 [RUNTIME_PROCESS_PROTOCOL.md](RUNTIME_PROCESS_PROTOCOL.md)。

## 启动 Demo / 只读模式

从仓库根目录运行，要求 Python 3.11+、Node.js 22.12+：

```powershell
python -m pip install -e .
Set-Location web
npm ci
npm run build
Set-Location ..
python -m web_api.app --port 8765 --web-root web/dist
```

打开 `http://127.0.0.1:8765`。默认 Demo 不需要 API Key，不调用模型。`--config .local/workbench.json` 可启用已有事实的只读投影。配置只接受绝对路径，数据库和 workspace 授权容器须已存在：

```json
{"projects":[{"id":"configuration","name":"Local configuration","database":"C:/absolute/core.sqlite3","workspace_roots":["C:/absolute/data"]}],"allowed_origins":[]}
```

原 GET-only 服务继续只读。它以 `mode=ro` 取得有界提交快照，再以 `query_only=ON` 调用 Core；不迁移、不执行、不联系模型。SQLite 内部 WAL/SHM 协调遵守逻辑只读定义，不使用 `immutable=1`。文件页只有已存路径/hash/大小，原始工具输出不会下发。

## 开启受控 Runtime

可先显式创建一个全新的配置示例；命令拒绝覆盖已有目录：

```powershell
python -m examples.workbench_runtime --admit-example-skill
```

该标志明确通过现有 **legacy caller-controlled** 生命周期准入示例 Skill，不是 Trust Assessment、governed promotion 或安全证明。生产项目应由项目所有者预先准备准确的 TRUSTED SkillRef 和初始化到 migration 004 的 WAL 数据库；Web 不自动创建或晋升 Skill。

在启动服务的终端环境配置所选 Provider 的凭据变量。不要把密钥写入配置 JSON、浏览器、命令历史、仓库或审查材料。示例使用 `AXIS_EVO_API_KEY` / `AXIS_EVO_DEEPSEEK_API_KEY`；此文档不提供包含真实密钥的命令。

```powershell
python -m web_api.app --config .local/workbench-runtime/workbench.json --runtime-config .local/workbench-runtime/runtime.json --port 8765 --web-root web/dist
```

打开工作台的“真实运行”，在权限页输入终端显示的一次性本地会话代码。代码有效期 10 分钟；会话有效期 1 小时。刷新可凭 HttpOnly cookie 恢复页面内存中的 CSRF token；重启服务后需要新的代码。应用不使用 localStorage/sessionStorage 保存授权值。

在 Provider 配置页创建模型配置，选择后台允许的 Endpoint 与凭据引用，填写明确 model ID。保存、编辑、设为默认和测试连接都会调用真实后端；编辑创建新 revision。连接测试发送一次固定无任务数据请求，成功只表示该版本完成一次响应。未支持的 Reasoning/Retry 不生效；没有自动重试。

在 Runtime 首页选择项目、Provider revision 与准确 SkillRef，输入“将 config.txt 的 timeout=10 修改为 timeout=20”。“生成计划”只请求规划。审查全部步骤、原样 arguments 和 Plan SHA-256 后，勾选明确批准并执行。Core 重新核验持久化 proposal/Skill/TaskSpec，只有独立 Acceptance 通过才可能 RUN_COMPLETED。

服务只监听 `127.0.0.1`，mutation 需要精确 Host/Origin、origin-bound session、HttpOnly SameSite=Strict cookie 和自定义 CSRF header。任务在独立进程执行；这不提供 TLS、独立 OS 账户、文件系统或网络权限沙箱。不要将此服务反向代理到公网。

## 后台 Runtime 配置

```json
{
  "data_dir": "C:/absolute/data",
  "projects": [{"id":"configuration","task_spec_path":"C:/absolute/assets/task.json","skill_refs":[{"skill_id":"configuration.patch","skill_version":1}]}],
  "credentials": {"primary":"AXIS_EVO_API_KEY","deepseek":"AXIS_EVO_DEEPSEEK_API_KEY"}
}
```

`projects.id` 引用只读配置中的项目。`data_dir` 必须处于该项目的一个 `workspace_roots` 授权容器内；它是管理容器，不是实际 Sandbox root。Web metadata 位于 `data_dir/runtime.sqlite3`，各任务实际 Sandbox 位于 `data_dir/threads/<server-generated-id>/workspace`，Core 禁止向上访问 metadata。浏览器不提交任何这些主机路径。

TaskSpec 模板提供固定 seed 和 Acceptance；用户 prompt 只成为本次 TaskSpec 的 goal/title，不能修改 Acceptance。每次规划先复制有界私有 seed，并记录 TaskSpec/seed 身份；批准和执行前重新检查。原始 seed 不修改，也不会递归上传到 Provider。请求只含 TaskSpec、准确 Skill Card、可信工具 schema 和限制。

默认 Endpoint 是完整 HTTPS 地址 `https://api.openai.com/v1/chat/completions` 与 `https://api.deepseek.com/chat/completions`。可在后台配置 `endpoints` exact allowlist；只接受可信的 HTTPS 443 域名和上述路径形状，不能由浏览器任意添加。自定义域名的运营者是信任边界。DNS 私网检查不是 pinned-IP 连接：冻结 transport 会再次解析 DNS，不能声称消除 rebinding。协议依据 [Chat Completions 文档](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) 与 [DeepSeek 文档](https://api-docs.deepseek.com/api/create-chat-completion/)，具体 model ID 由调用方配置，不保证所有兼容服务或模型均支持本适配器。

## 当前安全门禁与预算

- Runtime 只注册 `read_file` / `write_file` / `patch_file`。`run_tests` 与 pytest Acceptance 仍禁用；Core pytest 边界已增加最小环境和流式输出预算，但不会因此扩大浏览器执行权限。交互取消尚未实现，停止按钮禁用；没有任意 shell、自动重规划或恢复端点。
- seed 仅 UTF-8 普通文件；拒绝 symlink、Windows junction/reparse、硬链、非普通文件、常见凭据路径/扩展名、已知批准凭据值和明确 private-key 标记。检测不是综合 DLP，项目所有者仍须提供无秘密的任务数据。
- 单文件 64 KiB、seed 合计 1 MiB、128 文件/128目录、8 层。所有复核/复制读取先限字节。最多 10 PlanSteps；Core request 128 KiB、provider response 64 KiB、canonical Plan 32 KiB、单文本参数 16 KiB。Web mutation 64 KiB、响应 1 MiB、prompt 8192 字符。
- 同时 1 个 Worker、最多 8 个待处理任务、历史最多 200 threads。规划进程期限为 profile timeout + 10 秒，执行期限为 90 秒；Worker stdout/stderr 各 4 KiB 后终止，原始进程输出不下发。Windows Job Object 在恢复进程执行前绑定，限制 512 MiB、8 个进程并在关闭时终止树。256 条事件是轮询观察阈值，不能保证恰好 256 条的硬上限。Provider socket timeout 1–300 秒，单独连接测试不保证硬总 DNS deadline。网络期间没有 SQLite write transaction；无隐式重试。
- approval 绑定精确 lowercase Plan hash；Web compare-and-set reservation 和 Core 一 proposal/一 Run 约束防止重复消费。历史线程固定 profile revision/config hash/SkillRef/TaskSpec。默认模型切换不改写历史。
- Web job 不是 Core event。派发保留与一次性 Worker claim 均在执行前 COMMIT；重启不补派已保留身份。Worker 退出和丢失监督分别记录，Core 原子终态事实决定已完成结果；未决执行显示 UNKNOWN。既有 Run/TOOL_INTENT/缺失 TOOL_RESULT 保持原样。文件变化不证明工具因果，UNKNOWN 不表示可安全重试。
- 只读桥预算继续生效：64 MiB 数据库/逻辑快照、64应用表、20,000行、每 Run 5,000事件、详情最多500条。非 Runtime 私有 workspace 的现场检查仍可能 UNSUPPORTED；不补造证据。

## 验证与审查

公共仓库按 AGENTS.md 发布实现、说明和 `docs/TEST_RESULTS.md`，不发布私有测试、fixture、报告和 ZIP。完整本地审查包提供这些材料；历史 baseline 测试需要完整 Git clone 历史，将审查包覆盖到该 checkout 后运行：

```powershell
python -m pip install -e ".[test]"
python -m pytest -q
python -m pytest -q web_api/tests
Set-Location web
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

单独的 Runtime browser integration 使用私有 `review_evidence/runtime/browser_server.py` 与 `web/runtime.playwright.config.ts`；该 harness 仅拦截 Provider transport，不模拟 Runner、SQLite、文件副作用或 Acceptance。它不随公共仓库发布，也不是可选择的生产 Provider。默认测试没有真实外网模型调用。运行结果见 [TEST_RESULTS.md](TEST_RESULTS.md)，布局约定见 [WORKBENCH_UI_SPEC.md](WORKBENCH_UI_SPEC.md)。目前没有 Windows EXE 或桌面安装包。

Step 3 的六尺寸进程监督 QA 使用本地审查包中的 `web/step3.playwright.config.ts`。Windows 实际 junction、孙进程清理与硬退出已有独立证据；本轮没有可用 Linux 环境。POSIX 文件复制失败时，存在部分文件的目录保守保留，以避免不具备原子身份条件的删除；POSIX 静默脱离后代清理不等同于 Windows Job Object。不要把 Windows 结果外推为 Linux 认证。

真实 Provider 验证目前为 `LIVE_PROVIDER_VERIFICATION_PENDING`。可使用 `examples/live_runtime_verification.py` 分别运行 connection、plan、execute、inspect；connection/plan 必须显式提供 `--live-provider`，execute 必须另行提供审阅后的精确摘要。该 CLI 的 plan/execute/inspect 会取得同一协调器锁；先停止该数据目录的 Web Runtime，完成验证后再启动。完整命令和 Provider 参数边界见进程协议文档。
