import type { ContentPack } from "../src/content-pack";
import { BELL_MONASTERY_KNOWLEDGE, BELL_MONASTERY_WORLD } from "./dark-fantasy";

/**
 * 显式内容注册表；CLI 通过名称选取，不在框架层写死故事路径。
 *
 * 一个条目 = 一个剧本（World + 与它 1:1 绑定的知识库）。`dark-fantasy` 是战役名，
 * 当前指向该战役唯一的剧本「枯钟修道院」；同一战役新增剧本时在这里加条目。
 */
export const CONTENT_PACKS = {
  "dark-fantasy": {
    world: BELL_MONASTERY_WORLD,
    knowledge: BELL_MONASTERY_KNOWLEDGE,
  },
} as const satisfies Record<string, ContentPack>;

/** 按名称读取内置内容包；未知名称直接报错。 */
export function getContentPack(name: string): ContentPack {
  const pack = CONTENT_PACKS[name as keyof typeof CONTENT_PACKS];
  if (!pack) {
    throw new Error(`未知内容包: ${name}；可用: ${Object.keys(CONTENT_PACKS).join(", ")}`);
  }
  return pack;
}
