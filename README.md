<p align="center">
  <img src="docs/assets/Axis.png" alt="Axis-Evo" width="100%">
</p>

<h1 align="center">Axis-Evo</h1>

<p align="center">
  本地优先的通用 AI Agent 工作台，面向代码与文档交付，提供可核验执行证据、显式审查工作流与受控 Skill 演化。<br>
  <sub>Local-first AI agent workbench for code and document delivery, with auditable execution evidence, explicit review, and controlled skill evolution.</sub>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0%20Preview%20(M8)-1c1b18?style=flat-square">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-376db0?style=flat-square">
  <img alt="Stack" src="https://img.shields.io/badge/stack-Python%203.11%2B%20%2F%20React%2019-5aa878?style=flat-square">
  <a href="https://github.com/startuo/Axis-EVO/tree/academic/thesis-freeze-2026-11-02"><img alt="Academic Freeze" src="https://img.shields.io/badge/thesis%20freeze-12c789b-7c56d4?style=flat-square"></a>
</p>

---

## 核心特性

- **Work-First 三栏工作台**：在同一工作区内完成任务发起、实时过程跟踪、文件浏览与显式 Git 审查（暂存 / 取消暂存 / 撤销 / 提交），支持按快照断点续跑、切页草稿保留，以及 390px 窄屏与深浅双主题适配。
- **多模型批量接入与推理强度控制**：支持 OpenAI 兼容、DeepSeek、Anthropic Messages（含 Qwen4-Max）与本地网关；读取模型列表后可多选批量接入并按端点分组检索，内置 Claude 风格动态推理滑块，并在上下文浮层实时展示提示词缓存的命中、写入与未命中明细。
- **可核验执行与保守故障语义**：任务、工具意图、执行回执与产物统一落盘至本地追加式 SQLite；改写文件强制 `SHA-256` 版本核验；授权项目命令与固定验收运行在无网络、无宿主挂载的 Linux Docker 容器中；结果未确认的操作严格记为 `UNKNOWN`，重启或续跑绝不静默重放。
- **受控 Skill 版本演化**：保留不可变 Skill 版本链，基于任务反馈生成候选修订，通过固定案例与历史反例比较实际产物，再按工作区策略显式采用或回退（真实复杂任务下的稳定质量增益与成本收益仍待持续验证）。

---

## 快速开始

### 方式一：Windows 预览安装包（推荐）

直接运行 `Axis-Evo-0.1.0-Preview-M8-Setup.exe`，安装完成后从开始菜单打开 **Axis-Evo** 即可使用。安装包自带便携 CPython 与已构建前端，无需额外安装 Python 或 Node.js（安装包未签名，随附 SHA-256 校验，完整说明见 [Windows 预览指南](docs/WINDOWS_PREVIEW.md)）。

### 方式二：源码运行

要求常规 CPython 3.11+（Windows 不支持 Microsoft Store Python）与 Node.js 22.12+：

```powershell
# 1. 构建前端
cd web
npm ci
npm run build
cd ..

# 2. 创建虚拟环境并安装本地运行依赖
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[web]"

# 3. 启动本地工作台（仅监听 127.0.0.1）
.\.venv\Scripts\python.exe -m examples.agent_workspace --data-dir "$env:LOCALAPPDATA\AxisEvo\data" --open-browser
```

首次进入后，在 **设置 → 工作区** 授权目标目录，在 **设置 → 模型连接** 配置模型即可在 **Work** 发起任务。项目命令与固定验收需本机 Docker Desktop Linux 引擎及用户授权镜像（缺失时自动禁用）；Edge 浏览器扩展为可选组件。

---

## 项目结构

公开仓库仅保留项目本体与核心使用文档，构建日志、过程报告与验收证据均保存在本地归档：

```text
Axis-EVO/
├── src/axis_evo/              # 冻结执行核心：事实账本、字节校验、检查点与 Skill 不可变版本链
├── web_api/                   # 产品后端：Agent Runtime、读写分槽并发控制、Provider 协议与 Docker 沙箱
├── web/                       # Work-first 前端工作台（React 19 + TypeScript + Vite）
├── desktop/windows/           # Windows 原生启动器（C#）、NSIS 安装配置与便携构建脚本
├── browser/edge-extension/    # 可选 Microsoft Edge MV3 扩展（单次标签页读取与审批绑定）
├── examples/                  # 公开启动入口与独立演示脚本
├── third_party/               # 第三方 Skill 示例与对应开源许可
├── docs/                      # 用户与部署指南（核心文档 + 品牌资源）
├── CHANGELOG.md               # 阶段精简更新日志
├── THIRD_PARTY_NOTICES.md     # 第三方开源组件声明
└── pyproject.toml             # Python 包与可选依赖定义
```

### 文档导航

| 文档 | 说明 |
| --- | --- |
| [Windows 预览指南](docs/WINDOWS_PREVIEW.md) | 安装包使用、覆盖升级、数据目录与本地构建复核 |
| [Agent 工作区指南](docs/AGENT_WORKSPACE.md) | 源码启动、工作区权限、Docker 沙箱与工具边界 |
| [模型连接说明](docs/AGENT_PROVIDER.md) | 受支持的 Provider 协议、网络路由与本地网关配置 |
| [Skill 演化说明](docs/SKILL_EVOLUTION.md) | 不可变版本链、反馈归因与对照评审流程 |
| [开发环境搭建](docs/WORKBENCH_SETUP.md) | 存储初始化、前后端联调与运维约定 |
| [更新日志](CHANGELOG.md) | 各阶段的新增、优化、修复与移除摘要 |

---

## 验证状态与已知边界（M8）

| 维度 | 当前状态 | 边界说明 |
| --- | --- | --- |
| 自动化回归 | 前端 TypeScript 0 错误、Vitest 222 项通过，生产构建通过。Python 3369 通过 / 15 跳过 | 跳过项均为 Windows 符号链接权限、POSIX FIFO 与无私有研究语料目录 |
| Windows 预览交付 | Windows 11 隔离安装路径实测 M7.1 → M8。锁定旧文件时拒绝升级，解除锁定后覆盖成功。启动返回 HTTP 200，卸载保留用户数据 | 全新裸机 Windows 10/11 环境仍待独立复验。安装包未代码签名 |
| 真实模型代码任务（M7） | `qwen4-max` 在 `python-slugify` 分三段续跑（12 次请求，缓存命中 29.24%），产物通过独立 Docker 回归与新增 8/8 项验收 | 模型段触发授权预算门禁停止；尚未证明跨项目的稳定自主完成率 |
| 提示词缓存优化（M7.1） | Anthropic 兼容协议新增历史滑动缓存断点并统一模型视图，前端实时显示命中 / 写入 / 未命中用量 | **当前仅完成离线契约与单测验证**，实机多轮命中率提升待后续实跑采集 |
| M8 多模态与办公预览 | Windows Edge 验证 1440px 亮暗主题及 390px 暗主题、办公文档联动与更新后的无闪烁刷新 | 图片 Provider 双协议与缓存断点通过离线契约验证。实机缓存复验因本机缺少可用凭据跳过 |

---

## 产品主线与学术归档

产品源码统一维护在 `main`。本科毕业设计《基于大语言模型的技能演化系统的设计与实现》的公开冻结历史由不可变标签 [`academic/thesis-freeze-2026-11-02`](https://github.com/startuo/Axis-EVO/tree/academic/thesis-freeze-2026-11-02)（`12c789b`）独立保存，核心目录 `src/axis_evo/` 保持零改动；也可在工作台内打开「毕业设计只读展示」查看公开研究记录与证据局限。
