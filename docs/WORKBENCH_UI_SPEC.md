# Workbench UI 约定

工作台借鉴项目/线程侧栏、中央工作区、邻接审查面板的组织方式。使用 Axis 自有标志、铜色/石墨中性色和黑体字体，不复制参考产品文字品牌、官方图标或专有插画。没有指定旧版本截图，验收针对信息结构、比例、密度、空态与交互，不声称像素级 1:1。

## 布局

Runtime 桌面使用 248px sidebar、弹性中央空间、376px Inspector；Inspector 可用 pointer 或方向键在320–520px调整。收起sidebar为68px，顶栏48px。1200px以下审查为模态sheet，760px以下导航为抽屉，二者不同时打开。设置/权限页默认不占空白Inspector。

正文14px，Runtime密集正文13px，元数据10–12px；长hash允许换行和复制。字体为 PingFang SC / Hiragino Sans GB / Microsoft YaHei / Noto Sans CJK SC / Source Han Sans SC / system sans-serif；标识和hash使用monospace。没有网络字体、宣传hero或无依据动效。composer按内容增长并设上限，不遮挡当前线程；固定计划执行中的线程不显示续聊输入。

浅/深色分别使用原样 Axis 亮.png / Axis 暗.png，保持透明度及纵横比，不裁切、不重绘、不滤色。语义绿/黄/红只表达状态，并同时提供文字。原离线Demo与Core页面保留，但使用相同Axis色彩/标志。

## 三种数据源

- DEMO：明确预设场景，不发模型请求、不执行、不审批。
- CORE · 只读：明确配置的已有数据库投影，UNSUPPORTED/metadata-only保留，不用Demo填补。
- RUNTIME · 本地执行：后台会话授权后的真实请求/计划/审批/执行。Thread ID与Run ID分开；规划中或待审批时尚无Core Run。Provider transport测试double只存在于私有测试harness。

## 执行与审查语义

主线程显示实际用户prompt、模型请求状态、完整Plan arguments、精确digest审批、Core seq事件和独立Validation。模型响应不是思考流。Web状态不分配Core seq，Web FINISHED不冒充RUN_COMPLETED，Tool SUCCESS不等于Validation PASSED。

计划卡完整显示JSON arguments；批准checkbox与按钮提交准确proposal ID + plan SHA-256，不允许替换计划。审批只能由后端核验成功确认。UNKNOWN持续可见，Source与Recovery Child分别展示，没有重试/恢复按钮抹除未知。事件按events.seq，不按模型时间排序。

Skill版本、Trust Assessment、gate eligibility、promotion approval、TRUSTED receipt和preferred activation分别呈现。Runtime入口到Skills明确切回Demo/Core只读数据模式；不把预设Skill卡当运行时准入。Inspector的审查/事件/文件/证据分开；文件页面只有持久观察，未知现场不补文件内容或因果。

## Provider 与权限

Provider配置版本在后端持久保存；页面不接受API Key，只选择后台批准的credential reference与完整HTTPS Endpoint。编辑创建新revision。测试按钮发真实固定请求，仅显示对应revision实际测试记录，不把保存配置当连接成功。Reasoning/Retry明确不支持。既有线程显示自己的版本快照，不跟随当前默认模型。

权限页显示后端file-only模式、blocked run_tests、固定Acceptance、seed/junction/输出预算与会话状态。不能通过客户端开关提升工具权限或增加任意主机路径。

## 可访问性与交互

保留原生button/select/dialog、skip link、可见focus、tab roving focus、Escape及焦点边界。Inspector splitter可键盘操作。Ctrl/⌘ N新任务；Ctrl/⌘ K搜索线程；Ctrl/⌘ Enter在Runtime仅生成计划，在旧Demo只保存草稿。轮询不抢焦点，不自动重发mutation。草稿和CSRF仅页面内存；HttpOnly session可在同源刷新后恢复。响应式、深色、键盘、axe、完整参数和真实审批链由实际浏览器验收。
