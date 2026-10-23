import { describe, expect, it } from "vitest";
import { TransformersEmbeddingProvider } from "../src/rag/embeddings";

const documents = [
  "瘟疫最盛时，修士在墓园地面撒石灰，把尸体一层层压进乱葬坑。",
  "焚尸房在修道院东侧小屋后，炉膛日夜不熄，烧不完的尸体才会被运往乱葬坑。",
  "修道院的钟楼在墓园北侧，铜钟多年无人敲响。",
];

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  return dot / Math.sqrt(normA * normB);
}

describe.skipIf(process.env.RAG_REAL !== "1")("real multilingual embedding", () => {
  it("retrieves plague-body handling facts for a Chinese query", async () => {
    const provider = new TransformersEmbeddingProvider();
    const embeddings = await provider.embedDocuments(documents);
    const queryEmbedding = await provider.embedQuery("黑疖病死了那么多人，尸体是怎么处理的？");

    const ranked = documents
      .map((content, index) => ({
        content,
        similarity: cosine(queryEmbedding, embeddings[index] ?? []),
      }))
      .sort((left, right) => right.similarity - left.similarity);

    expect(ranked[0]?.content).toMatch(/石灰|焚尸房/);
    expect(ranked[0]?.similarity).toBeGreaterThan(0.45);
  }, 120_000);
});
