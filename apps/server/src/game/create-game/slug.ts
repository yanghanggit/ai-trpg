import { GameError } from "../errors";
import type { CreateGameInput } from "./types";

/**
 * 建局时的 slug 规则。
 *
 * 内容层的不变量（名字、key 唯一性等）在 `parseWorldContent` 里已经全部跑过，这里只剩
 * 「这一局的地址怎么起名」：显式 slug 规范化，隐式 slug 追加 gameId 前缀避免跨局重名。
 */

function slugify(value: string): string {
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
