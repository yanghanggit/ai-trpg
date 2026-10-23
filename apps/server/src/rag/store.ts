import { createHash } from "node:crypto";
import { and, cosineDistance, eq, gte, sql } from "drizzle-orm";
import type { Database } from "../db/pool";
import { vectorDocuments } from "../db/schema";
import { DEFAULT_RAG_TOP_K, MAX_RAG_TOP_K } from "./constants";
import type {
  EmbeddingProvider,
  KnowledgeBase,
  RagDocumentInput,
  RagIndexResult,
  RagMetadata,
  RagSearchOptions,
  RagSearchResult,
} from "./types";

function normalizeContent(content: string): string {
  return content.trim();
}

/** 内容 hash 用于幂等 upsert；同 collection 下相同内容只保留一行。 */
export function contentHash(content: string): string {
  return createHash("sha256").update(normalizeContent(content), "utf8").digest("hex");
}

function normalizeDocument(document: RagDocumentInput): RagDocumentInput {
  const content = normalizeContent(document.content);
  if (content.length === 0) {
    throw new Error("知识文档内容不能为空");
  }
  return {
    content,
    ...(document.title?.trim() ? { title: document.title.trim() } : {}),
    ...(document.source?.trim() ? { source: document.source.trim() } : {}),
    ...(document.docType?.trim() ? { docType: document.docType.trim() } : {}),
    ...(document.metadata ? { metadata: document.metadata } : {}),
  };
}

/** 把 `分类 -> 条目[]` 展开成独立的可检索文档。 */
export function knowledgeBaseDocuments(
  knowledgeBase: KnowledgeBase,
  defaults: Pick<RagDocumentInput, "source" | "docType"> = {},
): RagDocumentInput[] {
  return Object.entries(knowledgeBase).flatMap(([category, entries]) =>
    entries.map((content) => ({
      content,
      ...(defaults.source ? { source: defaults.source } : {}),
      docType: defaults.docType ?? "knowledge",
      metadata: { category },
    })),
  );
}

function assertCollection(collection: string): string {
  const value = collection.trim();
  if (value.length === 0) {
    throw new Error("collection 不能为空");
  }
  return value;
}

/** 生成并写入 embedding；数据库写入在一个短事务内完成。 */
export async function indexDocuments(
  db: Database,
  provider: EmbeddingProvider,
  collection: string,
  documents: readonly RagDocumentInput[],
): Promise<RagIndexResult> {
  const targetCollection = assertCollection(collection);
  const normalized = documents.map(normalizeDocument);
  if (normalized.length === 0) {
    return { collection: targetCollection, written: 0 };
  }

  // 同一批里出现重复内容时只保留第一条，避免 ON CONFLICT 在同一语句内命中两次。
  const unique = new Map<string, RagDocumentInput>();
  for (const document of normalized) {
    const hash = contentHash(document.content);
    if (!unique.has(hash)) {
      unique.set(hash, document);
    }
  }
  const documentsToWrite = [...unique.values()];

  const embeddings = await provider.embedDocuments(
    documentsToWrite.map((document) => document.content),
  );
  if (embeddings.length !== documentsToWrite.length) {
    throw new Error(
      `embedding 数量不匹配：文档 ${documentsToWrite.length}，向量 ${embeddings.length}`,
    );
  }

  const now = new Date();
  const rows = documentsToWrite.map((document, index) => {
    const embedding = embeddings[index];
    if (!embedding) {
      throw new Error(`缺少第 ${index} 条文档的 embedding`);
    }
    return {
      id: crypto.randomUUID(),
      collection: targetCollection,
      source: document.source ?? null,
      docType: document.docType ?? null,
      title: document.title ?? null,
      content: document.content,
      contentHash: contentHash(document.content),
      metadata: (document.metadata ?? {}) as RagMetadata,
      embedding,
      embeddingModel: provider.model,
      createdAt: now,
      updatedAt: now,
    };
  });

  await db.transaction(async (tx) => {
    const batchSize = 100;
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize);
      await tx
        .insert(vectorDocuments)
        .values(batch)
        .onConflictDoUpdate({
          target: [vectorDocuments.collection, vectorDocuments.contentHash],
          set: {
            source: sql`excluded.source`,
            docType: sql`excluded.doc_type`,
            title: sql`excluded.title`,
            metadata: sql`excluded.metadata`,
            embedding: sql`excluded.embedding`,
            embeddingModel: sql`excluded.embedding_model`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
  });

  return { collection: targetCollection, written: rows.length };
}

/** 只按当前 collection 与 provider.model 检索，避免不同模型向量混用。 */
export async function searchDocuments(
  db: Database,
  provider: EmbeddingProvider,
  options: RagSearchOptions,
): Promise<RagSearchResult[]> {
  const collection = assertCollection(options.collection);
  const query = options.query.trim();
  if (query.length === 0) {
    throw new Error("检索 query 不能为空");
  }

  const topK = options.topK ?? DEFAULT_RAG_TOP_K;
  if (!Number.isInteger(topK) || topK < 1 || topK > MAX_RAG_TOP_K) {
    throw new Error(`topK 必须是 1..${MAX_RAG_TOP_K} 的整数，当前为 ${topK}`);
  }
  const minSimilarity = options.minSimilarity;
  if (
    minSimilarity !== undefined &&
    (!Number.isFinite(minSimilarity) || minSimilarity < -1 || minSimilarity > 1)
  ) {
    throw new Error(`minSimilarity 必须在 [-1, 1] 内，当前为 ${minSimilarity}`);
  }

  const queryEmbedding = await provider.embedQuery(query);
  const distance = cosineDistance(vectorDocuments.embedding, queryEmbedding);
  const similarity = sql<number>`1 - (${distance})`;
  const conditions = [
    eq(vectorDocuments.collection, collection),
    eq(vectorDocuments.embeddingModel, provider.model),
  ];
  if (options.docType) {
    conditions.push(eq(vectorDocuments.docType, options.docType.trim()));
  }
  if (minSimilarity !== undefined) {
    conditions.push(gte(similarity, minSimilarity));
  }

  const rows = await db
    .select({
      id: vectorDocuments.id,
      content: vectorDocuments.content,
      title: vectorDocuments.title,
      source: vectorDocuments.source,
      docType: vectorDocuments.docType,
      metadata: vectorDocuments.metadata,
      similarity,
    })
    .from(vectorDocuments)
    .where(and(...conditions))
    .orderBy(distance)
    .limit(topK);

  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    title: row.title,
    source: row.source,
    docType: row.docType,
    metadata: row.metadata,
    similarity: Number(row.similarity),
  }));
}

/** 清空一个 collection；仅供开发/测试与重建索引使用。 */
export async function deleteCollection(db: Database, collection: string): Promise<number> {
  const targetCollection = assertCollection(collection);
  const deleted = await db
    .delete(vectorDocuments)
    .where(eq(vectorDocuments.collection, targetCollection))
    .returning({ id: vectorDocuments.id });
  return deleted.length;
}

export async function countCollection(db: Database, collection: string): Promise<number> {
  const targetCollection = assertCollection(collection);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(vectorDocuments)
    .where(eq(vectorDocuments.collection, targetCollection));
  return Number(row?.count ?? 0);
}
