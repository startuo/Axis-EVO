# Changelog

## Unreleased — release stabilization on 0.1.0 Preview

- 明确区分新 store 准备、已有 store 启动和离线副本维护；生产启动验证完整构建资产与安全 SQLite 能力。
- 修正 HTTPS 响应定界与资源释放，新增显式管理员 CONNECT 路由及不可变实际传输配置绑定。
- 拒绝晚到演化 ACK 覆盖已切换的选择；设置与演化面板按需加载，保持既有工作台首屏。
- 增加可公开运行的离线安装 smoke；完整私有回归和故障材料仍保留本地。
- 检查点额外核对目录名称集合，避免时间戳未变时遗漏新增文件；拒绝尚未通过进程清理验证的 Microsoft Store Python Runtime。

## Version policy

当前 Python/frontend metadata 均为0.1.0，维持 Preview。建议后续通过完整受限使用验收后再考虑 `0.2.0-beta.1`，修复阻断项后考虑 `0.2.0-rc.1`。`1.0.0` 需要单独发布批准与明确支持矩阵，不能靠改版本号取得。

0.x 版本不承诺任意数据库或配置的向前/向后兼容。已有事实不原地重写；变更须有显式迁移、复制验证、已知限制和回退说明。修复不得改变历史事件、旧 Gate policy 或 UNKNOWN 语义。新不兼容功能提高 minor，兼容修复提高 patch；预发布标识体现证据阶段。Git tag/下载发布另行审批，普通工程 push 不等于发布。
