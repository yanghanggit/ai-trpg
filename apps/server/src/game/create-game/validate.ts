import { GameError } from "../errors";
import type { World } from "../world-definition";
import type { CreateGameInput } from "./types";

/**
 * 建局前的校验：slug 规则与内容层 key 的唯一性。
 *
 * key 是内容引用物品/角色的唯一方式（行为与内容判定都按 key 找），重复会静默指向
 * 另一件东西，所以宁可建局失败也不猜。这些检查在写库之前跑，失败时事务还没开始。
 */

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** 显式 slug 只做规范化，隐式 slug 追加 gameId 前缀避免跨局重名。 */
export function resolveSlug(input: CreateGameInput, gameId: string, gameName: string): string {
  const requested = input.slug?.trim();
  const base = slugify(requested ?? gameName);
  if (requested !== undefined && base.length === 0) {
    throw new GameError("invalid_action", `slug 不能为空或只包含非 ASCII 字符: ${requested}`);
  }
  return requested ? base : `${base || "game"}-${gameId.slice(0, 8)}`;
}

/** 物品 key 必须全局唯一；行为与内容判定都按 key 引用物品。 */
export function assertUniqueItemKeys(world: World): void {
  const seen = new Set<string>();
  const all = [
    ...world.stages.flatMap((stage) =>
      (stage.anchors ?? []).flatMap((anchor) => anchor.items ?? []),
    ),
    ...world.actors.flatMap((actor) => actor.inventory),
  ];
  for (const item of all) {
    if (item.key.trim().length === 0) {
      throw new GameError("invalid_state", "物品 key 不能为空");
    }
    if (seen.has(item.key)) {
      throw new GameError("invalid_state", `重复的物品 key: ${item.key}`);
    }
    seen.add(item.key);
  }
}

/** actor key 是内容层引用角色的唯一方式，必须全局唯一。 */
export function assertUniqueActorKeys(world: World): void {
  const seen = new Set<string>();
  for (const actor of world.actors) {
    if (seen.has(actor.key)) {
      throw new GameError("invalid_state", `重复的 actor key: ${actor.key}`);
    }
    seen.add(actor.key);
  }
}
