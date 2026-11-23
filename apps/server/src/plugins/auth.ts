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

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
};

/** 从请求头取身份；缺失、格式错误或用户不存在都算未登录。 */
export async function requireUser(db: Database, request: FastifyRequest): Promise<AuthUser> {
  const header = request.headers.authorization;
  if (header === undefined) {
    throw new HttpError(401, "unauthorized", "缺少 Authorization: Bearer <username>");
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const username = match?.[1]?.trim() ?? "";
  if (username.length === 0) {
    throw new HttpError(401, "unauthorized", "缺少 Authorization: Bearer <username>");
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
