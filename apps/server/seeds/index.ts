import type { World } from "../src/game/types";
import type { KnowledgeBase } from "../src/rag";
import { DARK_FANTASY_WORLD } from "./dark-fantasy";
import { DARK_FANTASY_KNOWLEDGE } from "./knowledge/dark-fantasy";

export type ContentSeed = {
  world: World;
  knowledge: KnowledgeBase;
};

/** 显式内容注册表；CLI 通过名称选取，不在框架层写死故事路径。 */
export const CONTENT_SEEDS = {
  "dark-fantasy": {
    world: DARK_FANTASY_WORLD,
    knowledge: DARK_FANTASY_KNOWLEDGE,
  },
} as const satisfies Record<string, ContentSeed>;

export type ContentSeedName = keyof typeof CONTENT_SEEDS;

/** 按名称读取内容 seed；未知名称直接报错。 */
export function getContentSeed(name: string): ContentSeed {
  const seed = CONTENT_SEEDS[name as ContentSeedName];
  if (!seed) {
    throw new Error(`未知内容 seed: ${name}；可用: ${Object.keys(CONTENT_SEEDS).join(", ")}`);
  }
  return seed;
}
