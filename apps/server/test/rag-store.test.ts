import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { runMigrations } from "../src/db/migrate";
import { EMBEDDING_DIMENSIONS } from "../src/rag/constants";
import { DeterministicEmbeddingProvider } from "../src/rag/embeddings";
import {
  countCollection,
  deleteCollection,
  indexDocuments,
  searchDocuments,
} from "../src/rag/store";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const baseCollection = `test:rag:${Date.now()}:${Math.random().toString(36).slice(2)}`;
const otherCollection = `${baseCollection}:other`;

function vector(values: Record<number, number>): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => values[index] ?? 0);
}

const alpha = vector({ 0: 1 });
const beta = vector({ 1: 1 });
const gamma = vector({ 0: 0.8, 1: 0.2 });
const query = vector({ 0: 1 });

function makeProvider(model = "test-embedding-v1") {
  return new DeterministicEmbeddingProvider({
    model,
    vectors: {
      alpha,
      beta,
      gamma,
      query,
    },
  });
}

describe.skipIf(!testDatabaseUrl)("pgvector rag store", () => {
  let handle: DatabaseHandle;
  const provider = makeProvider();

  beforeAll(async () => {
    handle = openDatabase("TEST_DATABASE_URL");
    await runMigrations(handle.db);
    await deleteCollection(handle.db, baseCollection);
    await deleteCollection(handle.db, otherCollection);
  });

  afterAll(async () => {
    await deleteCollection(handle.db, baseCollection);
    await deleteCollection(handle.db, otherCollection);
    await handle.pool.end();
  });

  it("indexes documents and ranks them by cosine similarity", async () => {
    await indexDocuments(handle.db, provider, baseCollection, [
      { content: "alpha", docType: "lore", metadata: { category: "测试" } },
      { content: "beta", docType: "lore", metadata: { category: "测试" } },
      { content: "gamma", docType: "lore", metadata: { category: "测试" } },
    ]);

    const results = await searchDocuments(handle.db, provider, {
      collection: baseCollection,
      query: "query",
      topK: 3,
    });

    expect(results.map((result) => result.content)).toEqual(["alpha", "gamma", "beta"]);
    expect(results[0]?.similarity).toBeCloseTo(1, 5);
    expect(results[1]?.similarity).toBeGreaterThan(0.9);
  });

  it("is idempotent for repeated ingestion", async () => {
    const result = await indexDocuments(handle.db, provider, baseCollection, [
      { content: "alpha", docType: "lore" },
    ]);

    expect(result.written).toBe(1);
    expect(await countCollection(handle.db, baseCollection)).toBe(3);
  });

  it("isolates collections and filters by docType", async () => {
    await indexDocuments(handle.db, provider, otherCollection, [{ content: "beta" }]);

    const isolated = await searchDocuments(handle.db, provider, {
      collection: otherCollection,
      query: "query",
      topK: 3,
    });
    expect(isolated.map((result) => result.content)).toEqual(["beta"]);

    const filtered = await searchDocuments(handle.db, provider, {
      collection: baseCollection,
      query: "query",
      topK: 3,
      docType: "missing",
    });
    expect(filtered).toEqual([]);
  });

  it("filters by embedding model and applies a similarity threshold", async () => {
    const otherModel = makeProvider("test-embedding-v2");
    const wrongModel = await searchDocuments(handle.db, otherModel, {
      collection: baseCollection,
      query: "query",
      topK: 3,
    });
    expect(wrongModel).toEqual([]);

    const thresholded = await searchDocuments(handle.db, provider, {
      collection: baseCollection,
      query: "query",
      topK: 3,
      minSimilarity: 0.9,
    });
    expect(thresholded.map((result) => result.content)).toEqual(["alpha", "gamma"]);
  });

  it("deletes a whole collection", async () => {
    expect(await deleteCollection(handle.db, baseCollection)).toBe(3);
    expect(await countCollection(handle.db, baseCollection)).toBe(0);
  });
});
