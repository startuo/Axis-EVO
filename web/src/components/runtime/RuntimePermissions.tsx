import { ShieldCheck } from "lucide-react";
import type { RuntimeCapabilities } from "../../lib/runtime";
import { Badge } from "../ui/Primitives";

export function RuntimePermissions({ capabilities }: { capabilities: RuntimeCapabilities }) {
  return <div className="runtime-settings-page"><div className="runtime-page-heading"><h1>本地运行边界</h1><p>权限由后端配置决定。浏览器选择已登记的项目、配置和精确 Skill，不授予额外工具权限。</p></div>
    <section className="runtime-permission-table"><div className="section-heading"><h2><ShieldCheck size={16} />执行安全模式</h2><Badge>FILE-ONLY</Badge></div>
      <dl><div><dt>项目与工作区</dt><dd>仅后端预先登记的项目与 seed。浏览器不提交主机路径。</dd></div><div><dt>允许的文件工具</dt><dd>{capabilities.allowedTools.join("，") || "无可用工具"}</dd></div><div><dt>被阻止的工具</dt><dd>{capabilities.blockedTools.join("，") || "无额外列举"}。不开放任意命令、shell 或测试子进程。</dd></div><div><dt>seed 与路径</dt><dd>执行前检查路径与 seed；拒绝 symlink、junction/reparse point 及越界目标。</dd></div><div><dt>工具授权</dt><dd>同时受安全模式、精确 TRUSTED Skill 的 allowed_tools 和严格 Plan 校验约束。</dd></div><div><dt>环境与输出</dt><dd>当前安全模式不执行 run_tests，避免测试子进程继承服务凭据或无限捕获输出。</dd></div><div><dt>模型请求</dt><dd>仅调用管理员允许的公网 HTTPS 或精确本机 Gateway；单次有超时和响应预算，不自动重试。</dd></div><div><dt>停止与恢复</dt><dd>当前没有安全的工具取消或自动恢复端点。UNKNOWN 保持不确定，不能点击重试消除。</dd></div></dl>
    </section>
    {capabilities.limitations.length > 0 && <section className="runtime-limitations"><h2>后端报告的限制</h2><ul>{capabilities.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></section>}
  </div>;
}
