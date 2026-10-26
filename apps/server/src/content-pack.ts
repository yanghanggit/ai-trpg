import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { World } from "./game/types";
import { parseWorldContent } from "./game/world-content";
import type { KnowledgeBase } from "./rag";

/**
 * 内容包：一局游戏需要的全部内容输入。
 *
 * 框架只认这个形状，不认具体剧本；`seeds/` 是内置内容包的一个 provider，
 * 外部 JSON 与脚本注入走同一个契约。`world` 决定世界与初始状态，
 * `knowledge` 决定这个世界的公共知识，两者用 `contentKey` + `contentVersion` 绑在一起。
 */
export type ContentPack = {
  world: World;
  knowledge: KnowledgeBase;
};

const packSchema = z.object({
  world: z.unknown(),
  knowledge: z.record(z.string(), z.array(z.string())),
});

/**
 * 校验外部内容包。
 *
 * world 复用建局的同一条校验；knowledge 只做结构与空白检查，不做语义约束——
 * 哪些能入库属于内容自己的边界。
 */
export function parseContentPack(value: unknown): ContentPack {
  const parsed = packSchema.parse(value);
  const knowledge: Record<string, string[]> = {};
  for (const [category, items] of Object.entries(parsed.knowledge)) {
    const key = category.trim();
    if (key.length === 0) {
      throw new Error("内容包的 knowledge 分类名不能为空");
    }
    if (knowledge[key] !== undefined) {
      throw new Error(`内容包的 knowledge 分类重复: ${key}`);
    }
    const cleaned = items.map((item) => item.trim());
    if (cleaned.some((item) => item.length === 0)) {
      throw new Error(`内容包的 knowledge 条目不能为空: ${key}`);
    }
    knowledge[key] = [...new Set(cleaned)];
  }
  if (Object.keys(knowledge).length === 0) {
    throw new Error("内容包的 knowledge 不能为空");
  }
  return { world: parseWorldContent(parsed.world), knowledge };
}

/** 从 JSON 文件读取内容包；校验与内联注入完全一致。 */
export async function readContentPackFile(path: string): Promise<ContentPack> {
  const raw = await readFile(path, "utf8");
  return parseContentPack(JSON.parse(raw) as unknown);
}
