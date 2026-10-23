import { parseArgs } from "node:util";
import { CONTENT_SEEDS, type ContentSeed, getContentSeed } from "../seeds";
import { openDatabase } from "../src/db/connect";
import {
  countCollection,
  deleteCollection,
  type EmbeddingDtype,
  indexKnowledgeBase,
  searchDocuments,
  TransformersEmbeddingProvider,
  worldCollection,
} from "../src/rag";

type Output = Record<string, unknown>;

const options = {
  seed: { type: "string" },
  collection: { type: "string" },
  query: { type: "string" },
  "top-k": { type: "string" },
  "doc-type": { type: "string" },
  "min-similarity": { type: "string" },
  dtype: { type: "string" },
  yes: { type: "boolean" },
} as const;

function emit(payload: Output, exitCode = 0): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

function usage(): void {
  emit({
    ok: true,
    usage: [
      "pnpm rag ingest --seed <name> [--collection <name>] [--dtype q8]",
      "pnpm rag search --seed <name> --query <text> [--top-k 5] [--min-similarity 0.3]",
      "pnpm rag search --collection <name> --query <text>",
      "pnpm rag check --seed <name> | --collection <name>",
      "pnpm rag delete --collection <name> --yes",
      `可用 seed: ${Object.keys(CONTENT_SEEDS).join(", ")}`,
    ],
  });
}

function resolveSeed(
  value: string | boolean | undefined,
): { name: string; seed: ContentSeed; collection: string; source: string } | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("--seed 需要非空名称");
  }
  const name = value.trim();
  const seed = getContentSeed(name);
  return {
    name,
    seed,
    collection: worldCollection(seed.world.worldName, seed.world.contentVersion),
    source: `seed:${name}`,
  };
}

function resolveCollection(
  explicit: string | boolean | undefined,
  seed: ReturnType<typeof resolveSeed>,
): string {
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return explicit.trim();
  }
  if (!seed) {
    throw new Error("需要 --seed 或 --collection");
  }
  return seed.collection;
}

function parseTopK(value: string | boolean | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("--top-k 必须是正整数");
  }
  return Number(value);
}

function parseMinSimilarity(value: string | boolean | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("--min-similarity 必须是数字");
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("--min-similarity 必须是有限数字");
  }
  return parsed;
}

function makeProvider(value: string | boolean | undefined): TransformersEmbeddingProvider {
  if (value === undefined) {
    return new TransformersEmbeddingProvider();
  }
  if (typeof value !== "string" || !["fp32", "fp16", "q8", "q4"].includes(value)) {
    throw new Error("--dtype 必须是 fp32 / fp16 / q8 / q4");
  }
  return new TransformersEmbeddingProvider({ dtype: value as EmbeddingDtype });
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options,
  });
  const command = parsed.positionals[0] ?? "help";
  const values = parsed.values;

  if (command === "help") {
    usage();
    return;
  }

  if (command !== "ingest" && command !== "search" && command !== "check" && command !== "delete") {
    throw new Error(`未知命令: ${command}`);
  }

  const seed = resolveSeed(values.seed);
  const collection = resolveCollection(values.collection, seed);

  if (command === "delete") {
    if (typeof values.collection !== "string" || values.collection.trim().length === 0) {
      throw new Error("delete 需要显式 --collection，避免误删默认知识库");
    }
    if (values.yes !== true) {
      throw new Error("delete 会删除整个 collection，确认后请加 --yes");
    }
    const { db, pool } = openDatabase();
    try {
      const deleted = await deleteCollection(db, collection);
      emit({ ok: true, action: "rag-delete", collection, deleted });
    } finally {
      await pool.end();
    }
    return;
  }

  if (command === "check") {
    const { db, pool } = openDatabase();
    try {
      const count = await countCollection(db, collection);
      emit({ ok: true, action: "rag-check", collection, count });
    } finally {
      await pool.end();
    }
    return;
  }

  if (command === "ingest") {
    if (!seed) {
      throw new Error("ingest 需要 --seed");
    }
    const provider = makeProvider(values.dtype);
    const { db, pool } = openDatabase();
    try {
      const result = await indexKnowledgeBase(db, provider, collection, seed.seed.knowledge, {
        source: seed.source,
        docType: "knowledge",
      });
      const count = await countCollection(db, collection);
      emit({
        ok: true,
        action: "rag-ingest",
        seed: seed.name,
        collection,
        model: provider.model,
        written: result.written,
        count,
      });
    } finally {
      await pool.end();
    }
    return;
  }

  if (typeof values.query !== "string" || values.query.trim().length === 0) {
    throw new Error("search 需要非空 --query");
  }
  const provider = makeProvider(values.dtype);
  const topK = parseTopK(values["top-k"]);
  const minSimilarity = parseMinSimilarity(values["min-similarity"]);
  const { db, pool } = openDatabase();
  try {
    const results = await searchDocuments(db, provider, {
      collection,
      query: values.query,
      ...(topK !== undefined ? { topK } : {}),
      ...(minSimilarity !== undefined ? { minSimilarity } : {}),
      ...(typeof values["doc-type"] === "string" ? { docType: values["doc-type"] } : {}),
    });
    emit({
      ok: true,
      action: "rag-search",
      collection,
      model: provider.model,
      query: values.query,
      results,
    });
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  emit(
    {
      ok: false,
      action: "rag",
      error: error instanceof Error ? error.message : String(error),
    },
    1,
  );
});
