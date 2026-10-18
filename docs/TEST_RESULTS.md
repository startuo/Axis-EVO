# 测试结果

## Phase 5 / Step 1 — 2026-10-18 当前验证

Baseline Commit: `506a8511c6593bf10e9e699069b44c1834843bab`。
Tested Source Commit: 本节所属实现提交；发布后补记完整 commit，源码冻结 hash 见本地审查包。
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
