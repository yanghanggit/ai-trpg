/**
 * 开发期身份：`Authorization: Bearer <username>`。
 *
 * 目前没有登录与令牌体系，`agent:api` 与服务端都在开发机上跑；把用户名当令牌用，
 * 让两条入口拿到同一个「局主」。这不适合生产——上线前换成真正的会话令牌，
 * 只改这一个文件。
 */

import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Database } from "../db/pool";
import { users } from "../db/schema";
import { HttpError } from "../http-error";
import { isAdmin } from "../identity";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
};

/**
 * 从请求头取身份；缺失、格式错误或用户不存在都算未登录。
 *
 * `allowQueryToken` 只为 SSE 开：浏览器的 `EventSource` 不能自带请求头，
 * 所以流式入口额外接受 `?token=<username>`。仍然是开发期身份，上线换会话令牌时一并收掉。
 */
export async function requireUser(
  db: Database,
  request: FastifyRequest,
  options: { allowQueryToken?: boolean } = {},
): Promise<AuthUser> {
  const header = request.headers.authorization;
  const match = header === undefined ? null : /^Bearer\s+(.+)$/i.exec(header.trim());
  const fromHeader = match?.[1]?.trim() ?? "";
  const fromQuery =
    options.allowQueryToken === true && typeof request.query === "object" && request.query !== null
      ? String((request.query as { token?: unknown }).token ?? "").trim()
      : "";
  const username = fromHeader.length > 0 ? fromHeader : fromQuery;
  if (username.length === 0) {
    throw new HttpError(
      401,
      "unauthorized",
      options.allowQueryToken === true
        ? "缺少 Authorization: Bearer <username>（或 ?token=<username>）"
        : "缺少 Authorization: Bearer <username>",
    );
  }

  const [row] = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (!row) {
    throw new HttpError(401, "unauthorized", `用户不存在: ${username}`);
  }
  return row;
}

/**
 * 机器级读数与运维入口的守卫。
 *
 * 它比 `requireGameAccess` 更早一步：那里判「这一局归不归你」，这里判「你是不是运维」。
 * 名单是写死的（见 `identity.ts`），等真登录体系落地时改成查 `users.role` 即可。
 */
export async function requireAdmin(db: Database, request: FastifyRequest): Promise<AuthUser> {
  const user = await requireUser(db, request);
  if (!isAdmin(user.username)) {
    throw new HttpError(403, "forbidden", "该入口只对运维身份开放");
  }
  return user;
}
