# 安装、启动与数据维护

当前版本为 0.1.0 Preview。本页是本地受控运行约定，不是 GA、桌面安装包或公网服务承诺。产品发布判定和研究冻结分别记录在 [测试结果](TEST_RESULTS.md)；正式 Holdout 尚未冻结运行，论文主实验未开始。

## 环境与安装

Windows Runtime 要求普通 CPython，Node.js 22.12+；实际版本以测试结果为准。Python metadata 的最低版本仍为 3.11。Microsoft Store/WindowsApps Python 的进程链未通过本轮清理验证，正常 Runtime 明确拒绝；只读检查与 Core 包的 Python 版本声明不等于该执行链已认证。若 `py -3.12` 指向 Store，须先选择普通 CPython，不能仅重建同一 Store 虚拟环境。SQLite 的安全读取能力由启动时的内存 feature probe 检查，不按版本号猜测；已知 SQLite 3.40.1 不兼容，不能关闭 `trusted_schema=OFF` 绕过拒绝。

Web 产品从完整仓库 checkout 运行。Python wheel 只提供 `axis_evo` Core 与其 SQL，不能单独代替 `web_api`、React 资产、管理员配置或任务数据。先在新的虚拟环境显式安装依赖，正常启动不会下载依赖：

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .
npm --prefix web ci
npm --prefix web run build
python -m examples.release_smoke
```

`package-lock.json` 固定前端依赖。当前 Core 没有第三方运行依赖；wheel 构建验证使用 setuptools 80.9.0 / wheel 0.45.1，安装时 build isolation 可能显式下载 build-system 依赖。公共 smoke 只在自己的临时目录验证真实 Runner、SQLite 和文件验收，不调用模型，不替代完整私有回归。

## 首次准备与生产启动

示例操作只适用于一个全新目录，明确准入演示 Skill，不是 Trust Assessment：

```powershell
python -m examples.workbench_runtime --admit-example-skill
python -m web_api.runtime_storage init --config .local/workbench-runtime/workbench.json --runtime-config .local/workbench-runtime/runtime.json
python -m web_api.app --config .local/workbench-runtime/workbench.json --runtime-config .local/workbench-runtime/runtime.json --port 8765 --web-root web/dist
```

真实项目先由所有者显式准备 Core WAL 数据库、准确的 TRUSTED SkillRef、TaskSpec/seed 及绝对路径 allowlist。`runtime_storage init` 仅初始化全新的 Web metadata；不迁移配置中的 Core，不执行任务，拒绝已有 runtime.sqlite3 或 threads 目录。各 schema 阶段分别提交，故中断可能留下部分准备状态；正常启动拒绝它，不自动修复。

正常 HTTP/Worker 启动不创建 schema、不运行迁移。HTTP 先检查 SQLite 能力、Core/完整 Web schema、TaskSpec 和 Vite manifest 中的全部 JS/CSS/资产，再占有实际监听 socket，最后建立协调器。占用端口、缺懒加载文件或未准备 store 均明确拒绝。构建须包含 `.vite/manifest.json`；升级代码后重新显式 build，不继续使用缺清单的旧 dist。

启动会产生必要的协调器锁、临时 Worker descriptor 和监督事实。重启可追加 SUPERVISION_LOST 等事实并将未决任务显示 UNKNOWN；这不属于隐式迁移。SQLite 只读检查可能创建/维护内部 WAL/SHM sidecar。应用事实和 schema 的逻辑只读不等于数据库目录物理零变化。

服务只监听 `127.0.0.1`。浏览器直接打开相同 origin 的普通地址；前端通过严格同源 POST 自动初始化一小时的内存会话。刷新、多标签、会话到期和重启均无手工授权步骤。`--open-browser` 可选且不携带 token。Host/Origin、HttpOnly SameSite cookie、自定义 CSRF header 都继续校验。不要反向代理到公网。停止前先等待任务结束；若被中断，重启后先审查 UNKNOWN，不重发旧批准。

Vite HMR 使用 `python -m examples.workbench_dev`，启动器显式传 `--api-only`，因此不依赖 dist；仍不准备 Runtime store。`npm --prefix web run preview` 保留为 Vite 静态预览工具，不能代替产品后端。

## Provider 与可选管理员网络路径

凭据真实值只配置在后端环境，JSON 只存引用名。浏览器不能提交任意 Endpoint、代理或 IP；profile revision、模型、config hash 和任务绑定不可变。编辑 profile 创建新 revision，不修改已规划任务。

默认 HTTPS 直连路径不读取系统代理或代理环境变量。若管理员网络使用 Fake-IP DNS，私网检查会拒绝；系统代理诊断成功不表示直连 adapter 成功。不要降低 DNS/TLS 规则解决这个差异。

管理员可在现有 runtime JSON 增加 `provider_routes`。每项精确绑定一个既有 HTTPS allowlist Endpoint、literal loopback HTTP proxy、经单独诊断确认的 global IPv4 CONNECT 目标及绝对 Unix 到期秒数。示例结构（不是可直接使用的授权）：

```text
provider_routes: [
  {endpoint: <existing exact HTTPS endpoint>,
   proxy: http://127.0.0.1:<administrator port>,
   address: <verified canonical public IPv4>,
   expires_at: <integer Unix timestamp within the next 24 hours>}
]
```

新建/编辑 profile 时固定完整 route；旧直连 revision 不自动获得代理。过期或撤销的 revision 仍可读取、编辑及审批已有本地 Plan，但新的网络调用拒绝。续期须管理员更新配置，再创建新 profile revision；没有自动 DNS 刷新或退回直连。

客户端只向代理发送 CONNECT public-IP:443，Provider Authorization 仅在官方域名校验的 TLS 内发送；SNI/HTTP Host 保持官方域名，拒绝 redirect，不自动重试。代理是否实际遵守 CONNECT 属于管理员信任边界，不能称为独立观测到的公网出口。授权期限不等于 DNS TTL 或地址长期可用证明。实际 campaign transport 也固定并核对完整 route。

固定 wire 为 `model/messages/n=1/stream=false`；Thinking、reasoning_effort、max_tokens 未发送，不能在 UI 宣称已启用。64 KiB response 预算、严格 UTF-8/JSON 与完整 HTTP 定界同时校验；不支持 chunk extensions/trailers、压缩或含歧义长度的响应，可能拒绝部分兼容 Provider。连接测试、有效 Plan、精确审批、真实执行和独立验收是不同事实。

## 备份、升级与恢复

先停止该 data_dir 的协调器及 Worker，保留原环境，不在唯一生产副本上试迁移。一次完整备份至少包含：所有 Core 数据库、runtime.sqlite3、threads 下 seed/task/workspace、TaskSpec 原始 assets、两份配置与其路径关系。凭据走独立安全备份，不能装进普通审查 ZIP。

数据库必须使用 SQLite Backup API；直接复制主文件可能漏掉已提交 WAL：

```powershell
python -m web_api.runtime_storage backup-database --source C:/absolute/core.sqlite3 --output C:/backup/new-core.sqlite3
python -m web_api.runtime_storage backup-database --source C:/absolute/data/runtime.sqlite3 --output C:/backup/new-runtime.sqlite3
python -m web_api.runtime_storage upgrade-copy --config C:/absolute/workbench.json --runtime-config C:/absolute/runtime.json --output C:/backup/new-metadata-copy
```

输出必须全新，不能覆盖原文件，也不能占用源库的 `-wal/-shm/-journal` 命名空间。backup-database 是单库已提交快照，**不复制 workspace、不提供跨库原子快照**。15 秒/数据库大小预算会终止副本操作；失败的新输出可能保留，不能当完整备份使用。

upgrade-copy 锁住已停用的源协调器，在新目录复制 metadata，校验已有 schema 后仅补齐支持的空初始化阶段。拒绝弱/未知 schema、非空但缺 job 的旧历史，不伪造 job、workspace 或 Worker。源逻辑事实不迁移；未知损坏需保留并独立审查。它不迁移 Core、不启动/重放任务，也不表示完整恢复成功。

恢复应先在隔离副本验证 SQLite quick_check/FK、schema、任务文件 hash 和配置。当前运行事实含绝对 workspace_path，支持回到原绝对路径的离线恢复；**不支持透明目录搬迁或改写历史路径**。恢复完整文件集合后再运行正常 startup guard，由页面自动建立连接，检查已完成及 UNKNOWN 历史，没有恢复授权的任务不得执行。数据库、任务文件必须来自同一个停用窗口。

代码回退须保留新旧数据快照，选择与 schema 相符的 checkout/完整 dist；没有自动 downgrade 或数据库逆迁移。不要用强制 Git reset 或旧版本强行打开未知 schema。

## 安全边界与诊断

Web 只注册 read_file/write_file/patch_file，run_tests 与 pytest Acceptance 禁用；Core 程序 API 另有受控 pytest 合同。执行 Worker 不接收 Provider 凭据，但同 OS 用户进程隔离不等于文件系统/网络权限沙箱。任务 seed 由所有者去密，不提供全面 DLP。无自动重规划、UNKNOWN 重放或自动演化批准。

生产 HTTP 要求完整 Web store；既有直接程序 API 可显式初始化 schema，并允许只用011的单轮兼容路径。该模式不是正常 HTTP startup 的隐式迁移。conversation/evolution 分别校验其012/013 schema；Worker 仅使用其必要 schema 且不迁移。

故障诊断保留 source commit/dirty 状态、版本、SQLite feature probe、非秘密 route/profile identity、命令退出码和原始 warning。不要输出 Authorization、环境全量、会话 cookie、Provider 原始错误 body 或私有任务内容。HTTP 200 不等于验收；进程退出不等于已证明无副作用，文件变化不等于工具因果。
