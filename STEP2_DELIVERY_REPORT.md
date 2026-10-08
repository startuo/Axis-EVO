# Axis-Evo Step 2 交付报告

2026-10-02 · Phase 1 / Step 2 — Sandbox + Filesystem Tools + Core File Observation

**实现已完成，等待工程审查。完整测试为 154 passed、0 failed、4 skipped、0 warnings。工具执行位于 SQLite 事务之外，Crash Window B 保留。Step 3 未开始，无 Git commit。**

## 1. 文件新增与修改

新增项目文件：

| 文件 | 实现/验证内容 |
| --- | --- |
| `src/axis_evo/sandbox.py` | WorkspacePathResolver、Sandbox.from_seed、Core observe_file |
| `src/axis_evo/tools.py` | ToolPlugin、4 个受控工具、execute_tool_call |
| `tests/unit/test_sandbox.py` | 路径安全、原始字节观察、seed 复制、符号链接 |
| `tests/unit/test_tools.py` | 工具声明、UTF-8 字节、patch、受控 pytest 子进程 |
| `tests/integration/test_tool_execution.py` | 提交边界、观察复用、事件顺序、异常及真实硬退出 |
| `STEP2_DELIVERY_REPORT.md` | 本交付报告 |

已有 Step 1 的 20 个项目文件与 `axis-evo-step1-review.zip` 中的原始字节逐一比较，SHA-256 全部一致；没有改动既有实现、测试、配置、SQL 或 README。README 保留 Step 1 的原说明，本报告说明新增的 Step 2。另在 Vault 的毕业设计项目卡同步本步已验证状态。

## 2. 实际实现行为

- `Sandbox(root)` 使用既有工作区；`Sandbox.from_seed(seed, destination)` 复制 seed，拒绝复用目的目录、复制到 seed 内部或自动创建缺失父目录。`shutil.copytree(..., symlinks=True)` 保留符号链接，不删除工作区。
- `Sandbox.observe_file(path)` 仅观察指定路径；现存普通文件从一次 raw bytes 读取计算 SHA-256 与大小，缺失目标返回 false/None/None；目录及不安全路径被拒绝。
- ToolPlugin 仅提供 `name`、`mutating`、`declared_targets(arguments)`、`execute(sandbox, arguments)`。声明描述所有可能修改的任务相关路径，不表示已经发生的修改。插件不接收 SQLite 连接或持久化 API，继续使用 Step 1 的静态 PluginRegistry。
- `execute_tool_call()` 仅执行调用方提供的一个工具和 PlanStep，要求名称一致；不选工具、不生成计划、不循环、不管理 run 生命周期。
- 有修改目标时，顺序为：声明目标 → 每个目标一次 PRE 观察 → PRE FILE_OBSERVED → TOOL_INTENT COMMIT → tool.execute → POST 观察/FILE_OBSERVED → TOOL_RESULT COMMIT → 返回。PRE 观察对象同时用于 FILE_OBSERVED 和 TOOL_INTENT.targets，不重新读取/计算前置哈希。
- 无修改目标时，仅记录 TOOL_INTENT → 执行 → TOOL_RESULT；不制造文件观察。read_file 和 run_tests 的 targets 均为空。
- 调用前有活动 SQLite 事务则拒绝；工具执行没有包入 SQLite transaction。插入 intent 失败时不执行工具。非预期异常直接传播，可以留下已提交 intent 而无 result，不产生恢复判断。

## 3. 实际事件 payload 结构

所有事件继续使用 Step 1 Event Envelope，`schema_version=1`，带调用方给定的 `step_id`、`tool_call_id`，按 `seq` 排序，无 payload_version。

`FILE_OBSERVED`：

```json
{
  "reason": "PRE_TOOL",
  "path": "new.txt",
  "exists": false,
  "sha256": null,
  "size_bytes": null
}
```

`reason` 本步仅为 PRE_TOOL / POST_TOOL。现存普通文件的 sha256 是实际 raw bytes 的 64 位十六进制 SHA-256，size_bytes 为同次读取的字节数。

`TOOL_INTENT`（缺失文件的创建示例）：

```json
{
  "tool_name": "write_file",
  "arguments": {"path": "new.txt", "content": "created"},
  "mutating": true,
  "targets": [
    {"path": "new.txt", "exists": false, "before_sha256": null, "size_bytes": null}
  ]
}
```

targets 的每项均取自同一个 PRE FileObservation：path、exists、before_sha256、size_bytes。read_file / run_tests 为 mutating=false、targets=[]。

`TOOL_RESULT` 包含以下全部键：

```text
tool_name: str
status: SUCCESS | FAILED | TIMEOUT
message: str
duration_ms: number
result: object
```

write_file 的 result 为 `{}`；read_file 为 `{content: str}`；patch_file 为 `{matches: integer}`；run_tests 为 `{exit_code: integer|null, stdout: str, stderr: str}`。TIMEOUT 仅用于 pytest 超时。TOOL_RESULT 不携带权威文件哈希、files_after、恢复分类或故障归因，文件事实由 Core FILE_OBSERVED 独立记录。

## 4. 路径安全规则

统一通过 WorkspacePathResolver：验证非空字符串 → 拒绝绝对路径、Windows drive/UNC/root 路径、NTFS stream、NUL 字符及 Windows 保留设备名 → 统一斜杠解释 → resolve 实际目标 → 验证仍在 resolve 后的 workspace root 内 → 验证父目录存在。

`../` 或 `..\` 越界被拒绝；既有目标及父目录符号链接如果指向外部则被拒绝。新文件只允许创建于现存安全父目录，不自动 mkdir。安全的内部链接可用；Core 不把目录当普通文件。

## 5. 工具参数限制

- read_file：仅 path，UTF-8 读取，保留 CRLF/LF。
- write_file：仅 path/content，UTF-8 编码后 write_bytes，父目录必须存在；没有 atomic write、恢复日志或 SQLite 写入。
- patch_file：仅 path/old/new，old 非空，既有文件中必须恰好出现一次；重叠匹配也计数。零次或多次返回 FAILED，原字节不变；成功只替换一次。
- 上述参数要求准确字符串类型，拒绝多余键，不静默转换。
- run_tests：仅可选 args 数组，默认 `[]`。允许 `-q`、`-x`、`--maxfail=N`（非负十进制整数）、`--tb=short|line|no`、工作区内现存相对测试路径/pytest node id。
- 拒绝调用方提供的 `-c`、`-p`、`--basetemp`、`--rootdir`、`--confcutdir`、`--override-ini` / `-o`、其他不在白名单的选项、shell 片段和越界路径。
- 固定运行 `sys.executable -m pytest`，shell=False，cwd=Sandbox.root，timeout=60 秒；Core 固定 `-p no:cacheprovider`、`-c os.devnull`、工作区 rootdir/confcutdir。这些内部参数不由调用方配置。
- 子进程设置 PYTHONDONTWRITEBYTECODE=1、PYTEST_DISABLE_PLUGIN_AUTOLOAD=1、PYTEST_ADDOPTS 为空、UTF-8 输出；移除继承的 PYTEST_PLUGINS / PYTHONPATH。固定空配置防止工作区或上级 pytest 配置注入参数；工作区内 conftest 仍是测试代码。
- pytest 非零退出返回 FAILED；超时返回 TIMEOUT。run_tests 是工具调用，不是 Axis-Evo 最终验收。

## 6. 新增测试与关键证据

新增 3 个测试文件，共 95 个用例：91 passed、4 skipped。

- 路径：../、反斜杠 traversal、绝对 host/Windows/UNC/drive 路径、stream/device 路径、缺失父目录；Core hash/size 与 raw bytes 对比，目录拒绝。
- seed：初始字节完全复制，工作区写入后 seed 不变，复用目录/复制到 seed 内部/缺失父目录拒绝；符号链接相关用例单独判定平台权限。
- 工具：声明潜在写入、注册复用、UTF-8/CRLF/LF、创建文件、精确/零次/多次/重叠 patch、参数错误及程序错误传播。
- run_tests：真实 pytest 子进程通过/失败/超时、实际 cwd/env/command 检查、不生成 pytest/bytecode 缓存、拒绝非法输入、排除环境和父配置注入。
- `test_tool_cannot_execute_before_intent_commit`：Spy.execute 内打开真实第二 SQLite 连接，读取已提交的对应 intent，并获取/释放 BEGIN IMMEDIATE 写锁；证明 intent 可见且外部执行没有占用原连接事务。
- `test_failed_intent_insert_never_executes_tool`：真实 SQLite TEMP trigger 中 RAISE(ABORT) 拒绝 intent 插入；execute 未被调用，文件未创建，写事务回滚。
- `test_pre_tool_observation_is_reused`：计数真实 Core observer 及文件字节读取，一次 PRE + 一次 POST；两份前置 payload 与同一观察一致。没有 mock 数据库提交边界。
- 单次事件顺序及 payload 完整性按 seq 检查；工具声明/自报与实际修改不一致时，POST 仍按真实字节记录。非预期异常不伪造 TOOL_RESULT。
- `test_hard_exit_after_external_effect_preserves_crash_window_b`：真实子进程通过生产 execute_tool_call 写文件后 os._exit(70)；文件已改变，数据库仅有 PRE FILE_OBSERVED / TOOL_INTENT，无 POST / TOOL_RESULT，run 仍 RUNNING / ended_at=NULL；没有 Inspector 或恢复分类。

## 7. 实际执行命令

工作目录：`F:\嵌入式开发\毕设\axis-evo`，Python 3.12.10。

```powershell
python -m pytest -q
```

另为读取平台 skip 原因执行：

```powershell
python -m pytest -q -rs tests/unit/test_sandbox.py -k symlink
```

## 8. 完整测试结果

**154 passed、0 failed、4 skipped、0 warnings，3.74 秒，退出码 0。**

包含全部 63 个既有 Step 1 用例（未修改，全部通过），以及本步 91 个通过、4 个跳过的新用例。

## 9. 平台专属跳过

以下 4 个符号链接用例的链接创建均因当前 Windows 账户 `WinError 1314`（缺少所需特权）跳过：

- test_external_symlink_target_is_rejected
- test_external_symlink_parent_blocks_existing_and_new_files
- test_internal_symlink_is_allowed
- test_seed_copy_preserves_external_symlink_without_copying_target

诊断结果为 4 skipped、28 deselected；只有这些符号链接子用例跳过，../ 和绝对路径保护没有跳过或放宽。

## 10. 已知边界与未验证项

- 当前主机未能实际运行上述 4 个符号链接场景；生产路径解析及复制保护保持完整，仍需在允许创建符号链接的环境核验这些用例。
- 此 Sandbox 提供工作区路径与受控工具约束，没有 OS 进程隔离，也没有抵御检查后由其他进程并发置换目录/链接的原子文件操作保证。FILE_OBSERVED 记录某次读取所得字节，不声明文件长期静止。
- run_tests 固定空配置，不继承项目 pytest 配置；pytest 测试代码及工作区内 conftest 本身仍可产生副作用。mutating=false 只表达不意图修改任务业务文件，不能证明任意测试代码没有写入。
- SQLite 与文件系统是两个独立边界。Crash Window B 的存在是本步有意保留的事实状态；这里没有推断工具是否完成，没有自动恢复，也没有验证断电或存储硬件故障。
- 运行验证环境为 Windows / Python 3.12.10；本次未另行运行其他 Python 版本或 POSIX 平台。

## 11. Step 1 冻结确认

events.py、storage.py、hashing.py、task_spec.py、models.py、plugins.py、001_phase1.sql，以及所有既有测试保持原字节。仍只有 runs/events 两张核心事实表，沿用 WAL/FULL、BEGIN IMMEDIATE、数据库内 seq 分配、COMMIT 后返回、schema_version=1 与原 hard-crash run 语义。没有新增运行依赖，没有重写或重构 Step 1。

## 12. 阶段停止确认

本次停止在 Step 2，等待用户工程审查。Step 3 — Task Runner + Trace orchestration + Acceptance Engine 未开始；Inspector、Checkpoint、Recovery、Skill、Trust、fault attribution、真实 LLM loop 均未实现，无占位架构或 Git commit。
