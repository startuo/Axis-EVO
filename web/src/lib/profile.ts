import type { ProviderProfile } from "./types";
const envName = /^[A-Z][A-Z0-9_]{1,63}$/;
export function validateProfile(profile: ProviderProfile): string | null {
  if (!profile.name.trim() || profile.name.length > 80)
    return "配置名称需要 1–80 个字符";
  if (!profile.modelId.trim() || profile.modelId.length > 120)
    return "请填写模型 ID";
  if (profile.protocol !== "openai-compatible")
    return "当前仅预留 OpenAI-compatible 协议";
  try {
    const endpoint = new URL(profile.endpoint);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      return "Endpoint 必须为 HTTPS，且不能包含凭据、查询参数或片段";
  } catch {
    return "请输入有效的 HTTPS Endpoint";
  }
  if (!envName.test(profile.credentialRef))
    return "凭据只填写环境变量名，例如 AXIS_MODEL_API_KEY，不填写密钥";
  if (
    !Number.isInteger(profile.timeout) ||
    profile.timeout < 1 ||
    profile.timeout > 300
  )
    return "超时需要 1–300 秒的整数";
  if (
    /sk-|Bearer\s|ghp_|gsk_|AIza/i.test(
      `${profile.name} ${profile.modelId} ${profile.endpoint}`,
    )
  )
    return "请勿在配置元数据中填写凭据";
  return null;
}
