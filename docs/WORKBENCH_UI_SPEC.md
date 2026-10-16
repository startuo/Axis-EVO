# Workbench UI 约定

## 参考与实现范围

界面基于 Caho1/open-claude-ui 固定提交 `2834bc158a4849f21c97cbb2e0b10525f6e646f1` 的公开 CDS 主题、组件和 Storybook 重构，保留 AXIS 标志及简体中文。参考提供组件展示而非完整应用；新对话整体布局采用本项目确定的欢迎语与居中输入框。源码许可见仓库 `THIRD_PARTY_NOTICES.md`。

React 19 / TypeScript / Vite 保持现状；framer-motion 固定为 11.18.2。Inter、Newsreader、JetBrains Mono 与各自 OFL 在本地提供，中文使用系统回退字体。运行时字体和品牌资源不访问 CDN。为兼容现有四路连接预算，字体在标志就绪后依次注册，标志仅请求当前主题版本。不引入桌面窗口、附件、多轮追问、模拟流式回复或其他未实现服务。

## 共用框架与新对话

Runtime、Demo 与 Core 只读共用 WorkbenchShell、WorkbenchSidebar、弹出选择器与审查容器，业务控制器按当前路由单独挂载。默认入口 `#/runtime`；既有 task、Skills、Evolution、settings 等深链接保留。

桌面侧栏 288px，收起 64px，顶栏 46px。中央输入区最大宽 768px，输入框圆角 20px、用户气泡 18px、面板 10px，使用参考四层低对比表面和陶土色 `#d97757`。760px 以下导航为抽屉，1200px 以下审查为模态 sheet。桌面审查面板默认 376px，可拖拽或键盘在 320–520px 间调整。

首页主体仅有“今天，想完成什么？”与输入框，整体居中略上移。最近记录留在侧栏；项目、模型和精确 Skill 选择收进输入工具栏。首页不展示项目摘要、最近列表、安全说明条或空审查面板。Runtime 未连接、未授权或配置缺失时保留这一结构，展示简短状态与设置入口，生成计划保持禁用。

侧栏新对话按钮与 Ctrl/⌘ N 调用同一重置入口：清空当前草稿，关闭所有弹窗/菜单/审查面板、旧提示并重置滚动与输入焦点；项目、模型和已明确选择的 Skill 保留。使用独立视图会话标识隔离在途请求，旧响应不能改写新草稿或将路由跳回旧任务。已提交的后台任务仍保留在历史中。

Enter 提交、Shift+Enter 换行、Ctrl/⌘ Enter 保留；中文输入法组合期间的 Enter 不提交。输入框按内容增长至上限。固定计划线程不显示续聊输入。主题及侧栏收起偏好可以保存；草稿、会话代码及 CSRF 不写入浏览器持久存储。

## 数据来源与执行事实

- DEMO：明确的预设场景，仅保存本地草稿，不发模型请求、不执行、不审批。
- CORE · 只读：已有数据库的只读投影，保留 UNSUPPORTED/metadata-only，不以 Demo 填补缺失事实。
- RUNTIME · 本地执行：会话授权后的真实请求、规划、明确审批与执行。Thread ID 与 Run ID 分开；规划及待审批期间尚无 Core Run。测试 Provider double 只存在于本地私有 harness。

待审批计划默认完整展开：全部步骤、JSON arguments、精确 Plan digest、审阅勾选和批准按钮直接可见。次要身份摘要可按需展开，但不能替换或隐藏待批准的计划参数。审批仍提交准确的 proposal ID 与 plan SHA-256。

Core 事件、Worker 监督与文件证据可折叠；UNKNOWN、失败、轨迹不一致和独立 Validation 必须直接可见。Web FINISHED 不代替 Core RUN_COMPLETED，Tool SUCCESS 不等于 Validation PASSED。事件依 Core seq 排序。Source 与 Recovery Child 分别呈现，不提供自动重试、取消或恢复操作。

Inspector 默认关闭，只在任务上下文提供，通过查看证据或顶栏按钮打开；审查/事件/文件/证据分开。文件页仅展示持久化观察，不推断现场内容或工具因果。Skill 信任、gate eligibility、promotion approval、receipt 与 preferred activation 保持原有区别。

## 配置、权限与交互

Provider 配置仍由后端保存，编辑创建独立 revision；旧线程使用原始模型快照。页面只选择允许的 credential reference 与 HTTPS Endpoint。连接测试仅证明该版本本次请求的响应，不证明任务或工具成功。权限和允许工具由后端决定。

所有控制可键盘访问；保留 skip link、可见焦点、弹窗焦点边界、Escape、Inspector 标签方向键与 splitter 键盘操作。弹出选择器支持方向键、Home/End、Enter、Escape、外部点击关闭。轮询不抢焦点、不自动重发 mutation。动效使用参考物理参数，并遵循 prefers-reduced-motion。

验收涵盖类型/静态检查、前端回归、真实 HTTP 隔离 Runtime 链路及六尺寸明暗浏览器检查；实际结果记录在 TEST_RESULTS.md。测试源码、fixture、截图与审查日志仅保留本地。
