import { createApiClient } from "@ai-trpg/api-client";
import { DEFAULT_PLAYER_USERNAME, DEFAULT_SERVER_PORT, serverBaseUrl } from "@ai-trpg/shared";

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

/**
 * 开发期身份：服务端把 `Authorization: Bearer <username>` 当登录用。
 *
 * 玩家端固定用玩家身份 `demo`；接真登录时只改这里——把常量换成会话里的 token，
 * 其余请求代码不动。
 */
export const playerUsername =
  import.meta.env.VITE_PLAYER_USERNAME?.trim() || DEFAULT_PLAYER_USERNAME;

export const api = createApiClient(apiBaseUrl);

api.use({
  onRequest({ request }) {
    request.headers.set("Authorization", `Bearer ${playerUsername}`);
    return request;
  },
});
