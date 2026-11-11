import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { World } from "./game/world-definition";
import { parseWorldContent } from "./game/world-definition";
import type { KnowledgeBase, KnowledgeEntry } from "./rag";
import { knowledgeFacts, sameKnowledgeAccess } from "./rag";

/**
 * 内容包：一局游戏需要的全部内容输入。
 *
 * 框架只认这个形状，不认具体剧本；`seeds/` 是内置内容包的一个 provider，
 * 外部 JSON 与脚本注入走同一个契约。`world` 决定世界与初始状态，
 * `knowledge` 决定这个世界的知识库，两者用 `contentKey` + `contentVersion` 绑在一起。
 */
export type ContentPack = {
  world: World;
  knowledge: KnowledgeBase;
};

const knowledgeEntrySchema = z.union([
  z.string(),
  z.strictObject({
    content: z.string(),
    access: z.array(z.string()).optional(),
  }),
]);

const packSchema = z.object({
  world: z.unknown(),
  knowledge: z.record(z.string(), z.array(knowledgeEntrySchema)),
});

/**
 * 校验外部内容包。
 *
 * world 复用建局的同一条校验；knowledge 只做结构与空白检查，不做语义约束——
 * 哪些能入库属于内容自己的边界。
 */
export function parseContentPack(value: unknown): ContentPack {
  const parsed = packSchema.parse(value);
  const knowledge: Record<string, KnowledgeEntry[]> = {};
  for (const [rawCategory, items] of Object.entries(parsed.knowledge)) {
    const key = rawCategory.trim();
    if (key.length === 0) {
      throw new Error("内容包的 knowledge 分类名不能为空");
    }
    if (knowledge[key] !== undefined) {
      throw new Error(`内容包的 knowledge 分类重复: ${key}`);
    }
    const entries: KnowledgeEntry[] = [];
    const byContent = new Map<string, KnowledgeEntry>();
    for (const item of items) {
      const entry: KnowledgeEntry =
        typeof item === "string"
          ? item.trim()
          : {
              content: item.content.trim(),
              ...(item.access ? { access: item.access.map((tag) => tag.trim()) } : {}),
            };
      const content = typeof entry === "string" ? entry : entry.content;
      if (content.length === 0) {
        throw new Error(`内容包的 knowledge 条目不能为空: ${key}`);
      }
      const previous = byContent.get(content);
      if (previous) {
        const previousAccess = typeof previous === "string" ? [] : (previous.access ?? []);
        const access = typeof entry === "string" ? [] : (entry.access ?? []);
        if (!sameKnowledgeAccess(previousAccess, access)) {
          throw new Error(`同一知识出现不同访问门槛: ${content.slice(0, 24)}…`);
        }
        continue;
      }
      byContent.set(content, entry);
      entries.push(entry);
    }
    knowledge[key] = entries;
  }
  if (Object.keys(knowledge).length === 0) {
    throw new Error("内容包的 knowledge 不能为空");
  }

  const world = parseWorldContent(parsed.world);
  // 全量校验正文重复、空标签与同文不同门槛；同时保证每个门槛至少有一个 actor 持有人，
  // 否则这条知识永远读不到（通常是标签拼写错误）。
  const facts = knowledgeFacts(knowledge);
  const actorTags = new Set(world.actors.flatMap((actor) => actor.knowledgeAccess ?? []));
  const unreachable = [...new Set(facts.flatMap((fact) => fact.access))].filter(
    (tag) => !actorTags.has(tag),
  );
  if (unreachable.length > 0) {
    throw new Error(`知识访问标签没有任何 actor 持有: ${unreachable.join(", ")}`);
  }
  return { world, knowledge };
}

/** 从 JSON 文件读取内容包；校验与内联注入完全一致。 */
export async function readContentPackFile(path: string): Promise<ContentPack> {
  const raw = await readFile(path, "utf8");
  return parseContentPack(JSON.parse(raw) as unknown);
}
