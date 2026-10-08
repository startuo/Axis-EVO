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
