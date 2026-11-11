import type { ContentPack } from "../src/content-pack";
import {
  BELL_MONASTERY_KNOWLEDGE,
  BELL_MONASTERY_WORLD,
  CROW_GRAVE_KNOWLEDGE,
  CROW_GRAVE_WORLD,
} from "./dark-fantasy";

/**
 * 显式内容注册表；CLI 通过名称选取，不在框架层写死故事路径。
 *
 * 一个条目 = 一个剧本（World + 与它 1:1 绑定的知识库），条目名统一写成
 * `<战役>:<剧本>`。`dark-fantasy` 是战役名，不是内容包：它下面的每个剧本各自注册，
 * 不把战役名当第一个剧本的别名——名称与目录结构保持同一套读法。
 */
export const CONTENT_PACKS = {
  "dark-fantasy:bell-monastery": {
    world: BELL_MONASTERY_WORLD,
    knowledge: BELL_MONASTERY_KNOWLEDGE,
  },
  "dark-fantasy:crow-grave": {
    world: CROW_GRAVE_WORLD,
    knowledge: CROW_GRAVE_KNOWLEDGE,
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
