import { DARK_FANTASY_KNOWLEDGE } from "../seeds/knowledge/dark-fantasy";
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
  const collection = `smoke:dark-fantasy:${Date.now()}`;
  const provider = new TransformersEmbeddingProvider();
  const { db, pool } = openDatabase("TEST_DATABASE_URL");
  try {
    await runMigrations(db);
    await deleteCollection(db, collection);
    const indexed = await indexKnowledgeBase(db, provider, collection, DARK_FANTASY_KNOWLEDGE, {
      source: "smoke:dark-fantasy",
      docType: "knowledge",
    });
    const results = await searchDocuments(db, provider, {
      collection,
      query: "黑疖病死了那么多人，尸体是怎么处理的？",
      topK: 5,
    });
    const relevant = results
      .slice(0, 3)
      .some((result) => result.content.includes("石灰") || result.content.includes("焚尸房"));
    if (!relevant) {
      throw new Error(`top 3 未检索到瘟疫尸体处理事实：${JSON.stringify(results, null, 2)}`);
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
