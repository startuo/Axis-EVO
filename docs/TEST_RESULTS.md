<!-- LOCAL_SESSION_CURRENT_START -->
# Transparent local sessions — 2026-10-26

**普通本地地址直接进入工作台；版本保持 0.1.0 Preview，判定 PREVIEW_CONTINUES。** 初始 Git `70272d80c01354b5b050200c8ddc275822b5a721`。被测生产集合 SHA-256 `863b23da01d2a4e260aa36c747b2a62a2706e625569427da2c8cc53f479eb495`，197 项，包含实现与必要说明、不含本结果文档。实现及后续身份记录分开提交；不可变身份在发布前逐文件核对。

默认启动地址为 `http://127.0.0.1:8765`；`--open-browser` 可选，传给浏览器的也是这个普通地址。正常 CLI 不再显示会话代码、不签发 launch URL；前端删除 fragment 交换、解锁表单、会话卡和会话连接入口。输入区同时显示模型 ID，页眉不重复整段输入，普通错误不显示会话技术代码。

## 会话与安全决定

同源前端以带 `X-Axis-Bootstrap: 1` 的空 JSON POST 初始化；精确 Host/Origin 和原有请求边界先执行。同一可信 OS 用户、同一 origin 复用锁内的有限内存会话；并发首次标签页不会互相覆盖 Cookie/CSRF。Cookie 为 HttpOnly/SameSite=Strict，一小时到期，服务重启后重建；不创建持久主 token 或明文密钥文件，不以 GET 建立会话。旧 code/launch API 仅为既有本地脚本兼容保留，当前 UI/CLI 不使用。

每次提交操作前先确认连接；被明确拒绝为 SESSION_REQUIRED 的 GET 可初始化后重读一次，POST 不自动重放。会话检查与精确 Plan 批准、dispatch、独立验收分别执行，UNKNOWN 不重新解释。保留 loopback 绑定、精确 Origin/Host、CSRF、无宽松 CORS、工作区/工具白名单及 Provider 密钥隔离。同一 OS 用户的恶意进程不在浏览器隔离模型内。

真实多标签测试发现原 HTTP 服务占满四槽时立即断开后续连接。以先失败的实际 HTTP 用例复现后，增加最多 250ms 的有界接纳等待；仍为四个 handler 和有限 backlog。相同双标签八轮导航复测无请求失败，未放宽执行或网络权限。

## 发布文件明细

- 后端与启动：`web_api/runtime_auth.py`、`web_api/runtime_http.py`、`web_api/app.py`、`examples/workbench_runtime.py`。
- 前端：`web/src/components/runtime/RuntimePermissions.tsx`、`web/src/components/runtime/RuntimeWorkbench.tsx`、`web/src/hooks/useRuntimeWorkbench.ts`、`web/src/lib/runtime.ts`、新增 `web/src/lib/runtimeSession.ts`、删除 `web/src/lib/runtimeLaunch.ts`。
- 文档：`docs/WORKBENCH_SETUP.md`、`docs/CONVERSATION_WORKBENCH.md`、`docs/RELEASE_OPERATIONS.md`、`docs/WORKBENCH_UI_SPEC.md`、`docs/TEST_RESULTS.md`。

## 本轮实际验证

环境：Windows 11 x64、i9-12900H/20 逻辑处理器；普通 CPython 3.13.5 / SQLite 3.49.1、Node 24.14.0 / npm 11.9.0、Edge 156.0.4314.42。原始失败、退出码、截图、私有测试与 fixture 留在本地；未加入公共 Git。

| 检查 | 结果 |
|---|---|
| 完整 backend：`python -m pytest -q -ra tests web_api/tests --tb=short` | 3126 passed, 14 skipped, 784 warnings in 1503.69s (0:25:03)；退出码 0，3140 collected |
| 会话、旧兼容、实际 HTTP 专项 | 29 passed；并发首次加载、有效/过期/重启、精确开发 origin、缺失/重复 Origin、伪造 Host、跨站、无效 CSRF、方法及正文拒绝、无 Core 副作用 |
| 正式 CLI / 启动 / 会话专项 | 26 passed；正常执行、Crash B UNKNOWN、重启和原路径离线恢复断言保留 |
| Frontend unit / typecheck / lint / build | 263 passed，26 files；类型、lint 和构建通过，lint 0 warnings |
| 会话生命周期真实浏览器 | 9 passed；普通 URL、StrictMode 实际入口、并发标签、刷新、过期、后端重启、浏览器进程重启、实际跨源拒绝、丢 ACK 不重放、Reply Worker 中断与重启 |
| Runtime 浏览器 | 4 passed；1440/1024/390，实际 HTTP/SQLite/Worker/Runner/文件/Acceptance、范围读取、单次批准、UNKNOWN、正文、键盘、明暗、导航 |
| Skill 演化浏览器 | 9 passed；真实产品的 Candidate/SHADOW/Gate/晋升/激活/后续 Runner 复用及明暗视觉；Provider 为明确的离线 TCP 替身 |
| 默认浏览器回归 | 27 passed；六尺寸、键盘、转义和采样可访问性 |
| 新环境安装 | 新 venv 中 `pip install -e ".[web]"` 通过；独立空目录 `npm ci` 安装 321 包、audit 0 vulnerabilities；不是全依赖安全认证 |
| Vite 开发模式 | 真实 5173 → 8792 代理入口、自动会话及刷新通过；Host/Origin 不改写，无手工代码 |
| 真正 DeepSeek | 原生 Windows 凭据录入及重启加载、CONNECTED；5 条实际回复（含多轮/长中文/英文/Markdown/刷新/切换）及 2 次实际模型文件任务；每次精确批准后 config.txt 为 timeout=20，Core COMPLETED、VALIDATION_PASSED 和 RUN_COMPLETED 均存在 |
| 新 Linux / 长时间 soak / 其它浏览器 | NOT RUN；不沿用此前结果冒充本轮认证 |

最终14 skipped为13项 Windows symlink 权限和1项 POSIX FIFO；784 warnings来自冻结 `validators.py` 的 `PureWindowsPath.is_reserved()` 弃用提示，未过滤。Node 的 NO_COLOR/FORCE_COLOR 提示保留。

首轮完整运行保留为 `2 failed, 3121 passed, 14 skipped, 784 warnings`：两项旧生产 CLI 测试等待被移除的终端代码而超时。原件已留存，只把连接步骤改为普通 URL 就绪和同源 bootstrap，执行、Crash B、重启、备份/恢复断言不变；专项通过后重跑了上述完整回归。初始新增行为的 RED、并发连接 reset、过时前端断言、选择器和 fixture 配置错误、遗漏 stages、错误 cwd 和未用 import 均保留，不能将这些尝试重写为一次全绿。

真实 Provider 的直连最初被 endpoint_policy 拒绝：本机 DNS 为 198.18.x.x。仅在全新隔离配置使用既有显式限时 CONNECT 机制，固定公网目标、保留官方 TLS/SNI/Host；未修改 Provider transport、关闭 TLS 校验或使用隐式代理 fallback。代理最终 peer 未独立观测；路由到期后仍拒绝新调用，历史事实可读。真实凭据只在 OS vault/后端内存，未写入 Git 或审查材料。

## Preview Bug Register

共用来源：初始 `70272d8`，Windows 上述环境。修复代码与本节被测实现相同，提交后按不可变身份核对。所有失败历史保留。

| ID / 分类 / 优先级 | 复现、预期与实际 | 持久状态 / 根因 / 处理 / 复测 |
|---|---|---|
| LS-01 UX_IMPROVEMENT P0 | 直接打开普通 URL 应进入可用工作台；旧流程依赖 CLI 能力或终端代码、重启后重新授权 | 仅会话内存改变；旧入口设计所致；透明 bootstrap 与 UI 清理完成；HTTP/浏览器正反例通过 |
| LS-02 CONFIRMED_BUG P1 | 两标签并行资源/读取在四槽短暂占满时应等待；旧服务立即 reset | 无持久变化；非阻塞 acquire 后直接 close 已由独立 RED 证明；250ms 有界等待修复；HTTP GREEN、同条件八轮双标签零失败 |
| LS-03 CONFIRMED_BUG P2 | 新例子应引导当前 Windows 自助模型设置；旧终端提示却要求环境变量且称不能在浏览器录入 | 无持久变化；说明滞后；已修正示例 CLI 提示；新环境与正式 CLI 用例通过 |
| LS-04 ENVIRONMENT_LIMITATION P1 | 官方 Provider 应可连接；本机 Fake-IP 直连被 endpoint_policy 拒绝 | 失败连接测试事实保留；当前 DNS 已确认，不能外推所有旧失败同因；显式隔离路由后 CONNECTED、实际回复和文件任务通过，路由仍有到期限制 |
| LS-05 UX_IMPROVEMENT P2 | 页眉重复整段输入，模型控件只显示配置名，错误显示会话技术码 | 无执行状态改变；已简化页眉、显示模型 ID、使用可读错误；最终前端与 Runtime 浏览器通过 |

原始日志/截图位置由本地审查记录索引，不发布秘密、Cookie、私有 Oracle 或个人文件。确认的修复不会删除历史执行、失败 Trial 或 UNKNOWN。

## 实测性能与边界

会话浏览器本次冷启动到 HTTP 就绪为单样本900ms，后续三次进程启动367/374/385ms；首次工作台可见443ms。真实已完成任务打开275/267/282ms，刷新372/278/295ms。一次真实短回复从提交到正文可见2356ms，包含 bootstrap、Worker、外网和轮询。共享主机、有缓存与采样条件不同，不作统计提速结论。最终入口473.91kB/gzip149.81kB；Markdown 仍按需加载117.54kB。一次页面观察337 DOM 节点、JS heap约12MB，不证明长期无泄漏。费用/tokens 未完整留存，不编造成本统计。

冻结核对：62个已跟踪 Core 文件与5个 Web SQL 文件相对初始提交逐字节不变；没有新迁移、Core/研究协议重写、任意 shell、自动晋升、UNKNOWN 重派、EXE、GA/tag 或版本上调。聊天最多保留最近4项有界历史；任务最多16轮，48KiB上下文，最多8文件/单文件8KiB/合计16KiB。持久历史不等于无限模型记忆，当前无向量记忆/RAG承诺。

毕业演示步骤见 [对话与任务](CONVERSATION_WORKBENCH.md#五至十分钟毕业演示)：自然对话 → 一次批准文件任务 → 实际 Skill 演化与复用 → Inspector → 隔离 UNKNOWN。工程夹具不证明 Skill 因果改善或泛化。

**Holdout NOT_FROZEN_NOT_RUN，论文主实验 NOT_STARTED；本地预览与毕业演示闭环已验证，继续 PREVIEW_CONTINUES。** 以下各节为历史结果。

<!-- LOCAL_SESSION_CURRENT_END -->

<!-- AGENT_UX_CURRENT_START -->
# Conversation-first Workbench — 2026-10-25

**体验改造已实现，产品仍为 0.1.0 Preview。** 基线 `d3177601deb073e5515a976b558bbebee7fc0ee8`；最终生产集合 SHA-256 `7eeab09659d55047a8f436a0dd5bb6e3bc4969836d60611c0b5e48fa0b9dd3c4`。
Tested implementation commit：`b7d6760a17f01836d2c5e84367a908aead848e4a`。已逐文件核对该提交的166个生产文件与最终测试快照完全一致；剔除5项忽略的egg-info生成metadata后，已发布生产集合SHA-256 `42d08a9a7fc370bb1e895de2df10f74e192e9710aa474829da63d2e8ffc400d6`。本次仅文档提交记录此身份，测试源码及完整证据仍为本地私有。

本轮包含真实无工具模型回复、CHAT/TASK 有序对话、紧凑活动与按需已提交工具正文、Windows 后端原生密钥登记、可信 CLI 自动会话交接、明确路径范围的纯读策略和一次上下文写入批准。Core Runner/Tool Intent/Acceptance/Inspector/Checkpoint/Recovery、Skill 和研究协议均保持冻结。策略收据明确为 POLICY，不冒充人工批准。

| 检查 | 最终结果 |
|---|---|
| Windows 普通 CPython 3.13.5 / SQLite 3.49.1 完整回归 | 3110 passed, 14 skipped, 784 warnings in 1074.48s (0:17:54)；3124 collected |
| Provider/凭据/历史/HTTP/进程专项 | 107 passed in 7.06s；包含解码后的引号/反斜杠秘密过滤 |
| 前端 unit | 259 passed，26 files，10.97s |
| typecheck / lint / build | passed；lint 0 warnings；入口 476.13kB/gzip150.59kB，Markdown 首次正文另外加载 117.54kB；未放宽分块警告阈值 |
| npm production audit | 0 vulnerabilities；不等于所有安全保证已证明 |
| 最终 Runtime 浏览器 | 4 passed (1.0m)；1440/1024/390，实际 HTTP/SQLite/隔离 Worker/Runner/文件与 Acceptance；完整纯读、重复点击、写入、UNKNOWN、正文、键盘、连续导航和明暗 |
| 默认浏览器回归 | 27 passed (33.4s)；已批准 UI 文案的测试断言同步，原件归档 |
| Windows Provider 登记浏览器 | 1 passed (3.8s)；原生 vault + HTTP，Provider 为离线替身；原生合成 key 存储/重开/清除独立通过 |
| 正式 CLI 自动登录与重启 | 两次真实进程生命周期；0 手工代码；旧会话 401、新交接、旧标签刷新通过；0 模型/工具调用 |
| 演化到真实复用 | 最终完整浏览器 9 passed (3.5m)：实际编辑/Candidate/SHADOW/Gate/晋升/激活/后续 Runner 复用和8组明暗视觉；早期选择器失败保留 |
| 原生浏览器缩放 | tabs.setZoom 125%/200% 实测 ratio=1.25/2，1440px 视口 CSS 宽度1152/720，无横向溢出 |
| 新 Linux / 新真实 Provider | NOT RUN：Docker Desktop 启动故障；本轮没有新外网模型调用。历史结果不是本轮认证 |

最终性能为原 d317 前端和新构建在同样离线 fixture 的单次样本：入口472497→476127 bytes；首次已认证就绪179.39/172.80ms。共享主机负载，不作统计提速或长期无泄漏结论；不能把 jsdom/build/离线模型验证称为真实 DeepSeek 联机认证。采样 axe 0 violation 不等于全部辅助技术认证。没有外部用户计时研究。

原始失败和跳过未删除。初始隔离全量1 failed/3107 passed/14 skipped因旧 Oracle 父目录未准备；补齐后原用例通过，随后完整快照3108 passed/14 skipped/784 warnings；新增最后两项 JSON 转义反例和最小字段过滤后再跑最终完整回归。开发 RED/选择器/错误命令/中途检查记录均在本地账本，未改旧 Core/WebAPI 测试、未过滤 Python warnings。最终14 skipped为13项Windows symlink权限与1项POSIX FIFO；784 warnings均来自冻结validators.py的PureWindowsPath.is_reserved()弃用提示。

冻结比较：基线323项、193冻结条目无变化/缺失；62个Core文件、128个旧Core/WebAPI测试文件和15个历史SQL迁移均字节相同。9个前端测试按实际UI/文案更新断言，原件本地归档。新持久化仅Web016/017，须显式初始化/离线副本升级，普通读取不迁移。新依赖：MIT Radix Colors3.0.0、react-markdown10.1.0、Windows可选keyring25.7.0；undici锁定仅7.30.0→7.30.1补丁，Core依赖仍为空。

私有测试/fixture/交付报告/日志/截图/ZIP不推送。可复现说明见[对话与任务](CONVERSATION_WORKBENCH.md)、[启动说明](WORKBENCH_SETUP.md)与[界面规范](WORKBENCH_UI_SPEC.md)。Windows 自助预设仅DeepSeek；Linux无明文密钥fallback；Worker不是OS安全沙箱；范围授权不承诺执行预检之后的即时撤回；正文过滤不是完整DLP；模型文字不能授予权限或决定Acceptance。

**Holdout NOT_FROZEN_NOT_RUN，论文主实验 NOT_STARTED；无 Phase5Step4、GA/tag、自动 UNKNOWN 重派或研究协议修改。** 以下为历史阶段记录，不能冒充本轮测试。

<!-- AGENT_UX_CURRENT_END -->

<!-- RELEASE_READINESS_CURRENT_START -->
# Release readiness — 2026-10-24

**产品判定：PREVIEW_CONTINUES；版本仍为0.1.0 Preview。** Baseline `85a418948a25b3f04cdd3a7d681c6fa9187c4001`。
本轮结果来自有明确dirty标记的工作区验证；生产源码集合SHA-256 `311ce7bd92d9cc7865e65239a085ebc1dd5f83007b0ca8175ec5936069df47d1`。
Tested implementation commit：`14d4125c173c827c59ff09fbc2dbd325650ba758`。逐文件验证该提交的全部已发布生产字节与测试快照相同；去除5项忽略的egg-info生成metadata后，已发布源码集合SHA-256 `f94f1088742d9d1ab2435a6547d57090e36b4d777350a187627900c771e69a58`。
后续仅文档提交记录此身份，不改变已测试生产字节。
完整私有测试、失败账本、截图、Oracle和审查ZIP保留本地；公共仓库只提交实现、必要说明与本结果。

| 检查 | 当前实际结果与边界 |
|---|---|
| Windows 普通 CPython 3.13.5 / SQLite 3.49.1 完整回归 | `3032 passed, 14 skipped, 784 warnings in 1152.58s (0:19:12)`；3046 collected |
| 最终 Windows WebAPI 源快照 | 442 passed, 1 failed in 279.58s；唯一失败是隔离副本尚缺 node_modules，补齐既有依赖后原 case 1 passed in 0.07s。保留失败，属于组合验证，不改写为一次全绿 |
| 最终 Store Runtime 准入负测及相关启动 | 23 passed in 13.05s；构造器与正式 CLI 均拒绝 |
| Linux Python 3.12.14 / SQLite 3.46.1 完整回归 | `3032 passed, 15 skipped in 864.38s (0:14:24)`；3047 collected；当前最终全部生产字节一致 |
| Python 3.11 / 3.12 受限文件路径专项 | 各185 passed（1.49s / 1.52s）；Store解释器，仅传输/Checkpoint，不是Runtime认证 |
| Frontend typecheck / lint | passed；lint 0 warnings |
| Frontend unit | 235 passed / 19 files，11.65s |
| Frontend build | passed；入口472.49kB/gzip149.93kB；设置/演化首次导航加载，未调整500kB阈值 |
| 默认 browser E2E | 27 passed (37.9s) |
| production dist / TCP Gateway browser | 7 passed (1.6m)，六尺寸；实际Worker/审批/独立验收，模型为离线替身 |
| 真实已记录DeepSeek事实 browser | 1 passed (30.4s)，25轮导航；无新增模型调用 |
| production CLI / Crash B / 重启 / 原路径恢复 | 3 passed (9.84s)，新环境与副本，未动用户生产安装 |
| Core wheel | 固定SOURCE_DATE_EPOCH与构建工具，两次字节一致；全新venv离线安装、仓库外导入与12个SQL资源通过 |
| public offline smoke | 源码安装路径3.11/3.12/3.13通过；真实Runner/SQLite/文件验收，0模型调用 |

Windows完整运行启动早于最后一项构造器防护提取及其新增负测；最终WebAPI组合验证、23项准入测试及Linux完整最终快照覆盖该变更。不能把3046冒充3047 collected的一次Windows全量。

Windows最终14 skips为13项symlink权限限制与1项POSIX FIFO；Linux15 skips全部是Windows专用实验。3.13完整回归784条warning均来自冻结`validators.py:40`的`PureWindowsPath.is_reserved()`；未使用warning过滤。Node `NO_COLOR`/`FORCE_COLOR`提示保留。

早期失败没有删除：Store3.12为2 failed/3018 passed/14 skipped；普通3.13为1 failed/3019 passed/14 skipped/784 warnings；Store3.11为3 failed/3021 passed/14 skipped。实际暴露目录时间戳遗漏新增文件和Store进程后代清理问题；后者具体broker机制未独立证明。Checkpoint增加名称集合复核，Store Runtime明确拒绝；普通Windows3.11/3.12分发下载因timeout/TLS EOF未能完成，资格认证PENDING。首次Linux初始化中止；下一完整运行1 failed/3027 passed/15 skipped仅因旧私有Oracle输出父目录缺失，最终runner准备该目录后全量通过，旧测试不改。

其它开发RED/错误设置均保留：HTTP定界/关闭、晚到ACK、维护sidecar别名、缺lazy资产、构造器准入的反例；早期Legacy拆包导致17旧前端用例失败，已完全撤回`App.tsx`变更；3版公开smoke最初缺安装、旧脚本路径及新测试double/fixture设置修正见本地账本。未将这些尝试重标为PASS。

真实DeepSeek在一次性环境完成1次修订+10次封闭配对+1次新任务规划，无重试。configuration.patch@3为5/5，参考@1为4/5，改善1/回归0/UNKNOWN0；用户分别批准候选、SHADOW、晋升、激活及精确Plan。真实Run有3个Intent/Result，独立验收后COMPLETED；旧失败/Trial保持。11次可审计usage合计35085 tokens，最后普通规划Worker的usage未保留、不可补造。实际live发生在Store3.12限制前，不等于该Runtime已认证；普通3.13最终闭环回归使用离线模型。

真实网络使用新管理员显式、限时、固定公网IP CONNECT路由，保留官方TLS/SNI/Host；系统Fake-IP DNS的直连仍拒绝，旧连接失败不能追认为同一唯一根因。代理最终peer属于管理员信任假设；不读取系统代理作为隐式fallback、不读取Harness凭据。新网络调用在route过期后拒绝，历史已规划证据仍可读。授权header/密钥未进入Git或ZIP。

冻结核验：152个旧测试文件、15个SQL迁移字节相同；62个Core文件中59个不变，仅`planning_adapter.py`（HTTP framing/清理）、`evaluation_campaign_adapter.py`（实际非秘密route绑定）、`checkpoint_manager.py`（目录复核）三个明确例外。Runner/tools/storage/Inspector/SkillManager/Binding/Recovery均未改；Crash B和UNKNOWN语义保留。依赖锁、品牌资产、版本未变。

两个Core wheel SHA-256均为`a66473b215e5de1e8a6137498d995bbe1b4f217e51b499133faf0aed5ce71a79`。Web安装需完整checkout和显式build；正常启动不隐式迁移，DB-only备份不能替代完整同停机窗口数据备份。仅支持已验证原绝对路径离线恢复，不透明搬迁历史workspace。详见[运行与维护约定](RELEASE_OPERATIONS.md)。

生产浏览器Edge155.0.4283.62，六尺寸1920×1080、1440×900、1366×768、1280×800、1024×768、390×844，91张实际截图；25轮导航DOM441/监听器208稳定，JS heap4.38→5.11MB。不是长时soak、实体手机或其它浏览器认证。Node24.14.0/npm11.9.0；未声称所有Node22+组合均独立复验。

**正式Holdout NOT_FROZEN_NOT_RUN；论文主实验NOT_STARTED。** 五个开发封闭用例不证明泛化、模型语义服从或Skill因果收益。没有tag、GA下载发布、Phase5Step4、自动审批、UNKNOWN重放或生产安装迁移。

<!-- RELEASE_READINESS_CURRENT_END -->

<!-- PHASE5_STEP3_CURRENT_START -->
# Phase 5 / Step 3 — 2026-10-22 结果整理

Baseline `65fda2a256462f0df5461fb1cb70788b7d27cbbc`。Tested source `1e742919503d8effadc39001369a2a19985d3e4b`。
生产源码集合 SHA-256：`486815f8fdc8d11d58e42ef306347f69da7ae8aba6d3a65b39b585b76c2a10e8`。完整原始输出、私有测试、故障 Oracle、截图与冻结清单保留本地审查包；不发布测试或私有研究答案。

| 检查 | 实际结果 |
|---|---|
| Windows Python3.12.10 `python -m pytest -q -ra tests web_api/tests` | 2953 passed, 14 skipped in 1346.11s (0:22:26) |
| Windows Python3.13.5 `python -m pytest -q -ra tests web_api/tests` | 2953 passed, 14 skipped, 784 warnings in 1263.49s (0:21:03) |
| Linux Python3.12.14 `python -m pytest -q -ra tests web_api/tests` | 2952 passed, 15 skipped in 955.47s (0:15:55) |
| 默认 Workbench Browser | 27 passed (36.8s) |
| Gateway/Worker Browser | 7 passed (1.5m) |
| 多轮会话 Browser | 9 passed (4.6m) |
| 多代流程/视觉 Browser | 11 passed (13.8m) |
| 键盘 Browser | 1 passed (25.1s) |
| 实现提交上的离线研究正控制 | Gate10次+research4次本地替身调用；A/B/C各2/2，B/C共用Trial；外部模型调用0 |
| Frontend typecheck / lint | passed；lint 0 warnings |
| Frontend unit | 225 passed / 18 files |
| Frontend build | passed；JS525.68kB/gzip164.71kB；保留Vite >500kB提示 |
| 新增 crash 测试输出目录可移植性复验 | Windows3.12：3 passed；3.13：3 passed；原业务断言未改 |

Windows SQLite3.49.1；最终Linux SQLite3.46.1 / glibc2.41，隔离native目录、网络关闭，仅loopback替身。Linux环境来自明确记录的缓存镜像，父pytest关闭第三方plugin自动加载；子进程继续使用冻结生产环境规则。没有warning filter。Windows每版14 skips为13项symlink权限不可用和1项POSIX FIFO；Linux的逐项Windows-only skips见原始日志。3.13的784条warning均来自未改的`validators.py:40`；两处高频调用改用同解释器等价兼容入口，未声称零warning或Python3.15认证。

这里的无filter指全量命令没有`-W`或项目/生产级抑制；新增兼容测试局部捕获**旧API测试Oracle**的预期弃用warning，并把生产路径设为warning=error。784为pytest实际汇总，不把这些主动捕获的Oracle警告伪装为生产零警告。

Linux初次全量真实记录53 failed/2899 passed/15 skipped，原因包括受控子进程pytest未安装、git/历史源码/Node与旧输出父目录缺失。后一个快照另发现两项**新**测试Oracle输出目录缺失；明确停止旧验证容器，保留partial log，修正新测试`mkdir(parents=True)`后重新完整验证。没有改旧测试、隐去失败或把容器137退出当产品Worker实验。最终完整Windows生产字节未因此改变。

另一个SQLite3.40.1镜像的完整运行50 failed/2902 passed/15 skipped，底层trace定位`trusted_schema=OFF`与`json_valid()`unsafe标记冲突；未叠加本轮代码的owner基线65fda2a同case同样失败。原只读防护与schema未改，最终采用SQLite3.46.1验证；旧组合明确不可认证，详见[启动说明](WORKBENCH_SETUP.md)。

2026-10-21另一次Linux运行停在84%且无completion记录；22日恢复时Docker服务不可用，恢复后旧容器报告exit255、非OOM，外部停止原因未确定。该partial log保留但不计通过；最终结果来自全新隔离运行。

Gate v1原限制独立复现：v2→v3本轮选10个Trial，而历史census为15；全部20个旧Intent/Result保留。显式`evolution-gate-v2`前瞻campaign通过v1→v2→v3→v4离线正控制，共30个新Trial；完整声明、role、额外attempt、UNKNOWN、首次seal、重哈希、profile配置、陈旧Assessment、并发与原子晋升均有负测。晋升/激活分开，祖先rollback只是新增路由；真实新conversation任务仍由原Runner与独立Acceptance完成。

Research dry-run使用隔离副本、精确protocol批准、A/B/C同candidate与精确版本共享结果。所有声明case/失败/UNKNOWN/未提交保留分母；真实submission/Result后的hard exit不重放。正式RESEARCH_DATA holdout在开发加载时不打开，当前API拒绝正式holdout执行。源码commit标签与实际源字节SHA分别记录；export白名单不含Oracle答案、绝对路径或请求响应原文。

提交后另行验证62个Core Python/SQL原始字节与实际实现Git提交一致，固定新protocol后运行正控制；原registry未变、生产Run0。该证明独立于API caller-label字段，旧快照未被改写。脚本批准不当作真人批准或真实LLM收益。


真实DeepSeek：两次本轮修订生成均为connection TRANSPORT_FAILURE，失败保留；用户明确选PENDING。本轮无新真实candidate/promotion/activation或计划执行。随后单独最小官方HTTPS诊断HTTP200/OK，reported usage9tokens，仅证明接口连接；`reasoning_effort=none/max_tokens=16`未混入冻结planner参数或实验用量。官方文档：[Chat Completion](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)。不能据文档默认thinking推断此前失败根因。

当前浏览器合计55例：27+7+9+11+1。多代五尺寸/双主题11view共110张，另1张实际Run；实际Edge/HTTP/SQLite/Worker，axe和键盘通过。旧`runtime-integration`/`runtime-process-visual`仍保存原源码及已复现的`/threads`旧UI等待失败，正式退役为历史材料，不计为通过；现用`/conversations`的替代脚本与Python旧HTTP契约分别覆盖。Node NO_COLOR/FORCE_COLOR、slow-file提示保留；无真实手机或其它浏览器认证。

冻结：52个旧Core中49个字节相同，仅两处path判定调用与三行精确v2分派例外；132旧测试/fixture、001–013共13迁移、依赖和品牌资产不变。没有改Runner、tools、storage、Inspector、SkillManager/Binding或Checkpoint/Recovery语义。

**正式论文主实验NOT_STARTED；final holdout NOT_FROZEN_NOT_RUN；真实演化PENDING。** 工程夹具不能证明泛化或Skill因果收益，同账户本地文件不是强制盲性；冻结transport tokens/cost不可用。未进入Phase5Step4、任意shell或桌面封装。

<!-- PHASE5_STEP3_CURRENT_END -->

# Phase 5 / Step 2 — 当前验证

Baseline `7ee224edfd820ab1dd35b41198b19e37fb4d3537`；tested source `e8203706c2aa2935cd76a91d4a55ad54a9c883e5`。Windows / Python 3.12.10、3.13.5 / SQLite 3.49.1；完整原始日志、XML、故障 Oracle、截图与冻结清单保留本地审查包。

| 命令范围 | 实际结果 |
|---|---|
| core-py312 | 2350 passed, 14 skipped in 812.62s (0:13:32) |
| core-py313 | 2350 passed, 14 skipped, 5312744 warnings in 894.27s (0:14:54) |
| backend-py312-final | 389 passed in 258.33s (0:04:18) |
| backend-py313-final | 389 passed, 290003 warnings in 252.20s (0:04:12) |
| Frontend typecheck / lint | passed |
| Frontend unit | 217 passed / 16 files |
| Frontend build | passed；保留单 chunk >500 kB 的 Vite 提示 |
| 当前演化 Browser E2E | 9 passed，0 failed/skipped；Edge，四尺寸双主题 |
| 当前默认只读/演示 Browser E2E | 27 passed |
| 当前离线 Gateway / 多轮 / Worker Browser E2E | 7 passed |
| 历史单轮 runtime.playwright.config.ts | 1 failed：旧脚本仍等待 POST /threads，当前 UI 使用 /conversations；旧断言未修改 |

Core 命令：`python -m pytest -q tests -ra --junitxml=...`；Web 命令：`python -m pytest -q web_api/tests -ra --junitxml=...`。3.13 使用 `.git/compat-venv313/Scripts/python.exe`，本轮均未加 warning filter。3.13 警告来自冻结 Core 的 `PurePath.is_reserved()` 弃用；按各日志实际总数保留，未报告成零。每版 Core 的14 skips为13项 Windows symlink 权限不可用与1项 POSIX FIFO不可用，逐项原因见审查包 `platform-skips.json`。没有本轮 Linux、物理手机或其他浏览器认证。

新 Browser 命令：`npm run test:e2e -- --config=evolution.playwright.config.ts`。新测试命名为 `runtime-skill-evolution.spec.ts`，使用专用显式离线 HTTP/Worker/Core harness；不让默认静态演示测试误连接它。新浏览器网络 trace 关闭，未保存 session Cookie/CSRF；保留 Node NO_COLOR/FORCE_COLOR 环境提示。可访问性问题和开发失败记录均保留，不删除失败分母。历史单轮脚本的本轮 timeout 与先前保留结果相同（runtime-integration.spec.ts:50），不能称旧浏览器测试全部通过；当前会话与实际执行由7例 Gateway 和9例演化流程覆盖。旧 process-visual 脚本未在本轮重新认证。该差异不改变 Core/HTTP 契约，原脚本未改写。

真实 DeepSeek / `deepseek-flash`：官方 HTTPS 修订返回严格 VALID，用户精确批准后创建 `configuration.patch@2`。随后获批准的5例/10次真实配对调用产生1项回归（create_nested_artifact），Gate `REGRESSION_BLOCKED`，该候选保持 SHADOW，无晋升/激活。首次直接路由连接失败也保留为独立 TRANSPORT_FAILURE，无身份重放。当前本机 VPN 使用管理员限定代理 CONNECT 到验证过的公网 IP，TLS仍核验官方域名；没有放宽产品公网地址校验。官方接口说明：[DeepSeek API](https://api-docs.deepseek.com/quick_start/agent_integrations/)。

另一组**离线 TCP 模型替身**候选通过原 Core 五例 Gate、精确晋升与单独激活，Web实际完成用户编辑与新 Runner 文件任务。真实 DeepSeek 后续任务复用该独立合格版本的状态：COMPLETED / 独立 Acceptance PASS；来源明确为离线资格候选。不能把这组资格结果改称被阻断的 DeepSeek 候选已改进。

冻结核验：52个既有 Core 文件、12个历史迁移、116个既有测试/fixture字节相同，依赖未改。新修订读取器还核验完整九字段稿件、批准、生成与Core回执链；真实硬退出、COMMIT失败、部分桥接、重复调用/批准、陈旧历史和权限拒绝均有新增负测。正式论文比较实验未开始。

<!-- PHASE5_STEP2_CURRENT_END -->

# 测试结果

## Phase 5 / Step 1 — 2026-10-18 当前验证

Baseline Commit: `506a8511c6593bf10e9e699069b44c1834843bab`。
Tested Source Commit: `39f74a33873aa90eeee8c5f8178e8fae6c882fb0`（验证在提交前、相同生产源码字节上完成）。
环境：Windows 11 build 22631；Python 3.12.10 / 3.13.5，SQLite 均为 3.49.1；Node 24.14.0；Microsoft Edge 155.0.4283.45。

| 检查 | 实际结果 |
|---|---|
| Python 3.12 `python -m pytest -q`（Core） | 2350 passed, 14 skipped；未报告 warning；815.91s |
| Python 3.13 Core（命令含下述 -W） | 2350 passed, 14 skipped, **5,323,149 warnings**；726.61s |
| Python 3.12 `python -m pytest -q web_api/tests` | 310 passed；未报告 warning；167.16s |
| Python 3.13 `python -m pytest -q web_api/tests` | 310 passed, **2,356 warnings**；151.49s |
| 每个 Python 环境全部可访问后端用例 | 2660 passed, 14 skipped（2674 collected） |
| `npm run typecheck` / `npm run lint` | 通过；lint 0 warnings |
| `npm test` | 15 files，210 passed |
| `npm run build` | 通过；JS 480.71 kB / gzip 152.00 kB；CSS 91.34 kB / gzip 16.31 kB |
| `npm audit` | 0 vulnerabilities；不是完整安全证明 |
| 当前 Browser contracts | **45 passed**：既有工作台27、多轮9、真实历史只读1、Gateway7、fresh DX/HMR1 |
| 更早里程碑 UI 脚本（不计为通过） | runtime1 failed；step3 visual2 failed、4 did not run；见下文基线复现 |

73 个新增 backend cases、10 个新增 frontend unit cases，既有测试源码保持原字节。14 个 Core skip 为13项缺 Windows symlink privilege/WinError1314、1项 POSIX FIFO；不计为 passed。两套 Python 原始 XML/输出和逐函数 skip 原因保留于审查包。

Python3.13 Core 命令含 `-W 'ignore:.*is_reserved.*:DeprecationWarning'`，实际仍产生上述5,323,149条警告；没有改项目过滤规则或把它报告为零。WebAPI完整运行未过滤，警告来自冻结 Core 的 `PureWindowsPath.is_reserved()` 弃用。另一个未过滤定点样本为1 passed、96 warnings。Node的 NO_COLOR/FORCE_COLOR 提示保留于原始 browser logs。没有本轮 Linux、物理手机或其它浏览器结果。

**历史 UI 脚本缺口**：早期 `runtime-integration.spec.ts` / `runtime-process-visual.spec.ts` 仍等待 UI POST `/threads`，而 Phase4Step4 已采用 `/conversations`。本轮补跑出现上述失败；在未叠加 Phase5 代码的 baseline `506a851` Git archive +独立 build 上，也于同一等待位置复现。没有改回生产协议或削弱原断言；旧源码和失败保留，不能声称全部历史 browser suites 全绿。当前多轮、逐轮批准、真实 worker/UNKNOWN 与六尺寸由9+7等当前接口测试覆盖。

干净 Git archive+当前源码 overlay、独立 venv、pip install、npm ci、只读 --check 与 production build 均通过。实际 HMR修改不发生主frame跳转，保留中文草稿/session/immutable proposal/hash；恢复文件后明确批准，原Runner执行、独立验收PASSED。开发入口默认只读，不自动建立fixture或迁移历史库，后台不热重载。

可选 Local Gateway 使用同一 ProviderStore、独立管理员 endpoint/model allowlist，literal `127.0.0.1`+显式端口，不放宽公网HTTPS。真实离线TCP覆盖模型发现、有效/无效/截断响应、401、redirect/proxy、总deadline、严格chunk framing、错/重复approval、revision pinning、规划网关os._exit(70)与执行Worker Crash B。Fake Gateway不等于DSH认证；SQL/Runner/文件/Acceptance均真实。

官方DeepSeek本轮实际 connection-test 为 CONNECTED（2026-10-18，profile r1/config hash 固定）；本轮没有新增live Plan或重用上轮批准。原已批准两轮DeepSeek事实只读浏览器复核1 passed。公开DSH源码刷新为 `f0b979f` / v2.5.3，PR#377 closed、merged=false，维护者说明功能已整合；这不证明本机实装。用户明确选择将 DSH/WorkBuddy真实联机保持 **PENDING**。

52个Core文件含001–010、2个Web SQL、106个历史测试/fixture、15个依赖/许可证/品牌资产hash均不变。没有新migration、依赖、Core freeze exception、桌面打包或下一阶段实现。原型仍非完整OS沙箱；HTTP loopback与管理员信任、默认公网DNS边界不作更强保证。

中间失败如实保留：新私有test lint错误、Windows拒绝TE时TCP reset、stdlib截断chunk宽松，以及Vite误用worker内存限制；均在授权Web/DX边界修正并复验。一次误启的重复Core测试进程只终止该副本，原始完整运行和XML保留；该原始log有进度覆盖/NUL，未伪造干净输出。

私有测试/fixture/报告/ZIP不推送；源码、使用说明和本测试结果按AGENTS.md发布。

## Phase 4 / Step 4 — 2026-10-16 当前验证

Baseline Commit: 2012cb3e912e744f8ecb6802ed68e74d67674bf8
Tested Source Commit: 649b50388bbcadc3835f50f2c1ecd79482646108
Final Remote Main: see Git main / local publication.json (reported separately).
Python: 3.12.10 / 3.13.5; SQLite (3.12): 3.49.1; OS: Windows.

| 检查 | 实际结果 |
|---|---|
| Python 3.12.10 `python -m pytest -q`（Core） | 2350 passed, 14 skipped；0 reported warnings |
| Python 3.12.10 `python -m pytest -q web_api/tests` | 237 passed；0 reported warnings |
| Python 3.13.5 Core | 2350 passed, 14 skipped, 5,326,760 warnings |
| Python 3.13.5 Web API | 237 passed, 2,286 warnings |
| 全部可访问后端用例（每个 Python 环境） | 2587 passed, 14 skipped |
| `npm run typecheck` / `npm run lint` | 通过；lint 0 warnings |
| `npm test` | 14 files, 200 passed |
| `npm run build` | JS 475.78 kB / gzip 150.43 kB；CSS 91.34 kB / gzip 16.31 kB |
| `npm run test:e2e`（既有工作台） | 27 passed |
| `npx playwright test --config step4.playwright.config.ts` | 9 passed；六尺寸、性能、读取/批准响应替换攻击 |
| `npx playwright test --config step4-live.playwright.config.ts` | 1 passed；展示实际 DeepSeek 两轮记录，未新增 Provider 调用 |


跳过：13 项需 Windows symlink privilege（WinError 1314），1 项 POSIX FIFO；完整函数/理由见 review_evidence/phase4_step4/skipped-tests.json。没有将 skipped 算作 passed。
Python 3.13 的警告来自冻结 Core 的 PureWindowsPath.is_reserved() 弃用。Core 命令曾附 -W 'ignore:.*is_reserved.*:DeprecationWarning'，实际未抑制这些警告；报告按观察到的 5,326,760 条计入。Web 命令未加过滤。原始输出、XML 均保留。Node NO_COLOR/FORCE_COLOR 提示见原始日志，不能报成零测试进程警告。
Linux 没有本轮结果：仅发现 stopped docker-desktop WSL 管理发行版，未运行 Linux Python 测试。Windows 结果不外推。没有新增依赖或修改 Core/001–010/011；52 个 Core 文件、98 个既有测试/fixture 源文件和 THIRD_PARTY_NOTICES 字节保持不变。

真实 DeepSeek 两轮逐计划批准与独立验收通过；实际浏览器读取了这两轮持久记录，没有新增模型调用。完整事实定位、网络路由限制及 API 见 [INTERACTIVE_SESSIONS.md](INTERACTIVE_SESSIONS.md)。Crash B 后 Core UNKNOWN 语义、服务可用性和无自动 replay 已用真实 hard exit 验证。

新增 21 个后端用例、18 个前端用例；既有测试源码不变。9 个 Runtime browser cases 包含 6 尺寸、16 轮/500 事件测量与两项跨 Run 响应攻击；另 1 个页面读取实际 DeepSeek 记录，既有 27 个 E2E 保留。完整源、fixture、raw logs、117 PNG 和报告仅在本地审查包中。

实现了本轮范围，未进入下一阶段/EXE。保留初次失败与修正记录，不将 Windows 测试外推 Linux、不以本地 provenance 证明模型内部理解。

## UI 全面重构 — 2026-10-16 当前验证

Baseline: `36362b5`。Tested source: `4028d689ecda2ed57c98d450e1416c3ca1aa267a`。参考为 `Caho1/open-claude-ui@2834bc158a4849f21c97cbb2e0b10525f6e646f1`。本轮仅改变前端与使用说明，Core / web_api 的实现与接口保持原样；以下 Python 历史结果没有在本轮重跑。

| 本轮检查 | 实际结果 |
| --- | --- |
| `npm run typecheck` / `npm run build` | 通过；生产 JS 466.00 kB / gzip 147.29 kB，CSS 90.29 kB / gzip 16.09 kB |
| `npm run lint` | 通过，0 warnings |
| `npm test` | 13 files，182 passed，0 failed / skipped |
| 旧工作台与视觉 E2E | 27 passed，0 failed / skipped / flaky |
| 真实 HTTP Runtime E2E | 1 passed，精确审批、真实 Runner / SQLite / 文件与独立 Acceptance 保留 |
| 独立进程 Runtime 六尺寸 QA | 6 passed，1920×1080、1440×900、1366×768、1280×800、1024×768、390×844 |

浏览器合计 **34 passed**。六尺寸含浅/深色空首页、规划、完整审批参数、执行/验收、失败、UNKNOWN、Provider 历史与移动审查，共 86 张进程 QA 截图；各稳定页面 axe 0 violations，应用 console 0 errors/warnings，外部 requests 0。截图验收等待字体完成，静态 Runtime 审计使用 reduced motion，另有真实键盘/焦点/减少动态效果浏览器回归。Node 的 NO_COLOR/FORCE_COLOR 提示属于测试进程环境，不计为应用 console 记录。

新增回归覆盖：默认 Runtime、不可用服务的简洁首页、按钮/快捷键清空草稿和所有浮层、保留项目/模型/明确 Skill、迟到规划响应与 Provider 错误隔离、中文 IME、Shift+Enter、浏览器前进后退、选择器键盘、closed details 焦点边界与重复审批。待审批全部 steps/arguments 和 Plan digest 直接可见；UNKNOWN、失败、轨迹异常和独立验收不会被折叠掩盖。

前端按既有四路连接预算依次加载本地字体，并按当前主题仅请求对应原始 AXIS 标志；未改变后端并发限制。新对话只保留欢迎语与输入区，历史移入侧栏，审查按需打开。既有三种数据来源继续分开；本轮没有新增多轮聊天、流式回复或附件服务。

Runtime 模型传输仍由私有离线 harness 拦截，本轮不代表真实 Provider / DeepSeek 外网验证，也没有部署或 EXE 交付。测试源码、fixture、审计 JSON、截图和原始参考保留在本地 review_evidence/ui_rebuild 及原测试输出目录，不进入 Git。源码许可与字体 OFL 随实现保留。

## Phase 4 / Step 3 — 历史验证（UI 重构前）

Baseline: `2b74de73150cb6f97db5bf2619ff0be0fa7af6e1`。Tested source: `a28a700b02a3c8d2aeabdf8dd01050ecf596dbba`。最终发布身份以 GitHub main 与本地 publication.json 的独立核验为准。

| 原始记录 | 实际结果 |
|---|---|
| `final-full-py312.txt` | 2566 passed, 14 skipped in 934.33s (0:15:34) |
| `final-safety-process-py312.txt` | 47 passed in 75.02s (0:01:15) |
| `final-safety-process-py313.txt` | 47 passed, 590 warnings in 69.73s (0:01:09) |
| `final-full-py313-filtered.txt` | 2566 passed, 14 skipped in 935.33s (0:15:35) |
| `adversarial-fixes-2.txt` | 46 passed in 61.71s (0:01:01) |
| `service-http-focused.txt` | 39 passed in 18.57s |
| `frontend-unit-final.txt` | Tests  165 passed (165) |
| `browser-runtime-legacy-final.txt` | 1 passed (23.9s) |
| `browser-legacy-workbench.txt` | 25 passed (30.2s) |
| `browser-process-visual.txt` | 6 passed (2.0m) |
| `final-reviewed-source-focused.txt` | 75 passed in 88.15s (0:01:28) |

Typecheck / lint / build 均通过，lint 0 warnings；bundle 344.54 kB / gzip 105.64 kB。npm production audit 0 vulnerabilities。前端实际源与依赖锁已核对。
最终两版完整结果均为 **2566 passed、14 skipped、2580 collected，0 failed / 0 errors**。Python 完整范围是 `tests web_api/tests`，未把 skip 算为 pass。SYSTEMDRIVE 最后修正前，两版完整测试均为 2579 collected /2565 passed/14 skipped；原日志和 XML 独立保留，不代替最终源码复验。
最终完整命令分别为 `python -m pytest -q tests web_api/tests -ra --junitxml=review_evidence/phase4_step3/final-full-py312.xml`，以及 `.git/compat-venv313/Scripts/python.exe -m pytest -q tests web_api/tests -ra -W 'ignore:pathlib.PurePath.is_reserved():DeprecationWarning' --junitxml=review_evidence/phase4_step3/final-full-py313-filtered.xml`。
Python 3.13 focused 最终未过滤结果为47 passed /590 warnings（sandbox394、validators2、skill_planner194）；对应命令只选择 `tests/integration/test_runtime_core_hardening.py web_api/tests/test_runtime_process.py`。此前46 passed/591 warnings（sandbox393、validators2、skill_planner196）的原始记录仍保留，轮询次数可影响警告总数。
本轮第一次 Python 3.13 unfiltered 全量仅保留到 97% 的进度日志，工具 handle 后续不存在，没有 terminal summary / XML；原因未证实，不宣称通过。
为避免已知大量弃用记录影响独立执行，最终完整运行仅通过命令行 `-W 'ignore:pathlib.PurePath.is_reserved():DeprecationWarning'` 过滤这一类告警，配置与测试断言未改；结果单独标识，不能称为无告警的 unfiltered 运行。原始 partial log、此前591条与最终590条focused警告摘要均保留。3.12最终完整日志没有pytest warnings汇总。
Windows 14 skips 为 13 个 symlink 权限 WinError1314 和 1 个 POSIX FIFO；真实 `mklink /J` 与硬链接通过。Linux / Docker daemon 本机不可用，未跑 Linux。Playwright Node `NO_COLOR` / `FORCE_COLOR` 环境警告另列在各原始日志；应用 browser console 0 errors/warnings。


初始Step2全套baseline保留1个oversizedHTTPbody/TCPreset失败，最终boundeddrain+现有HTTP安全门禁回归通过，未删除旧assertion。最终Windowsjunction、credentialenv、boundedoutput、predictablepreflight、durableSQLfailures/approvalraces、11个真实hardexit窗口、HTTPserver存活与serverhardkill/restart均有原始记录。R0–R20 offlineoracles测得duplicateadmittedexecution0、unauthorizedexecution0、restartsourcefactmutation0；不是exactly-once外部效果保证。

Core仅runner/sandbox/tools/validators四个授权冻结例外；SQL001–010、execute_tool_call、Inspector/Checkpoint/Recovery/Skill及历史断言字节不变。新增011只作用WebruntimeDB，未更新依赖。

6尺寸真实截图覆盖idle/planning/approval/executing/completed/failed/interrupted/UNKNOWN/providerhistory/dark/mobile，应用console0、外部requests0、稳定axe0violations。两种旧浏览器回归25+1通过，新进程QA6通过。真实Provider/DeepSeek测试 **LIVE_PROVIDER_VERIFICATION_PENDING**；仅离线wire与官方协议审查，未使用真实key或声称远端成功。

协议、liveopt-in命令及平台限制见[RUNTIME_PROCESS_PROTOCOL.md](RUNTIME_PROCESS_PROTOCOL.md)。审查材料本地保存，不push tests/fixtures/reports/ZIP。Phase4Step4/EXE未开始。

<!-- PHASE4_STEP3_CURRENT_END -->

# Phase 4 / Step 2 验证结果 — 2026-10-13

Baseline Commit: `537f28b7656d0e81fba85b8a853af78b797c8e69`
Tested Source Commit: `ef0523a035de74b20a89528304b4ee37faac025c`
Final remote verification is recorded in the local delivery manifest.
Branch / remote: `main` / `origin` (`https://github.com/startuo/Axis-EVO.git`).

Python 3.12.10 / 3.13.5; SQLite 3.49.1; Node 24.14.0 / npm 11.9.0; Edge 155.0.4283.45.

| Check | Exact final result |
|---|---|
| Core `python -m pytest -q tests` | 2331 passed, 14 skipped in 634.80s (0:10:34); 0 warnings |
| Web `python -m pytest -q web_api/tests -ra` | 188 passed in 20.67s; 0 skipped / warnings |
| Web Python 3.13.5, same command | 188 passed, 478 warnings in 20.76s; 0 skipped |
| Frontend typecheck / lint / build | passed; 0 lint warnings; 338 kB JS, about 104 kB gzip |
| Vitest `npm test` | 9 files / 137 passed; 0 warnings |
| Existing Playwright `npm run test:e2e` | 25 passed (28.6s) |
| Runtime Playwright `npx playwright test --config runtime.playwright.config.ts` | 1 passed (21.8s) |
| Accessibility | existing 9 + runtime 12 states; 0 axe violations |
| Runtime browser console / external requests | 0 errors or warnings / 0 external requests |
| Freeze audit | 131 historical Core/config/test files byte-identical; 001–010 and dependencies unchanged |

3.13's 478 warnings are unsuppressed `PurePath.is_reserved()` deprecations in frozen `skill_planner.py` / `sandbox.py`. Core was fully run on Windows/Python 3.12; no new Linux or Python 3.13 full-Core claim. The 14 Windows skips are 13 unavailable symlink-privilege cases and one POSIX FIFO; fresh exact reasons are in `review_evidence/runtime/platform-skips.txt`. The real Windows junction test passes. Node Playwright emits 3 runner color-environment warnings across the two commands (`NO_COLOR` / `FORCE_COLOR`); these are separate from the observed clean application console.

本轮新增109个后端用例和22个前端用例；真实Runtime浏览器场景另计1项，旧25项保留。完整源码/fixture/日志/报告仅保留本地审查包。当前报告不宣称live provider测试、模型服从、工具因果或OS隔离；运行边界见WORKBENCH_SETUP.md。

---

历史记录：

# Phase 4 / Step 1 验证结果 — 2026-10-13

Baseline: `e8b398aaaa2e2ab8a8fadb246b0f25a07c6e2a03`。
Tested source commit: `1fc2b29d87747fcd63871aac0aec9076e92b65ab`。
测试在对应工作树执行，提交时逐项核对相同 source bytes；其后本次验证文档更新不修改实现。私有 SHA manifest、JUnit/JSON、完整日志及截图随源码审查 ZIP 本地保存。

| 验证 | 实际结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过，0 errors / warnings；公共 checkout 缺少私有 tests 时仍校验 src |
| `npm run build` | 通过；React 19.3.0 / TypeScript 5.9.3 / Vite 8.3.4；Node 24.14.0 / npm 11.9.0 |
| `npm test` | 7 files / **115 passed**，37.01s，0 warnings |
| `npm run test:e2e` | **25 passed**，30.9s，0 skipped / flaky；Windows Edge 155.0.4283.45 |
| axe / 响应式 / 人工截图 | 9 states 0 violations；1920、1440、1366、1280、1024、390px 首页与任务页通过；12 张截图人工复核 |
| `python -m pytest -q web_api/tests -ra --junitxml=web_api/tests/results/backend312.xml` | Python 3.12.10 / SQLite 3.49.1：**79 passed**，4.80s，0 skipped / warnings |
| 同一后端命令，Python 3.13.5 | **79 passed**，4.76s，0 skipped / **199 warnings** |
| `python -m pytest -q -ra --junitxml=review_evidence/workbench/core-regression.xml` | Python 3.12.10 / SQLite 3.49.1：2345 collected，**2331 passed, 14 skipped**，866.63s，0 warnings |
| `npm audit --json` | 当前锁定依赖：0 reported vulnerabilities；不等于完整安全证明 |
| 冻结检查 | **118 / 118** Core / 既有 tests / fixtures 原始 SHA-256 相同；pyproject 与本地 PUBLIC_VERIFICATION_PLAN.md 也未改 |

Playwright 保留 2 条 Node 环境警告：`NO_COLOR` 被 `FORCE_COLOR` 忽略。Python 3.13 后端 199 条均为冻结 `PurePath.is_reserved()` 弃用：`skill_planner.py:121` 157 条、`sandbox.py:166` 42 条，没有过滤。完整 Core 回归的 14 项跳过为 13 项 Windows symlink 权限不可用及 1 项 POSIX FIFO 不可用；没有将 skips 算为 passes。本轮没有重新执行 Python 3.13 全 Core suite，上一阶段记录保持历史身份。

另有独立真实浏览器链路：事先用 `examples/consumer.py` 生成真实 Core/SQLite 运行，再由 production React → loopback GET-only HTTP → Core 读取；Intent、Result、Acceptance PASSED 可见，手工计划批准保持 NOT_RECORDED。数据库 schema/逻辑表及工作区前后 SHA-256 一致。该证据与前端 intercepted-HTTP 测试分开，不声称浏览器执行了工具或调用了模型。

Demo 记录持续标注为预设示例。Connected 不使用 Demo 补齐失败；现场文件内容、需 live filesystem 的高阶检查、真正执行/审批/Provider 测试明确不可用或 UNSUPPORTED。Backend 使用 mode=ro 提交快照、内存 query_only 与 authorizer，无 schema 或事实写入。

发布仅包含授权实现、必要文档、锁文件及本测试结果；私有测试、真实临时数据库、工作区、报告、日志、截图和 review ZIP 不推送。未进入 Phase 4 / Step 2、模型执行或 EXE 打包。启动与完整边界见 [WORKBENCH_SETUP.md](WORKBENCH_SETUP.md)。

---

# Phase 3 / Step 4 验证结果 — 2026-10-12

Baseline / execution-time HEAD: `c9a83b6912f130a2cefe978995ada8cc272da389`。Tested source: `15c7903a1eca8553ef06da45b191a335c93e3ea4`。
测试在包含本轮源文件的working tree执行；每次full记录完整source/test SHA。发布commit及其后documentation-only commit须与这些bytes核对。Production SHA manifest digest: `5fb38711706dbbd2e2dcdaf437d88c5e16ceb0225a5fecfd681a41a4cec684bc`。

| Run | Environment | Collected / passed / failed / skipped | Warnings | Exact pytest summary |
|---|---|---|---:|---|
| focused312 | Python 3.12.10, SQLite 3.49.1 | 291 / 291 / 0 / 0 | 0 | 291 passed in 400.88s (0:06:40) |
| focused313 | Python 3.13.5, SQLite 3.49.1 | 293 / 293 / 0 / 0 | 5067949 | 293 passed, 5067949 warnings in 378.74s (0:06:18) |
| metrics312 | Python 3.12.10, SQLite 3.49.1 | 1 / 1 / 0 / 0 | 0 | 1 passed in 10.44s |
| metrics313 | Python 3.13.5, SQLite 3.49.1 | 1 / 1 / 0 / 0 | 178486 | 1 passed, 178486 warnings in 13.87s |
| full312 | Python 3.12.10, SQLite 3.49.1 | 2345 / 2331 / 0 / 14 | 0 | 2331 passed, 14 skipped in 693.65s (0:11:33) |
| full313 | Python 3.13.5, SQLite 3.49.1 | 2345 / 2331 / 0 / 14 | 5310662 | 2331 passed, 14 skipped, 5310662 warnings in 759.45s (0:12:39) |

Full command: `python -m pytest -q`，分别使用Windows Python3.12.10和3.13.5；SQLite3.49.1、pytest9.1.1。原2051是历史baseline。
报告选项仅`PYTEST_ADDOPTS=-ra --junitxml=...`、`PYTHONIOENCODING=utf-8`，未新增warning filters。3.13 warnings为冻结skill_planner.py:121、sandbox.py:166、validators.py:38的PurePath.is_reserved弃用，实际总数完整保留。
首轮focused312在report字段补充前；其后3inspection tests通过、focused313及两full验证最终source；metric实验两环境各1项通过。

两full均14skip，13项Windows创建symlink缺权限、1项POSIX FIFO不可用；未把skip计pass，无本轮Linux/remote CI结果。
- `tests.integration.test_agent_episode::test_external_seed_symlink_is_rejected_before_episode_persistence`: Creating symlinks requires OS support and Windows symlink privilege
- `tests.integration.test_agent_episode::test_episode_workspace_symlink_redirection_is_rejected_before_dispatch`: Creating symlinks requires OS support and Windows symlink privilege
- `tests.integration.test_runner::test_external_symlink_assertion_preflight_blocks_mutating_plan`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_external_symlink_assertio0\\outside.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_external_symlink_assertio0\\task_assets\\seed\\external_link.txt'
- `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[external_file]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_symlink_capture_rejected_0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_symlink_capture_rejected_0\\work\\link'
- `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[internal_file]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_symlink_capture_rejected_1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_symlink_capture_rejected_1\\work\\link'
- `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[ancestor]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_symlink_capture_rejected_2\\work' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_symlink_capture_rejected_2\\alias'
- `tests.unit.test_checkpoint_manager::test_fifo_rejected_without_blocking`: POSIX FIFO is unavailable on Windows
- `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[target]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_external_symlink_is_not_f0\\outside\\config.json' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_external_symlink_is_not_f0\\workspace\\config.json'
- `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[parent]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_external_symlink_is_not_f1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_external_symlink_is_not_f1\\workspace\\parent'
- `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[root]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_external_symlink_is_not_f2\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_external_symlink_is_not_f2\\workspace'
- `tests.unit.test_sandbox::test_external_symlink_target_is_rejected`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_external_symlink_target_i0\\secret.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_external_symlink_target_i0\\workspace\\link.txt'
- `tests.unit.test_sandbox::test_external_symlink_parent_blocks_existing_and_new_files`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_external_symlink_parent_b0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_external_symlink_parent_b0\\workspace\\link'
- `tests.unit.test_sandbox::test_internal_symlink_is_allowed`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_internal_symlink_is_allow0\\workspace\\target.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_internal_symlink_is_allow0\\workspace\\link.txt'
- `tests.unit.test_sandbox::test_seed_copy_preserves_external_symlink_without_copying_target`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_seed_copy_preserves_exter0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-215\\test_seed_copy_preserves_exter0\\seed\\link'

公开examples/skill_evolution.py两版本均COMPLETED/exact_output=true/direct_promotion_blocked=true/integrity_issues=[]。
新增294cases（实际JUnit按新增module计数），原全部tests/fixtures未改。冻结ledger104项：103unchanged；仅授权SkillManager固定hook18add2del；001–009/其余旧production/pyproject未变。010有12new tables/39new triggers，无旧表新对象。

DemoA完成真实approved v2生产执行；DemoB回归阻断；DemoC四例/UNKNOWN/UNSUPPORTED阻断；DemoD保留CrashB未知且不归因；DemoE显式v2→v1routing。E0 normal control，E1–14真实exit70，E15–17普通race/stale/corruption另标。
Baseline A=真实旧src+caller promotion，B=governed，C=独立naive control；B合格1/1成功，不合格2/2阻断，无把C描述为旧自动行为。
CALLER deterministic revisions/offline plan doubles only，live provider=0、token_usage=null；不证明自主演化或Skill因果改善。受支持API gate不抵抗任意SQLite owner/runtime替换。

全部私有test/fixture/hidden Oracle/raw/report纳入axis-evo-phase3-step4-review.zip，公开仓库不含这些源码。具体重放见docs/SKILL_EVOLUTION.md；原fault harness需要Git clone。保留远端f8a7cf1删除旧PUBLIC_VERIFICATION_PLAN.md的改动。

---

# Phase 3 / Step 2 验证结果

日期2026-10-10；Windows-11-10.0.22631-SP0；Python3.12.10；SQLite3.49.1。
预编辑HEAD `af8c493b7e56a3cf7eb5c9d03f1ba46c8fb01813`。历史基线1569，不冒充本轮结果。

| Command | Actual result |
|---|---|
| python -m pytest -q tests/unit/test_recovery_policy.py | 23 passed in 0.13s |
| python -m pytest -q tests/unit/test_recovery_reconciliation.py | 7 passed in 3.56s |
| python -m pytest -q tests/integration/test_recovery_storage.py | 42 passed in 31.27s |
| python -m pytest -q tests/integration/test_recovery_manager.py | 15 passed in 9.76s |
| python -m pytest -q tests/integration/test_recovery_continuation.py | 24 passed in 19.81s |
| python -m pytest -q tests/integration/test_recovery_crash.py | 22 passed in 20.30s |
| python -m pytest -q tests/experiments/test_recovery_baseline.py | 4 passed in 6.82s |
| python -m pytest -q tests/integration/test_hard_crash.py | 1 passed in 0.41s |
| python -m pytest -q tests/integration/test_inspector_crash.py | 6 passed in 2.13s |
| python -m pytest -q tests/integration/test_skill_guided_crash.py | 5 passed in 1.71s |
| python -m pytest -q tests/integration/test_agent_loop_crash.py | 7 passed in 2.82s |
| python -m pytest -q tests/integration/test_checkpoint_storage.py | 25 passed in 12.91s |
| python -m pytest -q tests/integration/test_checkpoint_consistency.py | 37 passed in 19.79s |
| python -m pytest -q tests/fault_injection/test_fault_matrix.py | 12 passed in 6.03s |
| python -m pytest -q tests/experiments/test_agent_baseline.py | 11 passed in 11.91s |
| python -m pytest -q tests/integration/test_recovery_storage.py | 45 passed in 33.05s |
| python -m pytest -q | 1695 passed, 14 skipped in 228.13s (0:03:48) |

补充专项（同事务publicationtrigger验证与最终assetguard）：python -m pytest -q tests/integration/test_recovery_storage.py → 45 passed in33.05s。
完整收集1709；通过1695；失败0；errors0；skip14；pytest warnings reported=False。
新增140cases。只有Reporting环境PYTEST_ADDOPTS=-ra --junitxml=<local.gitpath>；没有新增warning过滤。
13项Windows symlink privilege限制+1项POSIX FIFO不可用，未把skip记pass。本机未跑Linux。旧PureWindowsPath.is_reserved潜在Linux弃用warning未通过修改冻结文件压制。

## 完整skip

- `tests.integration.test_agent_episode::test_external_seed_symlink_is_rejected_before_episode_persistence`: Creating symlinks requires OS support and Windows symlink privilege
- `tests.integration.test_agent_episode::test_episode_workspace_symlink_redirection_is_rejected_before_dispatch`: Creating symlinks requires OS support and Windows symlink privilege
- `tests.integration.test_runner::test_external_symlink_assertion_preflight_blocks_mutating_plan`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_external_symlink_assertio0\\outside.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_external_symlink_assertio0\\task_assets\\seed\\external_link.txt'
- `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[external_file]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_symlink_capture_rejected_0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_symlink_capture_rejected_0\\work\\link'
- `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[internal_file]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_symlink_capture_rejected_1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_symlink_capture_rejected_1\\work\\link'
- `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[ancestor]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_symlink_capture_rejected_2\\work' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_symlink_capture_rejected_2\\alias'
- `tests.unit.test_checkpoint_manager::test_fifo_rejected_without_blocking`: POSIX FIFO is unavailable on Windows
- `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[target]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_external_symlink_is_not_f0\\outside\\config.json' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_external_symlink_is_not_f0\\workspace\\config.json'
- `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[parent]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_external_symlink_is_not_f1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_external_symlink_is_not_f1\\workspace\\parent'
- `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[root]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_external_symlink_is_not_f2\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_external_symlink_is_not_f2\\workspace'
- `tests.unit.test_sandbox::test_external_symlink_target_is_rejected`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_external_symlink_target_i0\\secret.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_external_symlink_target_i0\\workspace\\link.txt'
- `tests.unit.test_sandbox::test_external_symlink_parent_blocks_existing_and_new_files`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_external_symlink_parent_b0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_external_symlink_parent_b0\\workspace\\link'
- `tests.unit.test_sandbox::test_internal_symlink_is_allowed`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_internal_symlink_is_allow0\\workspace\\target.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_internal_symlink_is_allow0\\workspace\\link.txt'
- `tests.unit.test_sandbox::test_seed_copy_preserves_external_symlink_without_copying_target`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_seed_copy_preserves_exter0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-159\\test_seed_copy_preserves_exter0\\seed\\link'

## 工程证据

77冻结文件SHA完全一致。所有旧关键回归与full通过。新tests覆盖strictfilepolicy、immutableSQL、triggerABORT/IGNORE、COMMITdenial、callerTxn、stale/corruptapproval、concurrency、actualRunner、query_only、R0–R11真实subprocess、AgentEpisode独立lineage、无.git真实运行及父进程bytes/entryledgerOracle。
12sourceexit70、8recoveryexit70；两个可完成场景2/2成功；unsafe_retry/duplicate/source_trace_mutation/approval_bypass/unjustified_completion/Oracle mismatch均0。每个source仍缺1个TOOL_RESULT。
Recovery仅支持受控文件、一个相邻pending写操作exactafter与完整树吻合、非空suffix、显式digest批准；不实现Commerce、Trust或Skill演化。无真实provider测试，无断电实验。
本地全源码审查ZIP包含tests/fixtures/reports；Git仅推送production/config/docs与测试结果，tests/报告/ZIP不上传。

实际ZIP解压至无.git临时目录：python -m pytest -q -p no:cacheprovider tests/experiments/test_recovery_baseline.py::test_recovery_baseline_completes_only_approved_verified_suffix tests/experiments/test_recovery_baseline.py::test_recovery_experiment_runs_from_source_copy_without_git_metadata → 2 passed in 3.07s

---

## 历史验证记录

# Phase 3 / Step 1 验证结果

日期：2026-10-09；Windows-11-10.0.22631-SP0；Python 3.12.10；SQLite 3.49.1。
预编辑 HEAD：`5ce6cb7bd6419d568ba6bbd1f72a25d309b6e4d1`。此前 1456 passed / 10 skipped / 1466 collected 是历史基线。

| Command | Actual result |
|---|---|
| python -m pytest -q tests/unit/test_checkpoint_manager.py | 25 passed, 4 skipped in 0.47s |
| python -m pytest -q tests/integration/test_checkpoint_storage.py | 25 passed in 10.90s |
| python -m pytest -q tests/integration/test_checkpoint_consistency.py | 37 passed in 15.87s |
| python -m pytest -q tests/fault_injection/test_fault_matrix.py | 12 passed in 6.81s |
| python -m pytest -q tests/integration/test_hard_crash.py | 1 passed in 0.28s |
| python -m pytest -q tests/integration/test_inspector_crash.py | 6 passed in 1.83s |
| python -m pytest -q tests/integration/test_skill_binding_crash.py | 2 passed in 0.54s |
| python -m pytest -q tests/integration/test_skill_guided_crash.py | 5 passed in 1.60s |
| python -m pytest -q tests/integration/test_agent_loop_crash.py | 7 passed in 2.49s |
| python -m pytest -q tests/experiments/test_agent_baseline.py | 11 passed in 8.83s |
| python -m pytest -q | 1555 passed, 14 skipped in 112.11s (0:01:52) |

完整收集 1569；通过 1555；失败 0；错误 0；跳过 14。
pytest 未报告 warnings，未新增过滤器。命令保持 `python -m pytest -q`；为收集审计结果，仅通过
`PYTEST_ADDOPTS=-ra --junitxml=<local .git path>` 启用 skip 明细和本地 JUnit 输出。

新增 103 cases；99 passed / 4 skipped。13 项 symlink skip 均为 Windows WinError 1314；1 项为 Windows 无 POSIX FIFO。
Windows junction 三项实际运行通过，不计入 symlink skip。未在本轮运行 Linux，不能把 Windows skip 记作 Linux pass。

## 完整 skip 明细

- `tests.integration.test_agent_episode::test_external_seed_symlink_is_rejected_before_episode_persistence`: Creating symlinks requires OS support and Windows symlink privilege
- `tests.integration.test_agent_episode::test_episode_workspace_symlink_redirection_is_rejected_before_dispatch`: Creating symlinks requires OS support and Windows symlink privilege
- `tests.integration.test_runner::test_external_symlink_assertion_preflight_blocks_mutating_plan`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_assertio0\\outside.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_assertio0\\task_assets\\seed\\external_link.txt'
- `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[external_file]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_symlink_capture_rejected_0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_symlink_capture_rejected_0\\work\\link'
- `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[internal_file]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_symlink_capture_rejected_1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_symlink_capture_rejected_1\\work\\link'
- `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[ancestor]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_symlink_capture_rejected_2\\work' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_symlink_capture_rejected_2\\alias'
- `tests.unit.test_checkpoint_manager::test_fifo_rejected_without_blocking`: POSIX FIFO is unavailable on Windows
- `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[target]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_is_not_f0\\outside\\config.json' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_is_not_f0\\workspace\\config.json'
- `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[parent]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_is_not_f1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_is_not_f1\\workspace\\parent'
- `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[root]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_is_not_f2\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_is_not_f2\\workspace'
- `tests.unit.test_sandbox::test_external_symlink_target_is_rejected`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_target_i0\\secret.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_target_i0\\workspace\\link.txt'
- `tests.unit.test_sandbox::test_external_symlink_parent_blocks_existing_and_new_files`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_parent_b0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_external_symlink_parent_b0\\workspace\\link'
- `tests.unit.test_sandbox::test_internal_symlink_is_allowed`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_internal_symlink_is_allow0\\workspace\\target.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_internal_symlink_is_allow0\\workspace\\link.txt'
- `tests.unit.test_sandbox::test_seed_copy_preserves_external_symlink_without_copying_target`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_seed_copy_preserves_exter0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-136\\test_seed_copy_preserves_exter0\\seed\\link'

## 故障与冻结审计

独立 F0–F9 实验：7 个真实 exit70，3 个正常 exit0；F6 无已提交 checkpoint，F7 提交的 checkpoint 存活。
Crash B：先保存 Step1 checkpoint(cursor8, timeout15)，Step2 实际变为20，缺 TOOL_RESULT / STEP_CONFIRMED，
Run 保持 RUNNING / ended_at NULL；Inspector 为 UNFINISHED_RUN / EXECUTION_RESULT_UNKNOWN / EXTERNAL_STATE_CHANGED。
无 restore/retry/resume/Recovery。父进程直接读取 bytes；test-only ledger 只记录 execute 入口。
损坏检测样本 1/1；未知结果样本 2/2；oracle mismatch、错误确认和额外调用案例均0。这些是有限 fixture 的检出比例，不是普遍正确率。

66 个冻结 production/test/fixture、pyproject.toml 及5个已存在生成 metadata：72项 SHA256 全一致。
新模块与006显式启用；Runner、Tools、Inspector、001–005以及旧测试未改，依赖未改。
所有测试 offline；未运行真实模型 provider smoke test。检查只读允许 SQLite 内部 WAL/SHM 协调，不使用 immutable=1。

## 历史 Phase 2 / Step 4 记录

### Phase 2 / Step 4 验证结果

验证日期：2026-10-09。Windows；Python 3.12.10；SQLite 3.49.1。
预编辑 HEAD：7ae0e88681ce9d5cffa02359626736e52281b722。此前 Step3 记录为1204 passed / 8 skipped / 1212 collected；这不是本轮新结果。

| Command | Actual result |
| --- | --- |
| python -m pytest -q tests/unit/test_agent_feedback.py | 45 passed in 4.96s |
| python -m pytest -q tests/unit/test_agent_loop.py | 50 passed in 4.86s |
| python -m pytest -q tests/integration/test_agent_episode.py | 139 passed, 2 skipped in 21.23s |
| python -m pytest -q tests/integration/test_agent_loop_crash.py | 7 passed in 2.94s |
| python -m pytest -q tests/experiments/test_agent_baseline.py | 11 passed in 9.44s |
| python -m pytest -q tests/unit/test_skill_planner.py | 97 passed in 5.36s |
| python -m pytest -q tests/unit/test_planning_adapter.py | 152 passed in 0.26s |
| python -m pytest -q tests/integration/test_planning_provenance.py | 81 passed in 5.35s |
| python -m pytest -q tests/integration/test_skill_guided_run.py | 21 passed in 2.38s |
| python -m pytest -q tests/integration/test_skill_guided_crash.py | 5 passed in 1.85s |
| python -m pytest -q tests/integration/test_runner.py | 82 passed, 1 skipped in 5.63s |
| python -m pytest -q tests/integration/test_skill_aware_runner.py | 30 passed in 2.62s |
| python -m pytest -q tests/integration/test_skill_binding_crash.py | 2 passed in 0.60s |
| python -m pytest -q tests/integration/test_inspector_crash.py | 6 passed in 2.18s |
| python -m pytest -q | 1456 passed, 10 skipped in 90.64s (0:01:30) |

完整收集 1466；通过 1456；失败 0；错误 0；跳过 10；pytest未报告warnings。
相比1212项旧测试，新增254项，其中252通过、2项symlink skip，未弱化旧测试。
各次命令用PYTEST_ADDOPTS添加JUnit输出至.git/phase2-step4-tests-*.xml，未改变测试选择或skip。
最后一次验证期间生产与测试快照未变；最终完整结果针对当前所有源码与测试。

新证据：真实SQLite/Runner/Acceptance、模型调用前allocation COMMIT、v2 exact request和v1 saved golden、
exact approval/一次性dispatch、fresh原seed、反馈完整性、SQL ABORT/IGNORE/COMMIT失败、并发预算、
BLOB/manifest腐败、query_only、7个真实hard-exit边界、独立oracle七案例。
新测试分布为45 feedback、50 Agent API、141 Episode（139 passed/2 skipped）、7 crash、11 baseline。
旧frozen快照54项：52项byte-identical，仅2个授权Step3模块有additive v2变更；Runner、001–004、依赖和30个旧test/fixture unchanged。

精确skip nodeid与原因（不算通过）：

- tests.integration.test_agent_episode::test_external_seed_symlink_is_rejected_before_episode_persistence: Creating symlinks requires OS support and Windows symlink privilege
- tests.integration.test_agent_episode::test_episode_workspace_symlink_redirection_is_rejected_before_dispatch: Creating symlinks requires OS support and Windows symlink privilege
- tests.integration.test_runner::test_external_symlink_assertion_preflight_blocks_mutating_plan: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_assertio0\\outside.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_assertio0\\task_assets\\seed\\external_link.txt'
- tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[target]: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_is_not_f0\\outside\\config.json' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_is_not_f0\\workspace\\config.json'
- tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[parent]: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_is_not_f1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_is_not_f1\\workspace\\parent'
- tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[root]: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_is_not_f2\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_is_not_f2\\workspace'
- tests.unit.test_sandbox::test_external_symlink_target_is_rejected: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_target_i0\\secret.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_target_i0\\workspace\\link.txt'
- tests.unit.test_sandbox::test_external_symlink_parent_blocks_existing_and_new_files: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_parent_b0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_external_symlink_parent_b0\\workspace\\link'
- tests.unit.test_sandbox::test_internal_symlink_is_allowed: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_internal_symlink_is_allow0\\workspace\\target.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_internal_symlink_is_allow0\\workspace\\link.txt'
- tests.unit.test_sandbox::test_seed_copy_preserves_external_symlink_without_copying_target: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_seed_copy_preserves_exter0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-115\\test_seed_copy_preserves_exter0\\seed\\link'

默认测试全部离线；真实provider smoke未运行，Linux与断电实验未运行。没有Recovery/Checkpoint/TrustEvaluator/自动Skill演化。
本地完整审查证据包括PHASE2_STEP4_DELIVERY_REPORT.md、AGENT_BASELINE_REPORT.md、axis-evo-phase2-step4-review.zip。
Git只提交实现/必要配置README/本测试结果，不提交tests、fixture、报告或ZIP。

---

以下保留此前历史验证记录，非本轮结果：

# Phase 2 / Step 3 验证结果

验证日期：2026-10-09。Windows；Python 3.12.10；SQLite 3.49.1。
实际baseline 49d408c2e40771751fc23401b7f475f46280e16d，预编辑848 passed / 8 skipped / 856 collected。

| Command | Actual result |
| --- | --- |
| python -m pytest -q tests/unit/test_skill_planner.py | 97 passed in 5.94s |
| python -m pytest -q tests/unit/test_planning_adapter.py | 152 passed in 0.28s |
| python -m pytest -q tests/integration/test_planning_provenance.py | 81 passed in 6.43s |
| python -m pytest -q tests/integration/test_skill_guided_run.py | 21 passed in 2.79s |
| python -m pytest -q tests/integration/test_skill_guided_crash.py | 5 passed in 1.86s |
| python -m pytest -q tests/integration/test_runner.py | 82 passed, 1 skipped in 5.88s |
| python -m pytest -q tests/integration/test_skill_aware_runner.py | 30 passed in 3.23s |
| python -m pytest -q tests/integration/test_skill_binding_crash.py | 2 passed in 0.90s |
| python -m pytest -q tests/integration/test_skill_manager.py | 98 passed in 3.21s |
| python -m pytest -q tests/integration/test_inspector_crash.py | 6 passed in 2.68s |
| python -m pytest -q | 1204 passed, 8 skipped in 49.45s |

full collected 1212；失败0，错误0；pytest未报告warnings。新增356项通过，无新增skip。
JUnit：.git/phase2-step3-tests-*.xml，不改变测试选择或skip；默认全离线。README独立demo实测COMPLETED True。

8项历史skip精确原因：

- tests/integration/test_runner.py::test_external_symlink_assertion_preflight_blocks_mutating_plan: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_assertio0\\outside.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_assertio0\\task_assets\\seed\\external_link.txt'
- tests/unit/test_inspector.py::test_external_symlink_is_not_followed_for_comparison[target]: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_is_not_f0\\outside\\config.json' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_is_not_f0\\workspace\\config.json'
- tests/unit/test_inspector.py::test_external_symlink_is_not_followed_for_comparison[parent]: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_is_not_f1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_is_not_f1\\workspace\\parent'
- tests/unit/test_inspector.py::test_external_symlink_is_not_followed_for_comparison[root]: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_is_not_f2\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_is_not_f2\\workspace'
- tests/unit/test_sandbox.py::test_external_symlink_target_is_rejected: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_target_i0\\secret.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_target_i0\\workspace\\link.txt'
- tests/unit/test_sandbox.py::test_external_symlink_parent_blocks_existing_and_new_files: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_parent_b0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_external_symlink_parent_b0\\workspace\\link'
- tests/unit/test_sandbox.py::test_internal_symlink_is_allowed: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_internal_symlink_is_allow0\\workspace\\target.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_internal_symlink_is_allow0\\workspace\\link.txt'
- tests/unit/test_sandbox.py::test_seed_copy_preserves_external_symlink_without_copying_target: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_seed_copy_preserves_exter0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-80\\test_seed_copy_preserves_exter0\\seed\\link'

新增证据：actualrequest字节、严格Plan/limits/权限、无审批零Run/workspace、exacthash、Task变更、
proposal/cross-field/Skill损坏、SQL不可变性、TEMPshadow、真实ABORT/IGNORE/COMMIT失败、并发单消费、
query_only只读、legacy无需004、真实hard-exit/CrashB。CrashB保留proposal/link/Skillbinding及原UNKNOWN/CHANGED边界。

50项预编辑快照中仅runner.py改变，其余49项字节相同：18个冻结生产/SQL文件、25个旧测试/fixture、pyproject.toml；另5个既有egg-info元数据也一致，但不进入ZIP。
未运行真实provider、Linux或断电实验。没有Recovery/Checkpoint/TrustEvaluator/自动Skill演化或下一里程碑。
完整本地证据见axis-evo-phase2-step3-review.zip；Git仅实现/必要文档/本测试结果，无tests/fixtures/报告/ZIP。

---

以下保留此前Phase2Step2历史记录，非本轮结果：

# Phase 2 / Step 2 验证结果

验证日期：2026-10-08。Windows；Python 3.12.10；SQLite 3.49.1。
基线提交：`46cce8d5b45cc20b99336708180f395e1f96fa1e`。

| 命令 | 最新结果 |
| --- | --- |
| `python -m pytest -q tests/unit/test_skill_binding.py` | 144 passed in 6.31s |
| `python -m pytest -q tests/integration/test_skill_aware_runner.py` | 30 passed in 2.70s |
| `python -m pytest -q tests/integration/test_skill_binding_crash.py` | 2 passed in 0.70s |
| `python -m pytest -q tests/integration/test_runner.py` | 82 passed, 1 skipped in 6.35s |
| `python -m pytest -q tests/integration/test_inspector_crash.py` | 6 passed in 2.23s |
| `python -m pytest -q tests/integration/test_skill_manager.py` | 98 passed in 3.49s |
| `python -m pytest -q` | **848 passed, 8 skipped in 39.63s** |

完整回归收集 856 项；失败 0，错误 0，pytest 未报告 warnings。
完整测试使用 `PYTEST_ADDOPTS=--junitxml=.git/phase2-step2-pytest.xml` 保存本地结果，未改变测试选择或跳过规则。
相比基线 672 passed / 8 skipped，新增 176 项全部通过，无新增 skip。

8 项历史 skip 均因 Windows `WinError 1314`，当前进程无创建 symlink 所需权限：

- `tests/integration/test_runner.py::test_external_symlink_assertion_preflight_blocks_mutating_plan`
- `tests/unit/test_inspector.py::test_external_symlink_is_not_followed_for_comparison[target]`
- `tests/unit/test_inspector.py::test_external_symlink_is_not_followed_for_comparison[parent]`
- `tests/unit/test_inspector.py::test_external_symlink_is_not_followed_for_comparison[root]`
- `tests/unit/test_sandbox.py::test_external_symlink_target_is_rejected`
- `tests/unit/test_sandbox.py::test_external_symlink_parent_blocks_existing_and_new_files`
- `tests/unit/test_sandbox.py::test_internal_symlink_is_allowed`
- `tests/unit/test_sandbox.py::test_seed_copy_preserves_external_symlink_without_copying_target`

验证覆盖真实 SQLite SQL 拒绝、IGNORE/REPLACE、事务内复验、第二连接可见性、并发冲突、
真实 deferred-FK COMMIT 失败回滚、Card/历史/来源损坏、TEMP 同名事实遮蔽，以及两个 subprocess hard-exit 边界。
新绑定在 `STEP_PLANNED` 前提交；外部工具执行无外层 SQLite transaction；Crash Window B 保留。
既有 Runner 和 Inspector 崩溃回归继续通过，不增加工具执行或 Skill 归因结论。

冻结审计：40 项基线哈希中，仅授权的 `runner.py` 改变；其余 16 个旧生产文件、22 个旧测试/fixture、
`pyproject.toml` 均字节一致。迁移 001/002、storage/tools/sandbox/Inspector、Skill Registry 与依赖配置未改。
E/F/G 只读复审完成；发现的 TEMP namespace 问题已在新模块修复并独立复现验证关闭。

本记录针对**本地完整源码审查包**。按用户规则，Git 只上传实现、必要文档及测试结果；
全部测试源码、fixture 和交付报告已移出 Git 跟踪，本地原文件与审查包保留。
完整内容位于 `axis-evo-phase2-step2-review.zip`。远端不含项目自测源码，单独克隆远端无法复现上述测试数量。

以上证据验证进程硬退出后的提交持久性，未开展断电或硬件故障实验。
未开始 Phase 2 / Step 3、Recovery、Checkpoint、Trust Evaluator 或真实模型循环。

2026-10-08 仓库结构整理：仅更新发布文件布局与说明，生产源码、SQL、依赖、测试/fixture 原文件均未修改。
完整 pytest 结果沿用上述实现验证，本次未重复运行全量测试。
README legacy 与 Skill-bound 示例在独立临时目录运行均为 COMPLETED，Inspector trace 一致；绑定示例的 Skill trace 也一致。
56 个本地保留文件（源码、SQL、测试/fixture、报告、封面和审查包）哈希核对通过；Git 清理清单与文档链接检查通过。


---

## Phase 3 / Step 3 - verified 2026-10-10

Tested implementation commit: `406a0db1af87c48f3a696cfcda17fa9b3ead7467`. Baseline: `7e609764e34de2d002f5e0de8a499615ebe1a4df`. The following documentation-only commit retains identical production and test bytes.

Environment: Windows 11 build 22631; Python 3.12.10; SQLite 3.49.1; pytest 9.1.1.

| Command | Actual result |
| --- | --- |
| `python -m pytest -q tests/integration/test_safety_hardening.py` | 27 passed in 4.89s |
| `python -m pytest -q tests/integration/test_storage.py tests/integration/test_tool_execution.py tests/integration/test_hard_crash.py tests/integration/test_inspector_crash.py tests/integration/test_skill_guided_crash.py tests/integration/test_skill_binding_crash.py tests/integration/test_checkpoint_consistency.py tests/integration/test_recovery_crash.py tests/integration/test_agent_loop_crash.py` | 135 passed in 164.88s (0:02:44) |
| `python -m pytest -q` | 1722 passed, 14 skipped in 808.56s (0:13:28) |
| `python -m pytest -q tests/unit/test_skill_trust.py` | 136 passed in 7.42s |
| `python -m pytest -q tests/integration/test_skill_trust_storage.py` | 123 passed in 17.20s |
| `python -m pytest -q tests/integration/test_skill_trust_crash.py` | 10 passed in 7.66s |
| `python -m pytest -q` | 1991 passed, 14 skipped in 397.47s (0:06:37) |

Final collection: **2005 tests; 1991 passed; 14 skipped; 0 failures; 0 errors**. No warnings summary was reported and no warning filters were introduced. The test runner only added `-ra` and JUnit output reporting to `PYTEST_ADDOPTS`; all cases were selected.

The 14 final skips (13 Windows symlink privilege limitations and one unavailable POSIX FIFO):

- `tests.integration.test_agent_episode::test_external_seed_symlink_is_rejected_before_episode_persistence`: Windows symlink privilege unavailable (WinError 1314 / OS privilege check).
- `tests.integration.test_agent_episode::test_episode_workspace_symlink_redirection_is_rejected_before_dispatch`: Windows symlink privilege unavailable (WinError 1314 / OS privilege check).
- `tests.integration.test_runner::test_external_symlink_assertion_preflight_blocks_mutating_plan`: Windows symlink privilege unavailable (WinError 1314 / OS privilege check).
- `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[external_file]`: Windows symlink privilege unavailable (WinError 1314 / OS privilege check).
- `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[internal_file]`: Windows symlink privilege unavailable (WinError 1314 / OS privilege check).
- `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[ancestor]`: Windows symlink privilege unavailable (WinError 1314 / OS privilege check).
- `tests.unit.test_checkpoint_manager::test_fifo_rejected_without_blocking`: POSIX FIFO unavailable on Windows.
- `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[target]`: Windows symlink privilege unavailable (WinError 1314 / OS privilege check).
- `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[parent]`: Windows symlink privilege unavailable (WinError 1314 / OS privilege check).
- `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[root]`: Windows symlink privilege unavailable (WinError 1314 / OS privilege check).
- `tests.unit.test_sandbox::test_external_symlink_target_is_rejected`: Windows symlink privilege unavailable (WinError 1314 / OS privilege check).
- `tests.unit.test_sandbox::test_external_symlink_parent_blocks_existing_and_new_files`: Windows symlink privilege unavailable (WinError 1314 / OS privilege check).
- `tests.unit.test_sandbox::test_internal_symlink_is_allowed`: Windows symlink privilege unavailable (WinError 1314 / OS privilege check).
- `tests.unit.test_sandbox::test_seed_copy_preserves_external_symlink_without_copying_target`: Windows symlink privilege unavailable (WinError 1314 / OS privilege check).

The private archive preserves the raw log/XML messages, including original console-encoding artifacts. PureWindowsPath.is_reserved() deprecation/compatibility debt on later Python versions was not hidden. This environment did not provide fresh Linux or live-provider testing.

Frozen audit: 90 baseline files, 87 unchanged; only sandbox.py, storage.py and tools.py changed under the explicit Gate A safety exception. Migrations 001-007 and every old test/fixture remain byte-identical. Gate B changed none of the Gate A frozen source. Current production manifest SHA-256: `a4fa83903168dfcedf24b8b2eab52e0df4a7f5ae29ea658f2b38342454fb3886`.

Security evidence: baseline hard-link escape and duplicate invocation reproduced; patched hard-link access rejected, concurrent coordinator admits one actual execution without loser PRE pollution; all 120 final Windows cold connections succeeded with WAL/FULL/FK and restored busy_timeout. 008 audits legacy duplicate facts without rewriting them or adding an incompatible index. Tool execution remains outside SQLite write transactions.

Trust evidence: actual subprocess hard exits before/after Intent, Result and Assessment COMMIT; real Crash B Source stays UNKNOWN after successful Recovery Child. Offline paired inventory Oracle: 4 eligible cases, 3 regressions, 0 improvements, 1 tie, 8/8 valid plans, 5/8 Oracle/public-acceptance successes. Latest isolated experiment batch: 24 actual offline adapter calls; token usage null. Deterministic Tool failure is an explicit injected failure, not a causal Skill defect.

The new public consumer ran both COMPLETED and FAILED cases through real Runner/SQLite, with consistent Inspector traces. Full tests, fixtures, hidden Oracles, raw fault evidence, reports and ZIP remain private under AGENTS.md. See PUBLIC_VERIFICATION_PLAN.md for public commands and authorized private reproduction, including the historical harness Git-metadata prerequisite. No CI workflow, license selection, lifecycle automation or Phase 3 / Step 4 work was added.

## Phase 3 / Step 3 compatibility correction — 2026-10-12

This is a compatibility correction, not a new milestone. User baseline: `9dd4c2284aa3595ded7dc7dd388b5991045665aa`. Owner documentation commit `d99d796d71288e435a70ba745447fe091a936258` was preserved. Tests ran in that HEAD's working tree with the one source correction below; the tested production bytes are now exactly committed as `4b2f516405e2d2d7ee2613758f43f41475eb9c33`. Raw crash ledgers truthfully retain the execution-time HEAD; later documentation-only commits do not change source or test bytes.

The original Python3.13.5 ten failures were reproduced before editing using an isolated actual Windows Python3.13.5 runtime. The user's Linux3.13.5 result (1990 passed/10 failed/5 skipped) is independent external evidence, not a locally repeated Linux run. Both local versions used Windows11 build22631, SQLite3.49.1 and pytest9.1.1.

| Python / phase | Command | Actual result |
| --- | --- | --- |
| 3.13.5 / before313 | `python -m pytest -q tests/unit/test_skill_trust.py` | 10 failed, 126 passed, 9050 warnings in 8.96s |
| 3.12.10 / targeted312-final | `python -m pytest -q tests/unit/test_skill_trust.py tests/unit/test_shadow_path_compatibility.py` | 182 passed in 8.13s |
| 3.13.5 / targeted313-final | `python -m pytest -q tests/unit/test_skill_trust.py tests/unit/test_shadow_path_compatibility.py` | 182 passed, 9180 warnings in 7.95s |
| 3.12.10 / full312 | `python -m pytest -q` | 2037 passed, 14 skipped in 322.71s (0:05:22) |
| 3.13.5 / full313 | `python -m pytest -q` | 2037 passed, 14 skipped, 73562 warnings in 287.97s (0:04:47) |

All 2005 original cases plus 46 new cases were collected in each final full run. Existing test source and assertions were unchanged. New private cases cover exact original Plan bytes/arguments/hash, nonportable aliases, invalid mixed-step Plans, unauthorized tools, traversal/absolute/drive/stream/device/NUL paths, malformed JSON, schema and original byte limits. Complete logs/XML/JSON, including the first new adversarial failure and subsequent passing reruns, remain in the private review package.

### Root cause and exact correction

The Shadow boundary invoked frozen production `_validated_plan()` before its own portable-path classification. This implicitly relied on Python3.12 `PureWindowsPath.is_reserved()` behavior. Python3.13 broadened reserved-name checks, so an ordinary `ValueError` was caught as `PLANNING_INVALID` before Shadow could emit `SimulationUnsupported` / `UNSUPPORTED`. The original validation matrix exercised Python3.12 only; disclosing deprecation debt did not verify cross-version behavior. This was our boundary-ordering and compatibility-coverage omission. The failing cases remained fail-closed; they did not establish unsafe execution.

Only `src/axis_evo/shadow_evaluation.py` changed in production. It now uses a detached validation-only filename spelling to isolate nonportable simulation forms from version-dependent reserved-name checks. That spelling preserves UTF-8 length and retains separators, traversal, drive, stream and device rejection. The frozen validator still validates the entire Plan, exact schema, all tool permissions and arguments, and limits before any `UNSUPPORTED` result. Original canonical Plan bytes/digest and original arguments are retained; the validation spelling is never persisted or executed. Ambiguous space-suffixed `..` segments are additionally conservatively rejected inside Shadow, without claiming a demonstrated host escape.

Frozen production planning validation was not weakened. Malformed/unauthorized/unsafe/oversized Plans remain `PLANNING_INVALID`; unsupported simulation does not grant execution authorization. No Runner, SkillManager, historical migration, schema, dependency, observation, transaction or Crash Window B behavior changed. No automatic state transition, new Recovery or Step4 work was added.

Python3.13 behavior reference: [official pathlib documentation](https://docs.python.org/3.13/library/pathlib.html#pathlib.PurePath.is_reserved).

### Warnings, skips and runtime limits

- before313: 9050 warnings. F:\嵌入式开发\毕设\axis-evo\src\axis_evo\skill_planner.py:121: DeprecationWarning: pathlib.PurePath.is_reserved() is deprecated and scheduled for removal in Python 3.15. Use os.path.isreserved() to detect reserved paths on Windows.
- targeted312-final: 0 warnings. No pytest warning summary.
- targeted313-final: 9180 warnings. F:\嵌入式开发\毕设\axis-evo\src\axis_evo\skill_planner.py:121: DeprecationWarning: pathlib.PurePath.is_reserved() is deprecated and scheduled for removal in Python 3.15. Use os.path.isreserved() to detect reserved paths on Windows.
- full312: 0 warnings. No pytest warning summary.
- full313: 73562 warnings. F:\嵌入式开发\毕设\axis-evo\src\axis_evo\sandbox.py:166: DeprecationWarning: pathlib.PurePath.is_reserved() is deprecated and scheduled for removal in Python 3.15. Use os.path.isreserved() to detect reserved paths on Windows.; F:\嵌入式开发\毕设\axis-evo\src\axis_evo\skill_planner.py:121: DeprecationWarning: pathlib.PurePath.is_reserved() is deprecated and scheduled for removal in Python 3.15. Use os.path.isreserved() to detect reserved paths on Windows.; F:\嵌入式开发\毕设\axis-evo\src\axis_evo\validators.py:38: DeprecationWarning: pathlib.PurePath.is_reserved() is deprecated and scheduled for removal in Python 3.15. Use os.path.isreserved() to detect reserved paths on Windows.

No warning filters were added. Python3.13 warnings remain from frozen `skill_planner.py:121`, `sandbox.py:166` and `validators.py:38` `PureWindowsPath.is_reserved()` callers as actually listed above. This deprecated API is scheduled for removal in3.15; replacing frozen callers is outside this correction. Full raw warning counts/messages/locations are retained. Isolated3.13 runtime installation emitted one cross-filesystem hardlink-to-copy fallback warning; no project dependency change, global PATH change or registry registration occurred.

- Python 3.12.10 `tests.integration.test_agent_episode::test_external_seed_symlink_is_rejected_before_episode_persistence`: Creating symlinks requires OS support and Windows symlink privilege
- Python 3.12.10 `tests.integration.test_agent_episode::test_episode_workspace_symlink_redirection_is_rejected_before_dispatch`: Creating symlinks requires OS support and Windows symlink privilege
- Python 3.12.10 `tests.integration.test_runner::test_external_symlink_assertion_preflight_blocks_mutating_plan`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_assertio0\\outside.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_assertio0\\task_assets\\seed\\external_link.txt'
- Python 3.12.10 `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[external_file]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_symlink_capture_rejected_0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_symlink_capture_rejected_0\\work\\link'
- Python 3.12.10 `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[internal_file]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_symlink_capture_rejected_1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_symlink_capture_rejected_1\\work\\link'
- Python 3.12.10 `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[ancestor]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_symlink_capture_rejected_2\\work' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_symlink_capture_rejected_2\\alias'
- Python 3.12.10 `tests.unit.test_checkpoint_manager::test_fifo_rejected_without_blocking`: POSIX FIFO is unavailable on Windows
- Python 3.12.10 `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[target]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_is_not_f0\\outside\\config.json' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_is_not_f0\\workspace\\config.json'
- Python 3.12.10 `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[parent]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_is_not_f1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_is_not_f1\\workspace\\parent'
- Python 3.12.10 `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[root]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_is_not_f2\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_is_not_f2\\workspace'
- Python 3.12.10 `tests.unit.test_sandbox::test_external_symlink_target_is_rejected`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_target_i0\\secret.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_target_i0\\workspace\\link.txt'
- Python 3.12.10 `tests.unit.test_sandbox::test_external_symlink_parent_blocks_existing_and_new_files`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_parent_b0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_external_symlink_parent_b0\\workspace\\link'
- Python 3.12.10 `tests.unit.test_sandbox::test_internal_symlink_is_allowed`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_internal_symlink_is_allow0\\workspace\\target.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_internal_symlink_is_allow0\\workspace\\link.txt'
- Python 3.12.10 `tests.unit.test_sandbox::test_seed_copy_preserves_external_symlink_without_copying_target`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_seed_copy_preserves_exter0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-196\\test_seed_copy_preserves_exter0\\seed\\link'
- Python 3.13.5 `tests.integration.test_agent_episode::test_external_seed_symlink_is_rejected_before_episode_persistence`: Creating symlinks requires OS support and Windows symlink privilege
- Python 3.13.5 `tests.integration.test_agent_episode::test_episode_workspace_symlink_redirection_is_rejected_before_dispatch`: Creating symlinks requires OS support and Windows symlink privilege
- Python 3.13.5 `tests.integration.test_runner::test_external_symlink_assertion_preflight_blocks_mutating_plan`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_assertio0\\outside.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_assertio0\\task_assets\\seed\\external_link.txt'
- Python 3.13.5 `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[external_file]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_symlink_capture_rejected_0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_symlink_capture_rejected_0\\work\\link'
- Python 3.13.5 `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[internal_file]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_symlink_capture_rejected_1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_symlink_capture_rejected_1\\work\\link'
- Python 3.13.5 `tests.unit.test_checkpoint_manager::test_symlink_capture_rejected[ancestor]`: Symlink creation unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_symlink_capture_rejected_2\\work' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_symlink_capture_rejected_2\\alias'
- Python 3.13.5 `tests.unit.test_checkpoint_manager::test_fifo_rejected_without_blocking`: POSIX FIFO is unavailable on Windows
- Python 3.13.5 `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[target]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_is_not_f0\\outside\\config.json' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_is_not_f0\\workspace\\config.json'
- Python 3.13.5 `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[parent]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_is_not_f1\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_is_not_f1\\workspace\\parent'
- Python 3.13.5 `tests.unit.test_inspector::test_external_symlink_is_not_followed_for_comparison[root]`: OS symlink privilege unavailable: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_is_not_f2\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_is_not_f2\\workspace'
- Python 3.13.5 `tests.unit.test_sandbox::test_external_symlink_target_is_rejected`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_target_i0\\secret.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_target_i0\\workspace\\link.txt'
- Python 3.13.5 `tests.unit.test_sandbox::test_external_symlink_parent_blocks_existing_and_new_files`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_parent_b0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_external_symlink_parent_b0\\workspace\\link'
- Python 3.13.5 `tests.unit.test_sandbox::test_internal_symlink_is_allowed`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_internal_symlink_is_allow0\\workspace\\target.txt' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_internal_symlink_is_allow0\\workspace\\link.txt'
- Python 3.13.5 `tests.unit.test_sandbox::test_seed_copy_preserves_external_symlink_without_copying_target`: OS cannot create the symlink required by this subcase: [WinError 1314] 客户端没有所需的特权。: 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_seed_copy_preserves_exter0\\outside' -> 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\pytest-of-lenovo\\pytest-197\\test_seed_copy_preserves_exter0\\seed\\link'

The final local skips are 13 Windows symlink privilege cases and one POSIX FIFO case per runtime. No skip is reported as passed. No fresh Linux or live-provider run was performed; model adapter tests remain offline.

### Freeze and publication evidence

Compatibility baseline inventory: 102 existing production/test/fixture files; 101 unchanged; only Shadow changed. New test file: `tests/unit/test_shadow_path_compatibility.py` (46 cases, private).

- Shadow before SHA-256: `239102e68b23fd317d6a1fa8fcb67493f86c6ed1ffdc9089f3a92aa5593c43f9`.
- Shadow after SHA-256: `02f39e8539142ece2586bab5b5b4e141e83580d1242e0d8f5dc4c7e7304fa7f1`.
- Current production manifest SHA-256: `5e2bd3d3221e2d45b8e4f2d5cfa3505adc453123e3db1ba16f5b3c5270dac6f5`.
- Complete current 103-file production/test/fixture manifest SHA-256: `e9bf13c82a6b56fb2ae15a1d53aae2d8d49b443cd5684f4977cdfa5900254e24`.

Independent read-only review checked 3567 path combinations (no frozen-danger rejection bypass or UTF-8-length change), 480 invalid mixed Plans (all PLANNING_INVALID), and directly executed all46 new assertions on Python3.12. These are finite deterministic checks, not universal safety proof. Old Runner/SkillManager/frozen Planner and migrations001-009 are byte-identical to the compatibility baseline. The earlier GateA three authorized changes remain historical, not changes made by this correction.

Only the corrected source and necessary public documentation/test results are committed. Tests/fixtures/hidden Oracles/raw evidence/delivery reports/review ZIP remain local/private under AGENTS.md. Final Git and archive identity, byte count/member count/CRC and member digests are recorded after push in REVIEW_MANIFEST.txt and the private verified publication record. The review ZIP remains mandatory. No Step4.
