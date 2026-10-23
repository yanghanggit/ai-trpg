import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS } from "../src/rag/constants";
import { DeterministicEmbeddingProvider } from "../src/rag/embeddings";
import { contentHash, knowledgeBaseDocuments } from "../src/rag/store";

describe("rag documents", () => {
  it("normalizes content for stable hashes", () => {
    expect(contentHash("  同一段知识  ")).toBe(contentHash("同一段知识"));
    expect(contentHash("甲")).not.toBe(contentHash("乙"));
  });

  it("flattens a category map into independent documents", () => {
    const documents = knowledgeBaseDocuments(
      {
        建筑: ["钟楼在北侧。", "墓园在中庭。"],
        瘟疫: ["尸体撒石灰。"],
      },
      { source: "seed:test", docType: "lore" },
    );

    expect(documents).toHaveLength(3);
    expect(documents[0]).toMatchObject({
      content: "钟楼在北侧。",
      source: "seed:test",
      docType: "lore",
      metadata: { category: "建筑" },
    });
    expect(documents[2]?.metadata).toEqual({ category: "瘟疫" });
  });
});

describe("deterministic embedding provider", () => {
  it("returns fixed vectors for known texts", async () => {
    const alpha = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => (index === 0 ? 1 : 0));
    const beta = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => (index === 1 ? 1 : 0));
    const provider = new DeterministicEmbeddingProvider({
      vectors: { alpha, beta },
    });

    await expect(provider.embedDocuments(["alpha", "beta"])).resolves.toEqual([alpha, beta]);
    await expect(provider.embedQuery("alpha")).resolves.toEqual(alpha);
  });

  it("rejects vectors with the wrong dimension", async () => {
    const provider = new DeterministicEmbeddingProvider({
      vectors: { broken: [1, 0] },
    });
    await expect(provider.embedDocuments(["broken"])).rejects.toThrow("维度不匹配");
  });

  it("generates stable fallback vectors without a model", async () => {
    const provider = new DeterministicEmbeddingProvider();
    const first = await provider.embedQuery("同一段文字");
    const second = await provider.embedQuery("同一段文字");

    expect(first).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(first).toEqual(second);
    expect(first.some((value) => value !== 0)).toBe(true);
  });
});
