/**
 * 公共知识检索评测：遍历已注册的评测集，给每个剧本算 recall@k 与 MRR@5。
 *
 * 评测数据在 `seeds/<战役>/<剧本>.eval.ts`，与知识库同目录维护；这个脚本只是 runner。
 * 用法：
 *   pnpm rag:eval                    # 遍历全部已注册的评测集
 *   pnpm rag:eval --seed dark-fantasy
 *   pnpm rag:eval --reindex          # 先按 seed 同步 collection
 *   pnpm rag:eval --database TEST_DATABASE_URL --top-k 10
 *   pnpm rag:eval --check            # 门槛校验，失败时非零退出（给 CI 用）
 */

import { parseArgs } from "node:util";
import { CONTENT_PACKS, getContentPack } from "../seeds";
import { RAG_EVAL_SETS } from "../seeds/eval";
import type { ContentPack } from "../src/content-pack";
import { openDatabase } from "../src/db/connect";
import type { Database } from "../src/db/pool";
import {
  countCollection,
  type EmbeddingDtype,
  indexKnowledgeBase,
  searchDocuments,
  TransformersEmbeddingProvider,
  worldCollection,
} from "../src/rag";
import type { RagEvalSet, RagEvalVariant, RagSearchResult } from "../src/rag/types";

const options = {
  seed: { type: "string" },
  database: { type: "string" },
  "top-k": { type: "string" },
  dtype: { type: "string" },
  reindex: { type: "boolean" },
  check: { type: "boolean" },
} as const;

const VARIANTS: readonly RagEvalVariant[] = ["question", "keywords", "mixed"];

/** 全局门槛；单个剧本可以在自己的 eval 集里覆盖。 */
const DEFAULT_THRESHOLDS: Record<RagEvalVariant, number> = {
  question: 0.8,
  keywords: 0.9,
  mixed: 0.9,
};

type Hit = { rank: number | null; similarity: number | null };

type VariantReport = {
  variant: RagEvalVariant;
  recall: Record<string, number>;
  mrr: number;
  misses: { query: string; expect: string; top: string[] }[];
  /** 负例的最高相似度：没有正确答案时，检索返回得有多“自信”。 */
  negatives: { query: string; topSimilarity: number | null; top: string | null }[];
};

type SetReport = {
  seed: string;
  collection: string;
  cases: { positive: number; negative: number };
  thresholds: Record<RagEvalVariant, number>;
  failures: string[];
  calibration: {
    minPositiveSimilarity: number | null;
    maxNegativeSimilarity: number | null;
    suggestedMinSimilarity: number | null;
  };
  results: VariantReport[];
};

function parsePositiveInt(value: string | boolean | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`${name} 必须是正整数`);
  }
  return Number(value);
}

function parseDtype(value: string | boolean | undefined): EmbeddingDtype | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !["fp32", "fp16", "q8", "q4"].includes(value)) {
    throw new Error("--dtype 必须是 fp32 / fp16 / q8 / q4");
  }
  return value as EmbeddingDtype;
}

function resolveSeedNames(value: string | boolean | undefined): string[] {
  if (value === undefined) {
    return Object.keys(RAG_EVAL_SETS);
  }
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) {
    throw new Error("--seed 需要非空名称");
  }
  if (!(name in RAG_EVAL_SETS)) {
    throw new Error(
      `剧本 ${name} 没有评测集；已注册: ${Object.keys(RAG_EVAL_SETS).join(", ") || "（空）"}`,
    );
  }
  return [name];
}

/**
 * 用例自检：`expect` 是硬编码片段，内容一改就会静默变成“永远 miss”。
 * 同时检查覆盖度——每条知识至少要被一个正例命中，否则新增知识不会进入评测。
 */
function assertEvalSetMatchesKnowledge(name: string, seed: ContentPack, evalSet: RagEvalSet): void {
  const contents = Object.values(seed.knowledge).flat();
  const stale = evalSet.positive.filter(
    (testCase) => !contents.some((content) => content.includes(testCase.expect)),
  );
  if (stale.length > 0) {
    throw new Error(
      `${name}: 评测用例已失效（知识库里找不到 expect 片段）：${stale
        .map((testCase) => `「${testCase.expect}」`)
        .join("、")}；改文案后请同步更新评测集`,
    );
  }
  const uncovered = contents.filter(
    (content) => !evalSet.positive.some((testCase) => content.includes(testCase.expect)),
  );
  if (uncovered.length > 0) {
    throw new Error(
      `${name}: 有 ${uncovered.length} 条知识没有评测用例覆盖：${uncovered
        .map((content) => `「${content.slice(0, 24)}…」`)
        .join("、")}；请为它们补正例`,
    );
  }
  if (evalSet.negative.length === 0) {
    throw new Error(`${name}: 评测集缺少负例，无法衡量噪声与标定阈值`);
  }
}

function variantQuery(
  testCase: RagEvalSet["positive"][number] | RagEvalSet["negative"][number],
  variant: RagEvalVariant,
): string {
  switch (variant) {
    case "question":
      return testCase.question;
    case "keywords":
      return testCase.keywords;
    case "mixed":
      return `${testCase.question} ${testCase.keywords}`;
  }
}

function rankOf(results: readonly RagSearchResult[], expect: string): Hit {
  const index = results.findIndex((result) => result.content.includes(expect));
  if (index < 0) {
    return { rank: null, similarity: null };
  }
  return { rank: index + 1, similarity: results[index]?.similarity ?? null };
}

async function evaluateSet(input: {
  db: Database;
  provider: TransformersEmbeddingProvider;
  name: string;
  seed: ContentPack;
  evalSet: RagEvalSet;
  topK: number;
  reindex: boolean;
}): Promise<SetReport> {
  const { db, provider, name, seed, evalSet, topK, reindex } = input;
  // 先校验评测集：用例失效/覆盖不全时直接失败，不必先付出 embedding 的代价。
  assertEvalSetMatchesKnowledge(name, seed, evalSet);
  const collection = worldCollection(seed.world.contentKey, seed.world.contentVersion);
  if (reindex || (await countCollection(db, collection)) === 0) {
    await indexKnowledgeBase(db, provider, collection, seed.knowledge, {
      source: `seed:${name}`,
      docType: "knowledge",
    });
  }

  const reports: VariantReport[] = [];
  const positiveSimilarities: number[] = [];
  const negativeSimilarities: number[] = [];
  for (const variant of VARIANTS) {
    const hits: Hit[] = [];
    const misses: VariantReport["misses"] = [];
    for (const testCase of evalSet.positive) {
      const query = variantQuery(testCase, variant);
      const results = await searchDocuments(db, provider, { collection, query, topK });
      const hit = rankOf(results, testCase.expect);
      hits.push(hit);
      if (hit.similarity !== null) {
        positiveSimilarities.push(hit.similarity);
      }
      if (hit.rank === null) {
        misses.push({
          query,
          expect: testCase.expect,
          top: results.map((result) => result.content.slice(0, 20)),
        });
      }
    }

    const negatives: VariantReport["negatives"] = [];
    for (const testCase of evalSet.negative) {
      const query = variantQuery(testCase, variant);
      const results = await searchDocuments(db, provider, { collection, query, topK });
      const top = results[0];
      negatives.push({
        query,
        topSimilarity: top?.similarity ?? null,
        top: top?.content.slice(0, 20) ?? null,
      });
      if (top) {
        negativeSimilarities.push(top.similarity);
      }
    }

    const at = (k: number) =>
      hits.filter((hit) => hit.rank !== null && hit.rank <= k).length / hits.length;
    reports.push({
      variant,
      recall: Object.fromEntries([1, 3, 5].filter((k) => k <= topK).map((k) => [`@${k}`, at(k)])),
      mrr: hits.reduce((sum, hit) => sum + (hit.rank === null ? 0 : 1 / hit.rank), 0) / hits.length,
      misses,
      negatives,
    });
  }

  // 标定：正例命中的最低相似度 vs 负例最高相似度。两者不重叠时，中间任意值
  // 都能把“答不出”的问题过滤成空结果；重叠时不给建议，免得凭空造阈值。
  const minPositive = positiveSimilarities.length > 0 ? Math.min(...positiveSimilarities) : null;
  const maxNegative = negativeSimilarities.length > 0 ? Math.max(...negativeSimilarities) : null;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...evalSet.thresholds };

  return {
    seed: name,
    collection,
    cases: { positive: evalSet.positive.length, negative: evalSet.negative.length },
    thresholds,
    failures: reports
      .filter((report) => report.mrr < thresholds[report.variant])
      .map(
        (report) =>
          `${name}/${report.variant} MRR@${topK}=${report.mrr.toFixed(3)} < ${thresholds[report.variant]}`,
      ),
    calibration: {
      minPositiveSimilarity: minPositive === null ? null : Number(minPositive.toFixed(3)),
      maxNegativeSimilarity: maxNegative === null ? null : Number(maxNegative.toFixed(3)),
      suggestedMinSimilarity:
        minPositive !== null && maxNegative !== null && minPositive > maxNegative
          ? Number(((minPositive + maxNegative) / 2).toFixed(3))
          : null,
    },
    results: reports,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ args: process.argv.slice(2), options });
  const seedNames = resolveSeedNames(values.seed);
  const topK = parsePositiveInt(values["top-k"], "--top-k") ?? 5;
  const dtype = parseDtype(values.dtype);
  const databaseName =
    typeof values.database === "string" && values.database.trim().length > 0
      ? values.database.trim()
      : "DATABASE_URL";
  const provider = new TransformersEmbeddingProvider(dtype ? { dtype } : {});
  const { db, pool } = openDatabase(databaseName);

  try {
    const sets: SetReport[] = [];
    for (const name of seedNames) {
      const evalSet = RAG_EVAL_SETS[name as keyof typeof RAG_EVAL_SETS];
      if (!evalSet) {
        throw new Error(`剧本 ${name} 没有评测集`);
      }
      sets.push(
        await evaluateSet({
          db,
          provider,
          name,
          seed: getContentPack(name),
          evalSet,
          topK,
          reindex: values.reindex === true,
        }),
      );
    }

    // 注册了剧本却没有评测集：默认只提示，--check 时算失败（防止新剧本悄悄跳过评测）。
    const missingEvalSets = Object.keys(CONTENT_PACKS).filter((name) => !(name in RAG_EVAL_SETS));
    const failures = sets.flatMap((set) => set.failures);
    const ok = failures.length === 0 && missingEvalSets.length === 0;

    process.stdout.write(
      `${JSON.stringify(
        {
          ok,
          action: "rag-eval",
          database: databaseName,
          model: provider.model,
          topK,
          summary: {
            sets: sets.length,
            failures,
            missingEvalSets,
          },
          sets,
        },
        null,
        2,
      )}\n`,
    );
    if (values.check && !ok) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      ok: false,
      action: "rag-eval",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
