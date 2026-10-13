# Workbench UI 约定

工作台借鉴 [Codex app](https://openai.com/index/introducing-the-codex-app/) 的项目导航、中央任务空间和邻接审查面板。使用 Axis-Evo 自有标记、颜色和信息结构，没有复制 OpenAI 资产。

## 布局与视觉

- 桌面：260px 项目/任务侧栏、弹性中央工作区、380px Inspector；宽屏 Inspector 400px。收起侧栏为 68px。
- 1200px 以下 Inspector 改为右侧模态面板；760px 以下导航改为左侧抽屉，页面单列。抽屉与 Inspector 不同时打开。
- 顶栏 52px；内容区域独立滚动，任务草稿保持在底部。技能、演化及设置页使用独立内容布局。
- 暖白、低饱和绿与细边框；dark theme 使用同一语义 token。系统字体，无网络字体；正文 14px，标题 20–28px，辅助元数据至少 12px。
- 颜色不是唯一状态来源。状态使用文字与图标，长 hash 可以折行并复制。

`web/src/styles/tokens.css` 定义背景、表面、边界、文字、accent 与 success/warning/error；`workbench.css` 定义布局、间距、焦点、响应式及 reduced-motion。

## 事实语义

Demo 的数据源提示持续可见，示例 hash 和证据均不表示真实运行。Core 模式只显示明确配置的本地数据源；错误和不支持保留原状态，不以 Demo 填补。

`PROPOSED` 与 `APPROVED` 分别展示；只有明确批准状态及相同的存储/批准摘要才使用 APPROVED。手工 Runner 的 `STEP_PLANNED` 投影使用 `NOT_RECORDED`，不补造模型提案或批准。

事件按 `seq` 排序，Intent 与 Result 分列。任务完成依据已存终态和独立验收，不依据工具 SUCCESS。`UNKNOWN` 与独立 Recovery Child 的完成状态并列，后者不改写 Source。无 checkpoint 不补造；SHADOW 不显示为生产准入。

计划卡的提案入口打开同一运行的 Inspector 计划页。Skill 详情只链接 source SkillRef 精确匹配的演化 Case；缺少计划 SkillRef 不推断整个 Run 未绑定。Demo 快照逐行显示增加、删除及上下文，不称作 Git diff 或工具因果。草稿框显示工作区和配置草稿身份，与历史 Run 的模型记录分别展示。

Trust Assessment、gate eligibility、approval、TRUSTED receipt、preferred-version activation 是不同事实。Demo 展示完整预设链；Core 展示实际可用投影，明确 unsupported / metadata-only，不宣称全部阶段均已核验。

## 屏幕与交互

工作台首页、任务/Timeline、Inspector/Recovery、Skills、Evolution、Provider Settings 构成六类主屏，另有活动页。项目/任务搜索、版本选择、证据 tab、seq 筛选、计划展开、文件元数据/演示快照、主题与面板切换均可操作。

`Ctrl/⌘ K` 打开命令面板，方向键和 Enter 导航；`Ctrl/⌘ N` 返回新草稿；`Ctrl/⌘ Enter` 保存会话草稿。草稿按模式/项目/任务隔离，刷新清除，不发模型请求。Provider 设置同样是会话草稿，不保存凭据值、不模拟连接成功。

使用原生 button、select、details、dialog；可见 focus、skip link、tab roving focus、dialog Escape/焦点恢复；遵守 reduced-motion。没有 Markdown/HTML 直接注入或动态代码执行。

执行、上传、恢复审批及 Provider 测试保持 disabled 并说明原因。Web 只读桥接的安全和数据预算见 [WORKBENCH_SETUP.md](WORKBENCH_SETUP.md)。
