# Web Workbench

Phase 4 / Step 1 提供本地浏览器工作台。Demo 是明确标注的预设示例；Core 模式通过只读桥接展示已有 SQLite 事实。工作台没有任务执行、模型连接、审批、恢复、晋升或激活端点。

## 启动

从仓库根目录运行，要求 Python 3.11+、Node.js 22.12+ 与 npm：

```powershell
python -m pip install -e .
Set-Location web
npm ci
npm run build
Set-Location ..
python -m web_api.app --port 8765 --web-root web/dist
```

打开 `http://127.0.0.1:8765`。默认进入离线 Demo，无需数据库、API Key 或模型请求。依赖安装需要访问包仓库；已构建的应用运行时不依赖 CDN。

开发时在另一终端运行 `cd web; npm run dev`，打开 `http://127.0.0.1:5173`。Vite 仅把 `/api` 代理到本地 `127.0.0.1:8765`。更改端口需同步调整明确允许的 loopback origin 和开发代理。

## 连接已有 Core 记录

在本机创建一个不提交到 Git 的配置文件，例如 `.local/workbench.json`。所有路径必须是绝对路径；数据库必须已经存在，工作区根目录必须已经存在。浏览器不能传入数据库路径。

```json
{
  "projects": [
    {
      "id": "my-project",
      "name": "My local project",
      "database": "C:/absolute/application-data/facts.sqlite3",
      "workspace_roots": ["C:/absolute/application-data/workspace"]
    }
  ],
  "allowed_origins": []
}
```

```powershell
python -m web_api.app --config .local/workbench.json --port 8765 --web-root web/dist
```

切换顶栏到 **CORE · 只读**。连接失败会显示错误，不会退回或混入 Demo 记录。未配置任何项目时显示空列表。项目和记录身份均通过固定 GET 路由传递，不充当文件路径。

## 当前边界

- 读取 `mode=ro` 的提交快照到有界内存 SQLite，再以 `query_only=ON` 调用现有 Core 读接口。不迁移、不写入事实。SQLite WAL/SHM 内部协调遵守既有逻辑只读定义。
- 不读取现场工作区文件。文件页展示已持久化的路径、hash、大小和观察原因；原始参数、工具输出、模型请求/响应及完整路径不下发。
- 未闭合且带文件目标的 invocation 会使 Core Inspector 投影显示 `UNSUPPORTED`，因为冻结 Inspector 的该路径需要现场文件读取。不会代替它推断 `EXTERNAL_STATE_CHANGED`。
- Checkpoint 核验不比较当前工作区。Recovery 只展示存储的关系元数据，明确未核验，不重新解释 source outcome。Trust / Evolution 的高层检查若需要跨越现场文件边界，也显示 `UNSUPPORTED`。
- 最大响应 1 MiB；数据库主文件与逻辑快照各限 64 MiB；最多 64 张应用表、总计 20,000 行，每 run 5,000 事件；列表最多 100 项，运行详情最多 500 条可见事件。界面区分总事件数与已加载事件数，不补造未加载事实。
- 配置草稿只包含非秘密元数据与凭据环境变量名称，保存在 React 会话内存中，刷新清除。没有 API Key 输入框或连接测试；草稿不能改变历史 Run 的 Provider 身份。
- 草稿编辑、导航、筛选、查看与复制可用；执行、上传、审批恢复、生产 Provider 测试均明确不可用。
- Web 桥接仅面向受控的本地应用数据。字段过滤不等于任意文本的完整秘密检测；不要把秘密写入任务标题、Skill 指令或其他展示元数据。

本轮没有扩大冻结 Core 的执行安全边界。既有 Windows seed junction、子进程环境继承/输出预算等执行侧限制需在独立授权里程碑处理，工作台不会调用这些执行路径。

## 验证与源码审查

```powershell
cd web
npm run typecheck
npm run lint
npm run build
```

私有审查包另外包含 `web/tests`、`web_api/tests` 与原有 Core 测试；在完整审查树中可运行 `npm test`、`npm run test:e2e`、`python -m pytest -q web_api/tests` 和 `python -m pytest -q`。浏览器测试使用已安装的 Microsoft Edge，不会下载浏览器或调用模型。公共仓库按 `AGENTS.md` 只发布测试结果，不能将缺少私有测试的公共 checkout 当作完整测试集。

当前验证见 [TEST_RESULTS.md](TEST_RESULTS.md)，设计约定见 [WORKBENCH_UI_SPEC.md](WORKBENCH_UI_SPEC.md)。本阶段没有 Windows EXE；静态前端与独立 loopback 服务为以后封装保留边界，尚未验证桌面安装包。
