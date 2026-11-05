# Axis-Evo Next：统一协作与 Edge

产品增强分支以 `12c789b187a6bf8332b8d5222d00cc0702d4bdc8` 为研究基线。旧 Skill、Run、Gate、数据库和实验材料不迁移、不覆盖；产品验证不替代论文实验。

## 体验与实现顺序

1. 同一对话承载讨论、文件任务、网页任务与交付物的后续修订。
2. 中央活动流只呈现有来源的状态变化；工作面板按需展示网页、计划、成果和证据。
3. 网页正文经过用户指定标签页及模型接收方授权后，作为不可信材料提供给现有回复 Worker。
4. 模型产出先作为草稿预览；明确批准精确内容后，通过受控文件工具保存并独立核对字节。修订创建新版本，不覆盖旧产物。
5. 每次浏览器操作先记录不可变意图，再单次派发；点击回执、页面观察与业务成功分开。断线和丢响应保留 UNKNOWN，不重派。

## 上游选择

参考 [huashu-chrome](https://github.com/alchaincyf/huashu-chrome/tree/84d5ee40532ca586650d3d5f78f3952d3061cd06)，固定 `84d5ee40532ca586650d3d5f78f3952d3061cd06`，版本 1.3.0、MIT。

复用其 isolated-world 页面快照、稳定 ref、元素语义检查与正文读取。Axis 兼容层限定命令、隐藏表单值、屏蔽敏感操作及重复点击。保留原许可证和修改说明。

没有采用完整上游 MCP/Bridge：其广泛权限、任意求值和浏览器选择策略超出本阶段边界。Axis 使用标准 MV3 扩展与 Python loopback 桥，不新增通用 MCP 宿主或 Node 后台依赖。

## 信任边界

| 边界 | 控制 |
| --- | --- |
| 网页到扩展 | 页面仅为不可信材料；isolated world，不接受外部消息，不从页面读取授权 |
| 扩展到本机桥 | 精确 loopback Host、Edge User-Agent 检查、固定扩展 Origin、自动实例登记与内存连接身份 |
| 多浏览器与多 Profile | 拒绝 Chrome 握手；明确 instance ID 与标签页绑定，不选择最近活动实例 |
| 标签页变化 | 绑定文档、URL 身份和快照；陈旧引用拒绝执行，重新观察不等于重试旧操作 |
| 模型到工具 | 模型只能建议；后端命令 allowlist 和审批对象独立验证，无 eval、Shell、Cookie API |
| 页面到模型 | 明确选择标签页和固定 Provider revision；正文有界，凭据检查，不携带 URL query/fragment |
| 审批到文件 | 精确内容与计划摘要；不可变修订；Core 工具事实及字节验收与文本质量分开 |
| 断线与重启 | 意图、已派发和结果分别持久化；已派发未确认不自动重放；迟到回执不抹去 UNKNOWN |

同一可信 OS 用户不是隔离对手。Edge 自报身份与浏览器请求头不是对恶意本机软件的远程证明。页面脱敏不构成通用 DLP；批准内容范围仍是主要边界。

## 自动连接

Edge 扩展启用后自动连接本机工作台，不使用配对码、不提供连接验证或安装向导。用户直接选择实例和标签页。扩展使用固定公钥确定唯一身份；工作台只接收该扩展在 Edge 中发来的连接，不接受普通网页来源。程序不改 Edge Profile、Cookie、浏览器启动参数或远程调试端口。

官方依据：[Edge 侧载扩展](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/getting-started/extension-sideloading)、[Edge 扩展支持 API](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/api-support)、[Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[可选权限](https://developer.chrome.com/docs/extensions/reference/api/permissions)。是否兼容最终以真实 Edge 验证为准。

## 验证边界

分别记录离线协议、实际 DOM、真实 Edge 扩展、真实 Provider、文件执行与人工接管证据。连接测试不证明任务完成，模拟网页不证明任意生产站点可用。扩展由用户自行管理，产品内不提供配对码、连接验证或相关引导；其它实现与验证独立推进。

## 已实现范围与当前验收

| 能力 | 当前证据 |
| --- | --- |
| 对话、任务活动、工作面板 | 实际日常 Edge 中检查过布局；聊天与文件任务继续复用既有 Runtime |
| 草稿、保存与修订 | 明确标记的离线页面/模型夹具，实际 HTTP、独立回复 Worker、独立文件 Worker、Core 与磁盘字节；界面连续修订 v1 至 v4，v1 保存字节未变 |
| 文件预览与变化区间 | 仅展示与持久化摘要一致的本地字节；原始 seed 也核对摘要。变化区间是共同前后缀之间的内容，不冒称完整逐行 diff |
| 响应式与键盘 | 实际 Edge 320/768/1024/1440 像素检查；方向键切换面板，Escape 关闭并归还焦点；明暗主题与控制台检查 |
| 桥接协议与中断 | 离线 TCP/协议及并发端口回归；Windows 重复监听问题已复现并修复 |
| 页面 DOM 适配层 | 实际 Edge 隔离页10/10检查通过，加载当前原字节脚本；消息接收器为显式 shim，仅证明 DOM 方法与入口判断，未证明真实扩展 API/isolated-world/Bridge |
| 真实 Edge 扩展连接及页面操作 | 尚未完成；工作台页面运行在 Edge 不等于本产品扩展已连接 |
| 真实 Provider 与网页到本地 Markdown 全链路 | 尚未完成；固定响应夹具不替代真实模型或真实网页登录态验收 |

当前能力不包含浏览器自由循环、任意脚本、任意 Shell 或通用 MCP 宿主。主要路径是用户选择 Edge 实例和标签页，将材料用于当前对话；如需网页交互，明确审阅并批准固定快照上的单次操作。模型不能扩大该权限。

网页正文读取上限 16,000 字符；单次模型整理最多提供约 4,200 字符材料，且受已有回复请求预算约束。超过时在活动流明确显示仅使用截取片段，证据记录原文摘要、实际上下文摘要、截断标志与固定接收方。长网页完整整合尚不是当前承诺。

草稿保存上限 32 KiB，文件名限单个 `.md` 名称；每次交付使用独立目录与 Core 数据库，原有研究数据库不参与写入。交付的 Core Run 明确无 Skill 身份，不把新的文档保存任务冒充旧 Skill 执行。现场文件外部变化只撤销当前字节核对标记，不修改历史完成事实。

Web 存储新增 019/020，fresh init 显式准备。旧配置点击连接可显式准备这两组 Web 表，不迁移 Core。原有 `upgrade-copy` 仍只产生数据库副本，返回 `workspaceRestored=false`；包含交付文件的完整工作区备份仍须另行保留。

产品保持 0.1.0 Preview；扩展 0.2.0 是组件协议版本，不代表新的正式产品发布。构建当前仍提示主 bundle 超过 500 kB，未通过放宽阈值消除该提示。
