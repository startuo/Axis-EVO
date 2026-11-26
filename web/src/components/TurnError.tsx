import { CircleAlert } from 'lucide-react';
import './turn-error.css';

const descriptions = new Map<string, string>([
  ['PROVIDER_AUTHORIZED_ACCEPTANCE_BUDGET', '本轮达到已授权的模型开销上限。请先查看已保存的改动和检查结果，再决定是否继续。'],
  ['TOOL_FAILURE_CIRCUIT_BREAKER', '同一工具重复失败，本轮已暂停。请查看失败回执，确认原因后再发起任务。'],
  ['TURN_DEADLINE', '本轮已达到运行时限。请先核对已保存的改动，再将剩余工作拆成较小的任务。'],
  ['WORKSPACE_POLICY_CHANGED', '运行期间工作区权限已发生变化。请核对当前权限，再发起新任务。'],
  ['TOOL_OUTCOME_UNKNOWN', '工具执行结果待核对。请先查看执行证据和实际文件，再决定下一步。'],
  ['FIXED_CHECKS_FAILED', '固定验收未通过。请打开检查回执，定位失败项后继续修复。'],
  ['PROVIDER_VISION_UNSUPPORTED', '所选端点和模型未启用视觉输入，请切换支持图片的 Provider。'],
  ['PROVIDER_IMAGE_STORE_INTEGRITY', '本机图片附件无法核对，请重新附加图片。'],
]);

export function TurnErrorDetails({ code }: { code: string }) {
  return <details className="turn-error-details"><summary>技术明细</summary><code>{code}</code></details>;
}

export function TurnError({ error }: { error?: string }) {
  const code = error && /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(error) ? error : null;
  const message = code ? descriptions.get(code) ?? '本轮已停止。请查看执行证据，确认原因后再继续。'
    : error || '发生未知错误，请查看本轮执行证据。';
  return (
    <div className="error-card">
      <CircleAlert size={15} aria-hidden />
      <div className="turn-error-copy">
        <span>{message}</span>
        {code && <TurnErrorDetails code={code} />}
      </div>
    </div>
  );
}
