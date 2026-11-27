import { createApiClient } from "@ai-trpg/api-client";
import { DEFAULT_ADMIN_USERNAME, DEFAULT_SERVER_PORT, serverBaseUrl } from "@ai-trpg/shared";

/**
 * 服务端地址：优先用 `.env` 的 VITE_API_BASE_URL；未配置时跟随页面主机名。
 *
 * 跟随主机名是后台能走局域网的关键：用局域网 IP 打开页面时，请求就去同一台机器的
 * 服务端端口，而不是访问者自己的本机回环地址。
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

/**
 * 后台口令：与服务端 `ADMIN_TOKEN` 是同一个值，走 `x-admin-token` 头。
 *
 * 空着就只有「用户名即令牌」——本机用没问题，但后台一旦能被局域网访问，那道墙就只剩 Wi-Fi。
 * 配了 `ADMIN_TOKEN` 却不填这里时，每条请求都会 401 并说明原因。
 */
const adminToken = import.meta.env.VITE_ADMIN_TOKEN?.trim() ?? "";

export const api = createApiClient(apiBaseUrl);

api.use({
  onRequest({ request }) {
    request.headers.set("Authorization", `Bearer ${adminUsername}`);
    if (adminToken.length > 0) {
      request.headers.set("x-admin-token", adminToken);
    }
    return request;
  },
});
