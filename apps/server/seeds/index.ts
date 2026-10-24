import type { World } from "../src/game/types";
import type { KnowledgeBase } from "../src/rag";
import { BELL_MONASTERY_KNOWLEDGE, BELL_MONASTERY_WORLD } from "./dark-fantasy";

export type ContentSeed = {
  world: World;
  knowledge: KnowledgeBase;
};

/**
 * 显式内容注册表；CLI 通过名称选取，不在框架层写死故事路径。
 *
 * 一个条目 = 一个剧本（World + 与它 1:1 绑定的知识库）。`dark-fantasy` 是战役名，
 * 当前指向该战役唯一的剧本「枯钟修道院」；同一战役新增剧本时在这里加条目。
 */
export const CONTENT_SEEDS = {
  "dark-fantasy": {
    world: BELL_MONASTERY_WORLD,
    knowledge: BELL_MONASTERY_KNOWLEDGE,
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
