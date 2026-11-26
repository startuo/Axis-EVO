# Axis-Evo Windows Preview M7.1

安装程序面向 Windows 10/11 x64，版本为 **0.1.0 Preview**。安装包未签名。下载后可用随包的 SHA-256 校验文件。

## 安装和使用

1. 运行 `Axis-Evo-0.1.0-Preview-M7.1-Setup.exe`。安装范围为当前 Windows 用户，默认程序位置为 `%LocalAppData%\Programs\Axis-Evo`。可在安装时选择其他目录。
2. 从开始菜单打开 **Axis-Evo**。启动窗口在本机随机可用的回环端口运行服务，工作台在默认系统浏览器中打开。可从启动窗口再次点击「打开工作台」。
3. 在「设置 → 工作区」输入已有文件夹的绝对路径，选择权限并确认授权。在「设置 → 模型连接」配置模型，再从 Work 发起任务。内置 DeepSeek 登记使用 Windows 凭据管理器。
4. 关闭 **Axis-Evo 启动窗口**或点击「退出 Axis-Evo」可停止服务。单独关掉浏览器标签页时，本地服务继续运行。

安装包包含应用和 CPython。启动基本工作台无需安装 Python、Node.js、Git、Docker 或 Edge 扩展。

- 隔离命令和固定项目验证需要本机 Docker Desktop 的 Linux 引擎和已授权镜像。Docker 不可用时，界面显示禁用状态。[Docker Desktop Windows 安装指南](https://docs.docker.com/desktop/setup/install/windows-install/)
- Edge 扩展可选。可在 Edge 手动加载安装目录内的 `app/browser/edge-extension`，然后在「技能 → Edge 浏览器」查看连接状态和已附加标签页。
- 自定义 Provider、代理路由和本地模型网关使用管理员配置文件 `%LocalAppData%\Axis-Evo\Preview\network.json`，使用受支持的配置引用。普通 DeepSeek 设置直接在界面完成。[Provider 连接约定](AGENT_PROVIDER.md)

## 数据和升级

数据位于 `%LocalAppData%\Axis-Evo\Preview\data`，启动失败日志位于同级的 `startup.log`。工作区文件保存在原目录。首次启动复用 Runtime 初始化及校验，已有数据库损坏或结构不匹配时停止启动。

覆盖安装前先关闭启动窗口。卸载入口在 Windows「已安装的应用」或「开始 → Axis-Evo → 卸载 Axis-Evo」。卸载只移除安装时登记的程序文件与快捷方式，保留用户数据、工作区、凭据和未登记的文件。开发工作树与安装版使用不同的数据目录。需要迁移时使用明确的备份流程。[存储和启动约定](WORKBENCH_SETUP.md)

从正式 M6.1 或 M7 原路径覆盖升级时，安装器按旧版清单清理当前包已移除的前端资源。旧文件被其他程序占用时，安装器提示关闭占用程序并重试，原安装身份仍可用于重试。

## 构建和复核

在 Windows x64 开发机上准备普通 CPython 3.11+、`uv`、Node.js 22.12+、npm，以及 Windows 提供的 .NET Framework 4.x C# 编译器。执行以下命令。

```powershell
python desktop/windows/build.py
```

产物默认写到 `.local/m7.1-build`，包含 Setup.exe 和 SHA-256。可用 `--output` 选择新的目录。构建固定 CPython 3.13.17 x64 便携运行库、NSIS 3.11 和带 SHA-256 的 Windows Python 依赖，并编译前端与启动器。重复构建可在同一工作树执行 `--skip-npm-ci`，构建器核对已有流水凭据、Node、锁文件以及依赖树后仍运行生产构建与许可证收集。[CPython 发行记录](https://www.python.org/downloads/release/python-31317/) / [NSIS 源分发](https://sourceforge.net/projects/nsis/files/NSIS%203/3.11/)

图标源为轻量透明标徽 `web/public/axis-mark-light.png`，SHA-256 为 `76ec46b84f59857e3df68751353ad98774998866ee67925b8bf5d78d38b4256f`。Windows 构建生成多尺寸图标。许可材料位于安装目录内的 `app/licenses`、`runtime/packages` 和相应组件目录。[版本与验证摘要](../CHANGELOG.md)
