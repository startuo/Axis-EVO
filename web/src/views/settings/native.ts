import type { BootstrapState } from '@axis/protocol';

export interface ModelMetadata {
  id: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export type ProviderCatalog = NonNullable<BootstrapState['providerCatalog']>;

export const workspaceModes = ['read-only', 'workspace-write'] as const;

const DIAGNOSTICS: Record<string, string> = {
  fake_ip_tun_blocked: 'DNS 返回了 Fake-IP（198.18.0.0/15）。请为模型域名配置直连解析，或选择已授权的本机代理。',
  tls_error: 'TLS 握手或证书校验失败。请核对端点域名和代理配置。',
  auth_401: '端点拒绝了凭据（HTTP 401）。请核对密钥、套餐和授权端点。',
  timeout: '连接超过设定时间。请检查网络或代理，也可以增加连接超时。',
  dns_error: '无法解析端点域名。请检查域名和 DNS 解析。',
  endpoint_policy: '端点或代理未通过本机授权检查。请核对启动配置与连接设置。',
  credentials: '此凭据引用尚未配置有效密钥。请检查服务端凭据配置。',
  connection_error: '无法连接到端点。请检查网络和代理是否可用。',
  provider_response: '端点未返回可用响应。请核对接口协议、模型 ID 和账号权限。',
  invalid_provider_profile: '配置未通过本机校验。请核对已授权端点、凭据引用和代理选项。',
  provider_integrity: '当前配置无法用于连接。请重新载入配置并核对端点授权。',
};

export function diagnosticMessage(code: unknown): string | undefined {
  return typeof code === 'string' ? DIAGNOSTICS[code.toLowerCase()] : undefined;
}

export function diagnosticFromError(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? diagnosticMessage(error.code) : undefined;
}
