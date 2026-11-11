import { parseArgs } from "node:util";
import { CONTENT_PACKS, getContentPack } from "../seeds";
import type { ContentPack } from "../src/content-pack";
import { readContentPackFile } from "../src/content-pack";
import { openDatabase } from "../src/db/connect";
import {
  contentHash,
  countCollection,
  deleteCollection,
  type EmbeddingDtype,
  indexKnowledgeBase,
  knowledgeFacts,
  listCollectionDocuments,
  sameKnowledgeAccess,
  searchDocuments,
  TransformersEmbeddingProvider,
  worldCollection,
} from "../src/rag";

type Output = Record<string, unknown>;

const options = {
  seed: { type: "string" },
  file: { type: "string" },
  collection: { type: "string" },
  query: { type: "string" },
  "top-k": { type: "string" },
  "doc-type": { type: "string" },
  "min-similarity": { type: "string" },
  access: { type: "string" },
  as: { type: "string" },
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
      "pnpm rag ingest (--seed <name> | --file <content-pack.json>) [--collection <name>] [--dtype q8]",
      "pnpm rag search --seed <name> --query <text> [--top-k 5] [--min-similarity 0.3] [--access all|none|<tag,...>|--as <actorKey>]",
      "pnpm rag search --collection <name> --query <text>",
      "pnpm rag check (--seed <name> | --file <content-pack.json>) | --collection <name>",
      "pnpm rag delete --collection <name> --yes",
      `可用内容包: ${Object.keys(CONTENT_PACKS).join(", ")}`,
    ],
  });
}

type ContentSource = {
  name: string;
  pack: ContentPack;
  collection: string;
  source: string;
};

async function resolveSource(values: Record<string, string | boolean | undefined>) {
  const seedName = values.seed;
  const file = values.file;
  if (typeof seedName === "string" && typeof file === "string") {
    throw new Error("--seed 与 --file 只能二选一");
  }
  if (typeof seedName === "string") {
    if (seedName.trim().length === 0) {
      throw new Error("--seed 需要非空名称");
    }
    const name = seedName.trim();
    const pack = getContentPack(name);
    return {
      name,
      pack,
      collection: worldCollection(pack.world.contentKey, pack.world.contentVersion),
      source: `seed:${name}`,
    } satisfies ContentSource;
  }
  if (typeof file === "string") {
    if (file.trim().length === 0) {
      throw new Error("--file 需要非空路径");
    }
    const pack = await readContentPackFile(file.trim());
    return {
      name: file.trim(),
      pack,
      collection: worldCollection(pack.world.contentKey, pack.world.contentVersion),
      source: `file:${file.trim()}`,
    } satisfies ContentSource;
  }
  return undefined;
}

function resolveCollection(
  explicit: string | boolean | undefined,
  source: ContentSource | undefined,
): string {
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return explicit.trim();
  }
  if (!source) {
    throw new Error("需要 --seed 或 --collection");
  }
  return source.collection;
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

function resolveSearchAccess(
  values: Record<string, string | boolean | undefined>,
  source: ContentSource | undefined,
): { access?: readonly string[]; reported: unknown } {
  const asValue = values.as;
  const accessValue = values.access;
  if (typeof asValue === "string" && typeof accessValue === "string") {
    throw new Error("--as 与 --access 只能二选一");
  }
  if (typeof asValue === "string") {
    if (!source) {
      throw new Error("--as 需要 --seed 或 --file");
    }
    const actorKey = asValue.trim();
    const actor = source.pack.world.actors.find((candidate) => candidate.key === actorKey);
    if (!actor) {
      throw new Error(`内容包里没有 actor: ${actorKey}`);
    }
    const access = [...(actor.knowledgeAccess ?? [])];
    return { access, reported: { as: actorKey, access } };
  }
  // 缺省是全量（管理端调试）；要模拟角色用 --as 或 --access none / 标签列表。
  if (accessValue === undefined || accessValue === "all") {
    return { access: undefined, reported: "all" };
  }
  if (typeof accessValue !== "string") {
    throw new Error("--access 需要 all / none / 标签列表");
  }
  if (accessValue === "none") {
    return { access: [], reported: "none" };
  }
  const access = [
    ...new Set(
      accessValue
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
  return { access, reported: access.length === 0 ? "none" : access };
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

  const source = await resolveSource(values);
  const collection = resolveCollection(values.collection, source);

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
      const documents = await listCollectionDocuments(db, collection);
      if (!source) {
        emit({ ok: true, action: "rag-check", collection, count: documents.length });
        return;
      }
      // 对账：内容包是唯一事实源，库里多出来的（orphan）与少掉的（missing）都要报出来。
      const expected = new Map(
        knowledgeFacts(source.pack.knowledge).map(
          (fact) => [contentHash(fact.content), fact] as const,
        ),
      );
      const actual = new Map(documents.map((doc) => [doc.contentHash, doc] as const));
      const missing = [...expected.entries()]
        .filter(([hash]) => !actual.has(hash))
        .map(([, fact]) => fact.content);
      const orphan = [...actual.entries()]
        .filter(([hash]) => !expected.has(hash))
        .map(([, doc]) => doc.content);
      const accessDrift = [...expected.values()].flatMap((fact) => {
        const doc = actual.get(contentHash(fact.content));
        if (!doc || sameKnowledgeAccess(doc.access, fact.access)) {
          return [];
        }
        return [
          {
            content: fact.content.slice(0, 40),
            expected: fact.access,
            actual: doc.access,
          },
        ];
      });
      const model = new TransformersEmbeddingProvider().model;
      const staleModel = documents.filter((doc) => doc.embeddingModel !== model).length;
      emit({
        ok: true,
        action: "rag-check",
        collection,
        count: documents.length,
        expected: expected.size,
        missing: { count: missing.length, samples: missing.slice(0, 5) },
        orphan: { count: orphan.length, samples: orphan.slice(0, 5) },
        accessDrift: { count: accessDrift.length, samples: accessDrift.slice(0, 5) },
        staleModel,
        inSync:
          missing.length === 0 &&
          orphan.length === 0 &&
          accessDrift.length === 0 &&
          staleModel === 0,
      });
    } finally {
      await pool.end();
    }
    return;
  }

  if (command === "ingest") {
    if (!source) {
      throw new Error("ingest 需要 --seed 或 --file");
    }
    const provider = makeProvider(values.dtype);
    const { db, pool } = openDatabase();
    try {
      const result = await indexKnowledgeBase(db, provider, collection, source.pack.knowledge, {
        source: source.source,
        docType: "knowledge",
      });
      const count = await countCollection(db, collection);
      emit({
        ok: true,
        action: "rag-ingest",
        source: source.source,
        collection,
        model: provider.model,
        written: result.written,
        removed: result.removed,
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
  const searchAccess = resolveSearchAccess(values, source);
  const { db, pool } = openDatabase();
  try {
    const results = await searchDocuments(db, provider, {
      collection,
      query: values.query,
      ...(topK !== undefined ? { topK } : {}),
      ...(minSimilarity !== undefined ? { minSimilarity } : {}),
      ...(typeof values["doc-type"] === "string" ? { docType: values["doc-type"] } : {}),
      ...(searchAccess.access !== undefined ? { access: searchAccess.access } : {}),
    });
    emit({
      ok: true,
      action: "rag-search",
      collection,
      model: provider.model,
      query: values.query,
      access: searchAccess.reported,
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
