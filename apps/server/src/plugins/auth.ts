/**
 * 开发期身份：`Authorization: Bearer <username>`。
 *
 * 目前没有登录与令牌体系，`agent:api` 与服务端都在开发机上跑；把用户名当令牌用，
 * 让两条入口拿到同一个「局主」。这不适合生产——上线前换成真正的会话令牌，
 * 只改这一个文件。
 */

import { timingSafeEqual } from "node:crypto";
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
/**
 * 请求头里自称的那个用户名：`Authorization: Bearer <name>`，SSE 还接受 `?token=<name>`。
 *
 * 它只解析、不校验——口令守卫要在查库之前就知道「这人自称运维」，所以单独成一条。
 */
export function claimedUsername(
  request: FastifyRequest,
  options: { allowQueryToken?: boolean } = {},
): string {
  const header = request.headers.authorization;
  const match = header === undefined ? null : /^Bearer\s+(.+)$/i.exec(header.trim());
  const fromHeader = match?.[1]?.trim() ?? "";
  const fromQuery =
    options.allowQueryToken === true && typeof request.query === "object" && request.query !== null
      ? String((request.query as { token?: unknown }).token ?? "").trim()
      : "";
  return fromHeader.length > 0 ? fromHeader : fromQuery;
}

function sameSecret(given: string, expected: string): boolean {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  // 长度不同时 timingSafeEqual 会抛：先比长度，再比内容（避免按字节提前返回）。
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * 后台口令：配了 `ADMIN_TOKEN` 之后，运维身份还要证明自己知道口令。
 *
 * 这不是登录，是一道共享密码——为了让「知道用户名 `admin`」不再等于「拿到后台」。
 * 只有运维身份受它约束：玩家端照旧只带 `Authorization`，不必多一个头。
 */
export function assertAdminToken(request: FastifyRequest, expected: string | undefined): void {
  if (expected === undefined || expected.length === 0) {
    return;
  }
  const header = request.headers["x-admin-token"];
  const given = (Array.isArray(header) ? header[0] : header)?.trim() ?? "";
  if (given.length === 0) {
    throw new HttpError(
      401,
      "unauthorized",
      "缺少 x-admin-token：服务端配了 ADMIN_TOKEN，客户端要在 VITE_ADMIN_TOKEN 里给同一个值",
    );
  }
  if (!sameSecret(given, expected)) {
    throw new HttpError(401, "unauthorized", "x-admin-token 与服务端 ADMIN_TOKEN 不一致");
  }
}

export async function requireUser(
  db: Database,
  request: FastifyRequest,
  options: { allowQueryToken?: boolean } = {},
): Promise<AuthUser> {
  const username = claimedUsername(request, options);
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
