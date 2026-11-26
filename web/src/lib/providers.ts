/**
 * 模型提供商预设、端点归类与模型分组辅助函数（供设置页多模型接入与输入舱模型选择器共用）。
 */
import type { Profile, ReasoningEffort } from '@axis/protocol';

export const DEFAULT_ENDPOINT = 'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1';

export const PROVIDER_PRESETS = [
  { label: '千问 Token Plan', endpoint: DEFAULT_ENDPOINT },
  { label: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1' },
  { label: 'OpenAI', endpoint: 'https://api.openai.com/v1' },
  { label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1' },
  { label: '硅基流动', endpoint: 'https://api.siliconflow.cn/v1' },
  { label: '本地 Ollama', endpoint: 'http://127.0.0.1:11434/v1' },
];

const PROVIDER_HOSTS: Record<string, string> = {
  'token-plan.maas.qianwenaiapi.com': '千问 Token Plan',
  'dashscope.aliyuncs.com': '百炼 / DashScope',
  'api.deepseek.com': 'DeepSeek',
  'api.openai.com': 'OpenAI',
  'api.anthropic.com': 'Anthropic',
  'openrouter.ai': 'OpenRouter',
  'api.siliconflow.cn': '硅基流动',
  'generativelanguage.googleapis.com': 'Google Gemini',
  'api.moonshot.cn': 'Moonshot / Kimi',
  'open.bigmodel.cn': '智谱 GLM',
};

/** 标准化端点 URL（去首尾空白与末尾斜杠），用于同端点分组与去重比对。 */
export function normalizeEndpoint(url: string): string {
  const value = url.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(value);
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.href.replace(/\/$/, '');
  } catch {
    return value;
  }
}

/** 将端点 URL 映射为简洁可读的提供商标签。 */
export function endpointDisplayName(endpoint: string): string {
  const norm = normalizeEndpoint(endpoint);
  try {
    const parsed = new URL(norm);
    const host = parsed.hostname;
    if ((host === '127.0.0.1' || host === 'localhost') && parsed.port === '11434') return '本地 Ollama';
    if ((host === '127.0.0.1' || host === 'localhost') && parsed.port === '9') return '离线演示';
    return (Object.hasOwn(PROVIDER_HOSTS, host) ? PROVIDER_HOSTS[host] : undefined) ?? parsed.host;
  } catch {
    return norm || '自定义端点';
  }
}

/** 根据模型 ID 推断轻量厂商标签（用于多选列表快速辨识）。 */
export function inferModelVendor(modelId: string): string | null {
  const m = modelId.toLowerCase();
  if (m.includes('deepseek')) return 'DeepSeek';
  if (m.includes('qwen') || m.includes('qwq')) return 'Qwen';
  if (m.includes('claude')) return 'Claude';
  if (m.includes('gpt') || /^o[134](-|$)/.test(m)) return 'OpenAI';
  if (m.includes('gemini')) return 'Gemini';
  if (m.includes('glm')) return 'GLM';
  if (m.includes('kimi') || m.includes('moonshot')) return 'Kimi';
  if (m.includes('llama')) return 'Llama';
  if (m.includes('mistral') || m.includes('codestral')) return 'Mistral';
  if (m.includes('minimax')) return 'MiniMax';
  return null;
}

export interface ProfileGroup {
  key: string;
  endpoint: string;
  label: string;
  profiles: Profile[];
}

/** 按标准化端点对已接入模型分组，保留首次出现顺序。 */
export function groupProfilesByEndpoint(profiles: Profile[]): ProfileGroup[] {
  const map = new Map<string, ProfileGroup>();
  for (const p of profiles) {
    const key = normalizeEndpoint(p.endpoint);
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        endpoint: p.endpoint,
        label: endpointDisplayName(p.endpoint),
        profiles: [],
      };
      map.set(key, group);
    }
    group.profiles.push(p);
  }
  return [...map.values()];
}

export function defaultProfileEffort(profile?: Profile | null): ReasoningEffort {
  return profile?.reasoningEffort ?? (import.meta.env.MODE === 'test' ? 'medium' : 'off');
}
