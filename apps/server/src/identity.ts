/**
 * 开发期身份与唯一的「谁是运维」判定。
 *
 * 这里只有两件事：库里的两行用户（玩家与运维），以及一张写死的名单。名单暂时等价于角色——
 * `admin` 能碰任意一局、能读机器级读数，`demo` 只能碰自己名下的局。真正的角色体系要等
 * 会话令牌落地后换成 `users.role`，那时删掉名单，其余调用点不动。
 *
 * 名字来自 `@ai-trpg/shared`：客户端也要用同一份，不能各写一份。
 */

import { DEFAULT_ADMIN_USERNAME, DEFAULT_PLAYER_USERNAME } from "@ai-trpg/shared";

/** 玩家身份：局都归它，web 与两个 CLI 默认用它。 */
export const DEMO_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  username: DEFAULT_PLAYER_USERNAME,
  displayName: "演示用户",
} as const;

/**
 * 运维身份：不拥有任何局，靠名单越过 owner 检查。
 *
 * id 排在 `demo` 之后只是让它一眼可与玩家区分，没有别的含义。
 */
export const ADMIN_USER = {
  id: "00000000-0000-4000-8000-000000000002",
  username: DEFAULT_ADMIN_USERNAME,
  displayName: "运维",
} as const;

/** 开发环境要 seed 的两个身份；顺序不影响任何判定。 */
export const SEED_USERS = [ADMIN_USER, DEMO_USER] as const;

/**
 * 运维名单。
 *
 * 刻意不用 `users.role`：现在没有登录，一张写死的名单比一列要迁移的字段诚实得多。
 */
export function isAdmin(username: string): boolean {
  return username === DEFAULT_ADMIN_USERNAME;
}
