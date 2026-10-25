# Workbench UI 约定

## 范围与来源

保留 React、TypeScript、Vite、AXIS 标志和本地字体。原共用框架参考 Caho1/open-claude-ui `2834bc158a4849f21c97cbb2e0b10525f6e646f1`（MIT）；当前颜色采用 Radix Colors 3.0.0。DeepSeek Harness 和 Codex 只用于研究活动行、审批与信息层级，不复制品牌资源或替换 Python Core。许可见 `THIRD_PARTY_NOTICES.md`。

默认入口为 `#/runtime`。Runtime、Demo、Core 只读共用布局，业务控制器保持分离；既有 task、Skills、Evolution、settings 深链接保留。Demo 不发送模型请求、不执行审批，不替代缺失的真实事实。

## 对话与三级信息

1. 正文：用户输入、实际模型回复、紧凑工具活动、当前结果和必要错误。不开箱显示 hash、事件 ID、原始 JSON 或重复任务标题。
2. 详情：拟修改片段、完整可读参数、已保存工具结果、文件和失败背景。工具内容作为不可信文本，不重新读取现场文件来填充历史结果。
3. Inspector：精确 Plan/Card/TaskSpec、Provider 快照、批准来源、事件 seq、独立验收、检查点和恢复关系。Skill 页面保留版本、Trial census、Gate、晋升与激活记录。

普通对话使用独立无工具路径；不构造空 Plan，不要求 Skill 或创建 Run。CHAT/TASK 按已提交顺序组成同一历史。模型回复、计划、工具记录和验收保持不同来源。

修改计划展示受影响文件、拟替换前后片段或完整覆盖内容。参数按需展开；一次明确“批准并执行”提交原精确摘要，不要求抄写 hash 或额外勾选。高影响 Skill 晋升/激活仍按独立精确审批规则进行。

纯读取只有在明确管理员策略及页面所见范围匹配时可以自动批准。页面提交前显示全部授权路径；Inspector 明确 POLICY 来源，不称作人工批准。等待正常规划退出的授权核对状态是协调器观察，不是 Core 成功事实。

## 视觉系统

`tokens.css` 是语义颜色来源；旧 CDS 名称仅作兼容别名。

| 用途 | Radix |
|---|---|
| Canvas、表面、正文和边界 | Sand 明暗及 alpha scales |
| 品牌与主要交互 | Bronze |
| 成功、警告、错误、信息 | Green、Amber、Red、Blue |

背景使用 1–5、边界 6–8、交互 9–10、文字 11–12；组合仍须实际对比度检查。成功/警告/错误浅底文字使用已验证的深色阶，不能把“来自 Radix”当成 AA 证明。照片和原品牌图片不改色。

主要字号为 13px 次要标签、15px 正文/输入/控件、20px 重要标题。代码可使用 12px，但不出现更小 UI 字号；Markdown 与浏览器缩放以可读性为先。中文使用系统回退，运行时字体不请求外部 CDN。

侧栏 288px / 收起 64px；中央输入区最大宽 768px；审查面板默认 376px，可键盘或拖动调整。窄屏使用导航抽屉和 Inspector sheet。空态不保留空证据面板。

圆角以 6/10/14px 语义变量为主。普通消息平面呈现，以留白、排版和表面区分，避免每个事件一张卡。普通分隔采用轻量边界；焦点保留可见的 2px 环，不机械套用 0.5px。阴影仅用于浮层。

动效仅表达实际状态或面板变化，约 150–250ms ease-out；Inspector 使用 180ms。不使用逐消息入场或装饰跳动，遵守 `prefers-reduced-motion`。

作者 UI 文案不用 `·` 分隔，不添加重复 eyebrow/英文 overline。用户文本、模型输出和不可变历史值保持原样，不为排版改写事实。

## 模型、会话与授权

普通 Windows 模型连接路径为 DeepSeek 预设、API Key、安全入库、连接测试、模型选择、对话。输入只在当前 RAM 中短暂存在，发送时清空；后端显式 Windows 凭据管理器保管，不回退明文。高级端点、环境引用和不可变版本历史按需展开。其它管理员配置兼容服务/本机网关保留原有边界。

连接测试不证明有效 Plan、工具成功或任务完成；编辑创建新 revision，历史线程保留原快照。未支持参数明确标为不生效，不显示虚假的 reasoning 状态。

正常入口由 CLI `--open-browser` 通过短期单次 fragment 能力建立 HttpOnly 会话，然后清理 URL。刷新、多标签和重启后的新启动页不要求手工代码；终端代码仅保留高级 fallback。网页不能签发启动能力。Host、Origin、CSRF 和精确 endpoint 授权不变。

## 状态与安全内容

模型文本未经验证；Tool SUCCESS 不等于 Run COMPLETED，Web FINISHED 不代替独立 Acceptance。完成必须由已加载的匹配持久事实支持。UNKNOWN 不提供自动重试；恢复子成功不改写原 Source。

正文错误先说明发生了什么、是否可能已有影响以及可采取的安全动作。技术代码放在详情；不显示栈、原 Provider 错误正文或秘密。

Markdown 使用 react-markdown 10.1.0，禁用 HTML。远程图片仅显示替代文本；链接仅允许无 URL 凭据的 HTTPS，使用 noopener/noreferrer。工具内容以文本呈现，不通过 innerHTML 注入。

## 键盘与验证

新对话和 Ctrl/⌘ N 清空草稿、旧提示和浮层，恢复输入焦点；已提交任务仍保留。项目、模型和显式 Skill 选择不随草稿清理。迟到请求不能改写新草稿或跳回旧路由。

Enter 提交、Shift+Enter 换行，中文 IME 组合期间不提交。保留 skip link、可见焦点、Escape、模态焦点边界、Inspector 标签方向键和 splitter 键盘操作。轮询不抢焦点，不重发 mutation。

真实浏览器覆盖对话、读写、精确审批、UNKNOWN、Provider、自助启动、演化、明暗响应式、长文、真实缩放、重复导航和按需展开。结果见 `TEST_RESULTS.md`；完整测试、失败日志、截图和性能样本只保留本地。单次自动化与离线 Provider double 不证明真实联机质量、用户研究或不存在长期资源泄漏。
