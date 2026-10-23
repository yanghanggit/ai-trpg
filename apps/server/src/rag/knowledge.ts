import type { Database } from "../db/pool";
import { indexDocuments, knowledgeBaseDocuments } from "./store";
import type { EmbeddingProvider, KnowledgeBase, RagDocumentInput, RagIndexResult } from "./types";

/** 世界内容版本决定知识库作用域；版本升级后不会混用旧向量。 */
export function worldCollection(worldName: string, contentVersion: string): string {
  const name = worldName.trim();
  const version = contentVersion.trim();
  if (name.length === 0 || version.length === 0) {
    throw new Error("worldCollection 需要非空的 worldName 与 contentVersion");
  }
  return `world:${name}:${version}`;
}

/** 把种子知识库展开并写入指定 collection。 */
export async function indexKnowledgeBase(
  db: Database,
  provider: EmbeddingProvider,
  collection: string,
  knowledgeBase: KnowledgeBase,
  defaults: Pick<RagDocumentInput, "source" | "docType"> = {},
): Promise<RagIndexResult> {
  return indexDocuments(db, provider, collection, knowledgeBaseDocuments(knowledgeBase, defaults));
}
