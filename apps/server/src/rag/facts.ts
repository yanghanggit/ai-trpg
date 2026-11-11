import type { KnowledgeAccess, KnowledgeBase, KnowledgeFact } from "./types";

/** 两组标签是否等价（顺序无关，重复已在上游消掉）。 */
export function sameKnowledgeAccess(a: KnowledgeAccess, b: KnowledgeAccess): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(a);
  return b.every((tag) => set.has(tag));
}

/**
 * 访问判定：空门槛 = 常识；否则任一标签命中即可。
 *
 * 必须与 `searchDocuments` 的 SQL 条件保持同一语义：这里是评测、CLI 与用例自检的
 * 单一判定，避免文档里写一套、数据库查另一套。
 */
export function canReadKnowledge(access: KnowledgeAccess, actorAccess: KnowledgeAccess): boolean {
  return access.length === 0 || access.some((tag) => actorAccess.includes(tag));
}

/**
 * 展开并校验知识库。
 *
 * 正文全局唯一是硬约束：collection 按 `content_hash` 去重，同一段正文配两个门槛
 * 会静默覆盖成一条。同文同门槛的重复条目直接丢弃；同文不同门槛视为内容错误。
 */
export function knowledgeFacts(knowledgeBase: KnowledgeBase): KnowledgeFact[] {
  const facts: KnowledgeFact[] = [];
  const seen = new Map<string, KnowledgeFact>();
  for (const [rawCategory, entries] of Object.entries(knowledgeBase)) {
    const category = rawCategory.trim();
    if (category.length === 0) {
      throw new Error("知识分类名不能为空");
    }
    for (const entry of entries) {
      const content = (typeof entry === "string" ? entry : entry.content).trim();
      if (content.length === 0) {
        throw new Error(`知识条目不能为空: ${category}`);
      }
      const rawAccess = typeof entry === "string" ? [] : (entry.access ?? []);
      const access = [...new Set(rawAccess.map((tag) => tag.trim()))];
      if (access.some((tag) => tag.length === 0)) {
        throw new Error(`知识访问标签不能为空: ${category}`);
      }
      const previous = seen.get(content);
      if (previous) {
        if (!sameKnowledgeAccess(previous.access, access)) {
          throw new Error(
            `同一知识出现不同访问门槛（${previous.category} / ${category}）：${content.slice(0, 24)}…`,
          );
        }
        continue;
      }
      const fact: KnowledgeFact = { category, content, access };
      seen.set(content, fact);
      facts.push(fact);
    }
  }
  return facts;
}
