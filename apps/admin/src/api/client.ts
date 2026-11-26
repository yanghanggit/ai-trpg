import { createApiClient } from "@ai-trpg/api-client";
import { DEFAULT_ADMIN_USERNAME, DEFAULT_SERVER_PORT, serverBaseUrl } from "@ai-trpg/shared";

/**
 * 服务端地址：优先用 `.env` 的 VITE_API_BASE_URL；未配置时跟随页面主机名。
 * 后台只监听 127.0.0.1，所以缺省就落在同一台机器的服务端上。
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
 * 后台固定用运维身份 `admin`——它在服务端名单里，能看全库与机器级读数。
 * 换成真登录时改这里与服务端 `plugins/auth.ts`：把常量换成会话里的令牌。
 */
export const adminUsername = import.meta.env.VITE_ADMIN_USERNAME?.trim() || DEFAULT_ADMIN_USERNAME;

export const api = createApiClient(apiBaseUrl);

api.use({
  onRequest({ request }) {
    request.headers.set("Authorization", `Bearer ${adminUsername}`);
    return request;
  },
});
