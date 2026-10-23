import { CONTENT_SEEDS } from "../seeds";
import { openDatabase } from "../src/db/connect";
import { runMigrations } from "../src/db/migrate";
import {
  countCollection,
  deleteCollection,
  indexKnowledgeBase,
  searchDocuments,
  TransformersEmbeddingProvider,
} from "../src/rag";

async function main(): Promise<void> {
  const seed = Object.values(CONTENT_SEEDS)[0];
  if (!seed) {
    throw new Error("没有可用的内容 seed");
  }
  const documents = Object.values(seed.knowledge).flat();
  const query = documents[0];
  if (!query) {
    throw new Error("内容 seed 没有可检索的公共知识");
  }
  const collection = `smoke:${Date.now()}`;
  const provider = new TransformersEmbeddingProvider();
  const { db, pool } = openDatabase("TEST_DATABASE_URL");
  try {
    await runMigrations(db);
    await deleteCollection(db, collection);
    const indexed = await indexKnowledgeBase(db, provider, collection, seed.knowledge, {
      source: "smoke",
      docType: "knowledge",
    });
    const results = await searchDocuments(db, provider, {
      collection,
      query,
      topK: 5,
    });
    const relevant = results.slice(0, 3).some((result) => result.content === query);
    if (!relevant) {
      throw new Error(`top 3 未检索到目标知识：${JSON.stringify(results, null, 2)}`);
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          action: "rag-smoke",
          collection,
          model: provider.model,
          indexed: indexed.written,
          count: await countCollection(db, collection),
          top3: results.slice(0, 3).map((result) => ({
            content: result.content,
            similarity: result.similarity,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await deleteCollection(db, collection).catch(() => undefined);
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      ok: false,
      action: "rag-smoke",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
