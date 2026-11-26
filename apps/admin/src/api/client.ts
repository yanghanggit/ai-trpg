import { createApiClient } from "@ai-trpg/api-client";
import { DEFAULT_SERVER_PORT, serverBaseUrl } from "@ai-trpg/shared";

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
 * 后台目前等同于「当前 owner 的运维台」：它和 web 用同一个用户名，
 * 因此只能看见该 owner 名下的局。换成白名单或角色时只改这里与服务端鉴权插件。
 */
export const devUsername = "demo";

export const api = createApiClient(apiBaseUrl);

api.use({
  onRequest({ request }) {
    request.headers.set("Authorization", `Bearer ${devUsername}`);
    return request;
  },
});
