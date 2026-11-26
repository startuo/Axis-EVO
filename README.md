<p align="center">
  <img src="docs/assets/Axis.png" alt="Axis-Evo" width="100%">
</p>

# Axis-Evo

Axis-Evo 是一个本地优先的 AI Agent 工作台，面向代码修改、文档交付和需要保留执行证据的任务。选择工作区并描述目标后，Agent 可以在授权范围内检索资料、编辑文件、运行项目检查，并留下可审查的差异与回执。

当前版本为 **0.1.0 Preview（M7.1）**。

## 可以做什么

- **在 Work 发起任务并审查交付。** 同一工作区内查看对话、改动、文件和执行回执，按保存的进展继续修订。已授权的知识目录、Skill 库和当前附加的 Edge 页面可作为任务材料。
- **在实际项目中修改和验证。** Agent 支持受控文件编辑和只读 Git 观察。用户可在审查面板显式暂存、取消暂存、撤销和提交。授权后，命令、写入后检查和固定验收可在无网络 Linux 容器中执行。
- **核对实际执行结果。** 本地 SQLite 保存任务、工具请求、执行回执和验证记录。文件编辑使用读取时的 SHA-256 校验版本。结果不确定的操作记为 `UNKNOWN`，重启或续跑时不会自动重放。
- **依据任务反馈修订 Skill。** 保留原版和候选版本，用固定案例及历史反例比较实际产物，并按工作区策略决定采用、保留或回退。真实任务中稳定的质量改善和成本收益仍待验证。

## 开始使用

| 场景 | 入口 |
| --- | --- |
| Windows 预览版 | 通过 Setup.exe 安装后，从开始菜单打开 **Axis-Evo**，添加工作区并设置模型。安装包自带 Python 运行时和前端。安装包未签名，构建步骤见 [Windows 预览指南](docs/WINDOWS_PREVIEW.md)。 |
| 源码开发 | 按 [Agent 工作区指南](docs/AGENT_WORKSPACE.md) 构建前端和启动服务。 |
| 配置模型 | 在「模型连接」配置受支持的 Provider。启用外部模型时，完成任务所需的已授权材料会随请求发送给 Provider。见 [模型连接说明](docs/AGENT_PROVIDER.md)。 |

工作台使用本机回环地址。项目命令和固定检查需要 Docker 的 Linux 引擎和用户授权的镜像。Docker 缺失时会禁用这些功能。Edge 扩展为可选组件。

## M7 / M7.1 实测摘要

- M7 使用 `qwen4-max` 在真实 `python-slugify` 项目中分三段续跑。12 次请求的提示词缓存命中为 **29.24%**。模型段因预算结束，最终产物经独立 Docker 复验通过原项目回归和新增 **8/8** 项固定验收。
- M7.1 为 Anthropic 兼容请求增加历史缓存断点，Work 显示命中、写入和未命中用量。仅离线契约验证，未跑实机模型。
- M7.1 在 Windows 11 上通过前端 214 项测试和 Python 3342 项回归，另有 15 项跳过。已验证从 M7 覆盖升级、启动和卸载。按 [Windows 预览指南](docs/WINDOWS_PREVIEW.md) 安装。

阶段变化见 [更新日志](CHANGELOG.md)。详细回执、回归日志和安装记录保存在本地交付证据中。

## 代码入口

| 路径 | 内容 |
| --- | --- |
| [`src/axis_evo/`](src/axis_evo) | 执行核心、事件、验收、检查点与 Skill 版本 |
| [`web_api/`](web_api) | Agent Runtime、工作区权限、Provider 和容器执行 |
| [`web/`](web) | Work 工作台、技能与设置界面 |
| [`desktop/windows/`](desktop/windows) | Windows 启动器与安装构建 |
| [`browser/edge-extension/`](browser/edge-extension) | Edge 页面连接 |

## 产品主线与学术归档

产品源码统一维护在 `main`。毕业设计《基于大语言模型的技能演化系统的设计与实现》的公开冻结历史由标签 [`academic/thesis-freeze-2026-11-02`](https://github.com/startuo/Axis-EVO/tree/academic/thesis-freeze-2026-11-02) 保留，也可在工作台的「毕业设计只读展示」查看公开研究记录、评价和证据局限。
