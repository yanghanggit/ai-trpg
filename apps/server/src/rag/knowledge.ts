import type { Database } from "../db/pool";
import { indexDocuments, knowledgeBaseDocuments } from "./store";
import type { EmbeddingProvider, KnowledgeBase, RagDocumentInput, RagIndexResult } from "./types";

/**
 * 剧本标识 + 内容版本决定知识库作用域；版本升级后不会混用旧向量。
 *
 * 第一个参数必须是稳定的剧本标识（`World.contentKey`），不是展示名：剧本改名时
 * collection 不能跟着变，否则知识库会静默变成孤儿。
 */
export function worldCollection(contentKey: string, contentVersion: string): string {
  const name = contentKey.trim();
  const version = contentVersion.trim();
  if (name.length === 0 || version.length === 0) {
    throw new Error("worldCollection 需要非空的 contentKey 与 contentVersion");
  }
  return `world:${name}:${version}`;
}

/**
 * 把种子知识库同步进指定 collection。
 *
 * 这是“同步”而不是“追加”：seed 是唯一事实源，改动或删除的条目要一起消失，
 * 否则旧向量会留在库里继续被检索到。
 */
export async function indexKnowledgeBase(
  db: Database,
  provider: EmbeddingProvider,
  collection: string,
  knowledgeBase: KnowledgeBase,
  defaults: Pick<RagDocumentInput, "source" | "docType"> = {},
): Promise<RagIndexResult> {
  return indexDocuments(db, provider, collection, knowledgeBaseDocuments(knowledgeBase, defaults), {
    pruneMissing: true,
  });
}
