/**
 * 模型上下文窗口推算与 Token 数量格式化工具。
 * 当后端协议（M7.1）尚未显式下发 `contextWindow` 时，按常见模型名称推算参考上限，
 * 并在 UI 详情中诚实标注「参考窗口」；后端接入真实字段后自动切换为精确上限。
 */

export interface ContextWindowInfo {
  limit: number;
  estimated: boolean;
}

export function resolveContextWindow(modelId?: string | null, explicitLimit?: number): ContextWindowInfo {
  if (typeof explicitLimit === 'number' && Number.isFinite(explicitLimit) && explicitLimit > 0) {
    return { limit: explicitLimit, estimated: false };
  }
  const m = (modelId ?? '').toLowerCase();
  if (/gemini[-_ ]?(1\.5|2|3)/.test(m)) return { limit: 1_000_000, estimated: true };
  if (/claude|gpt-5|gpt-6|\bo3\b|\bo4\b|sol/.test(m)) return { limit: 200_000, estimated: true };
  if (/qwen|deepseek|gpt-4|glm|kimi|moonshot|llama|mistral/.test(m)) return { limit: 128_000, estimated: true };
  return { limit: 128_000, estimated: true };
}

export function formatTokenCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m >= 10 || Number.isInteger(m) ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `${k >= 100 || Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return String(Math.round(n));
}

export function computeContextUsage(
  tokenUsage?: { input: number; output: number } | null,
  modelId?: string | null,
  explicitLimit?: number,
) {
  const input = Math.max(0, tokenUsage?.input ?? 0);
  const output = Math.max(0, tokenUsage?.output ?? 0);
  const total = input + output;
  const { limit, estimated } = resolveContextWindow(modelId, explicitLimit);
  const ratio = limit > 0 ? Math.min(1, total / limit) : 0;
  const percent = ratio * 100;
  const tier: 'normal' | 'warn' | 'danger' = percent >= 90 ? 'danger' : percent >= 70 ? 'warn' : 'normal';
  return { input, output, total, limit, estimated, ratio, percent, tier };
}
