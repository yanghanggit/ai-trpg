import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_EMBEDDING_DTYPE,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  type EmbeddingDtype,
} from "./constants";
import type { EmbeddingProvider } from "./types";

export const DEFAULT_EMBEDDING_CACHE_DIR = fileURLToPath(
  new URL("../../.cache/transformers", import.meta.url),
);

type FeatureExtractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[] | number[][] }>;

export type TransformersEmbeddingOptions = {
  model?: string;
  dtype?: EmbeddingDtype;
  cacheDir?: string;
  batchSize?: number;
};

function normalizeText(text: string): string {
  return text.trim();
}

function assertVector(vector: number[], dimensions: number, index: number): void {
  if (vector.length !== dimensions) {
    throw new Error(`embedding 维度不匹配：期望 ${dimensions}，第 ${index} 条为 ${vector.length}`);
  }
  let norm = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new Error(`embedding 第 ${index} 条包含非有限数值`);
    }
    norm += value * value;
  }
  if (norm === 0) {
    throw new Error(`embedding 第 ${index} 条是零向量`);
  }
}

/** 在 Node 内运行 Transformers.js；模型按需加载，不在模块导入时加载。 */
export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions = EMBEDDING_DIMENSIONS;
  private readonly dtype: EmbeddingDtype;
  private readonly cacheDir: string;
  private readonly batchSize: number;
  private extractorPromise: Promise<FeatureExtractor> | undefined;

  constructor(options: TransformersEmbeddingOptions = {}) {
    this.model = options.model ?? process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
    const dtype = options.dtype ?? process.env.EMBEDDING_DTYPE ?? DEFAULT_EMBEDDING_DTYPE;
    if (!["fp32", "fp16", "q8", "q4"].includes(dtype)) {
      throw new Error(`EMBEDDING_DTYPE 必须是 fp32 / fp16 / q8 / q4，当前为 ${dtype}`);
    }
    this.dtype = dtype as EmbeddingDtype;
    this.cacheDir = resolve(
      options.cacheDir ?? process.env.EMBEDDING_CACHE_DIR ?? DEFAULT_EMBEDDING_CACHE_DIR,
    );
    this.batchSize =
      options.batchSize ??
      (process.env.EMBEDDING_BATCH_SIZE
        ? Number(process.env.EMBEDDING_BATCH_SIZE)
        : DEFAULT_EMBEDDING_BATCH_SIZE);
    if (!Number.isInteger(this.batchSize) || this.batchSize < 1) {
      throw new Error(`EMBEDDING_BATCH_SIZE 必须是正整数，当前为 ${this.batchSize}`);
    }
  }

  private async getExtractor(): Promise<FeatureExtractor> {
    if (!this.extractorPromise) {
      this.extractorPromise = (async () => {
        const { env, pipeline } = await import("@huggingface/transformers");
        env.cacheDir = this.cacheDir;
        return (await pipeline("feature-extraction", this.model, {
          dtype: this.dtype,
        })) as unknown as FeatureExtractor;
      })();
    }
    return this.extractorPromise;
  }

  async embedDocuments(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const cleaned = texts.map(normalizeText);
    const emptyIndex = cleaned.findIndex((text) => text.length === 0);
    if (emptyIndex !== -1) {
      throw new Error(`第 ${emptyIndex} 条文本为空，不能生成 embedding`);
    }

    const extractor = await this.getExtractor();
    const embeddings: number[][] = [];
    for (let offset = 0; offset < cleaned.length; offset += this.batchSize) {
      const batch = cleaned.slice(offset, offset + this.batchSize);
      const output = await extractor(batch, { pooling: "mean", normalize: true });
      const raw = output.tolist();
      const rows = Array.isArray(raw[0]) ? (raw as number[][]) : [raw as number[]];
      if (rows.length !== batch.length) {
        throw new Error(`embedding 返回条数不匹配：期望 ${batch.length}，实际 ${rows.length}`);
      }
      rows.forEach((vector, index) => {
        assertVector(vector, this.dimensions, offset + index);
        embeddings.push([...vector]);
      });
    }
    return embeddings;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embedDocuments([text]);
    if (!vector) {
      throw new Error("query embedding 为空");
    }
    return vector;
  }
}

export type DeterministicEmbeddingOptions = {
  model?: string;
  dimensions?: number;
  /** 测试或离线调试时按文本指定固定向量；未命中的文本使用稳定哈希向量。 */
  vectors?: Record<string, number[]>;
};

/**
 * 不加载模型的确定性 provider。用于单元测试和离线调试；
 * 它不是语义模型，不能替代真实中文 embedding。
 */
export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  private readonly vectors: Record<string, number[]>;

  constructor(options: DeterministicEmbeddingOptions = {}) {
    this.model = options.model ?? "deterministic-v1";
    this.dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
    this.vectors = options.vectors ?? {};
  }

  private vectorFor(text: string, index: number): number[] {
    const normalized = normalizeText(text);
    const fixed = this.vectors[normalized];
    const vector =
      fixed ??
      Array.from({ length: this.dimensions }, (_, dimension) => {
        let seed = 2166136261;
        for (const char of normalized) {
          seed ^= char.codePointAt(0) ?? 0;
          seed = Math.imul(seed, 16777619) >>> 0;
        }
        seed = (Math.imul(seed, 1664525) + 1013904223 + dimension * 2654435761) >>> 0;
        return seed / 0xffffffff - 0.5;
      });
    assertVector(vector, this.dimensions, index);
    return [...vector];
  }

  async embedDocuments(texts: readonly string[]): Promise<number[][]> {
    return texts.map((text, index) => this.vectorFor(text, index));
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.vectorFor(text, 0);
  }
}
