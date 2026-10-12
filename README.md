<p align="center">
  <img src="docs/assets/Axis.png" alt="Axis-Evo" width="100%">
</p>

# Axis-Evo

Axis-Evo 是面向大语言模型智能体的可信技能演化与中断恢复研究原型，服务于毕业设计《大语言模型智能体可信技能演化与中断恢复系统设计与实现》。

项目将模型规划、调用方审批、工具执行和独立验收分开，通过 SQLite 持久化执行事实，将任务、计划、Skill 版本及执行结果关联起来，并支持只读审查、可核验检查点、受控恢复和证据门控的技能演化。

当前实现到 **Phase 3 / Step 4**。运行时代码使用 Python 标准库，要求 **Python 3.11+**。

## 项目结构

```text
axis-evo/
├── src/axis_evo/
│   ├── models.py / events.py / storage.py   # 数据模型、事件与持久化
│   ├── sandbox.py / tools.py               # 工作区边界与受控工具
│   ├── runner.py / validators.py           # 计划执行与独立验收
│   ├── inspector.py                        # 执行事实审查
│   ├── skill_card.py / skill_manager.py     # 不可变技能版本与生命周期
│   ├── skill_binding.py                    # 精确技能版本授权
│   ├── skill_planner.py / planning_*.py     # 模型规划与计划溯源
│   ├── agent_*.py                          # 有界编码尝试与反馈
│   ├── checkpoint_*.py / recovery_*.py      # 检查点与受控恢复
│   ├── skill_trust*.py / shadow_evaluation.py # 证据评估与影子模拟
│   ├── skill_evolution*.py / skill_revision.py # 修订、晋升与版本激活
│   └── migrations/                        # SQLite 显式迁移
├── examples/                              # 程序化使用示例
├── docs/
│   ├── assets/Axis.png                    # 项目封面
│   ├── SKILL_EVOLUTION.md                  # 技能演化接口与使用说明
│   ├── RECOVERY_OPERATION_CONTRACT.md      # 恢复操作约定
│   └── TEST_RESULTS.md                     # 测试结果
├── pyproject.toml                         # 项目配置
└── AGENTS.md                              # 仓库协作规则
```

完整测试、fixture 和交付报告保留在本地审查包中，不随公共仓库发布。
