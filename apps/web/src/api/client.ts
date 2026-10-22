import { createApiClient } from "@ai-trpg/api-client";
import { DEFAULT_SERVER_PORT, serverBaseUrl } from "@ai-trpg/shared";

/**
 * 服务端地址：优先用 `.env` 的 VITE_API_BASE_URL；未配置时跟随页面主机名，
 * 这样用局域网 IP 打开页面就会请求同一台机器的服务端。
 */
function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) {
    return configured;
  }
  return serverBaseUrl(DEFAULT_SERVER_PORT, window.location.hostname);
}

export const apiBaseUrl = resolveApiBaseUrl();

export const api = createApiClient(apiBaseUrl);
