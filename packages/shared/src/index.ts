/**
 * 跨端共享的静态事实：服务标识与本地开发端口默认值。
 *
 * 准入判据是「第一次请求之前两端必须一致」：需要出现在响应里的领域词表（属性名、
 * 道具大类这类文案）走契约下发，不要搬进来——判据与后果见 `docs/architecture.md`
 * 的「包职责」。
 *
 * 端口默认值只写在这里；`.env` 可以覆盖，但其它代码不得再出现字面量
 * （`pnpm lint` 会运行 scripts/check-ports.mjs 检查）。
 */

export const SERVICE_NAME = "ai-trpg-server";
export const APP_VERSION = "0.1.0";
export const API_VERSION = "v1";

/** 服务端监听端口的默认值。 */
export const DEFAULT_SERVER_PORT = 8787;

/** Web dev server 端口的默认值。 */
export const DEFAULT_WEB_PORT = 5373;

/** Mock 目录（页面 × 状态）的 dev server 端口默认值；与正式端分开进程。 */
export const DEFAULT_MOCK_PORT = 5374;

/** 管理后台的 dev server 端口默认值；只监听本机。 */
export const DEFAULT_ADMIN_PORT = 5375;

export function serverBaseUrl(port: number = DEFAULT_SERVER_PORT, host = "localhost"): string {
  return `http://${host}:${port}`;
}

export function webBaseUrl(port: number = DEFAULT_WEB_PORT, host = "localhost"): string {
  return `http://${host}:${port}`;
}
