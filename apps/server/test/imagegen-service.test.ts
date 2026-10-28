import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ImageAssetStore,
  ImageGenError,
  type ImageGenerationRequest,
  ImageGenerationService,
  type ImageModelInfo,
  type ImageProvider,
  type ProviderGeneration,
  type ProviderStatus,
} from "../src/imagegen";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const temporaryDirs: string[] = [];

async function temporaryDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ai-trpg-service-"));
  temporaryDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

class FakeProvider implements ImageProvider {
  readonly id = "fake-provider";
  readonly requests: ImageGenerationRequest[] = [];

  listModels(): readonly ImageModelInfo[] {
    return [
      {
        id: "fake-model",
        label: "Fake",
        provider: this.id,
        capabilities: {
          sources: ["text2image", "image_edit"],
          aspectRatios: ["1:1"],
          outputFormats: ["png"],
        },
      },
    ];
  }

  supports(model: string): boolean {
    return model === "fake-model";
  }

  async generate(request: ImageGenerationRequest): Promise<ProviderGeneration> {
    this.requests.push(request);
    if (request.prompt.includes("bad")) {
      throw new ImageGenError("fake", "预测失败", { kind: "model" });
    }
    return {
      predictionId: `prediction-${this.requests.length}`,
      model: "fake-model",
      modelRef: "fake/model",
      outputUrls: ["https://cdn.example/result.png"],
      resolvedInput: {
        prompt: request.prompt,
        aspect_ratio: "1:1",
        output_format: "png",
        seed: request.seed ?? null,
      },
      logs: "",
      metrics: {},
      elapsedMs: 5,
    };
  }

  async checkConnection(): Promise<ProviderStatus> {
    return { ok: true, latencyMs: 1, detail: "HTTP 200" };
  }
}

function imageResponse(): Response {
  return new Response(PNG_BYTES, {
    status: 200,
    headers: { "content-type": "image/png", "content-length": String(PNG_BYTES.length) },
  });
}

async function makeService(): Promise<{
  service: ImageGenerationService;
  store: ImageAssetStore;
  provider: FakeProvider;
}> {
  const provider = new FakeProvider();
  const store = new ImageAssetStore({ dir: await temporaryDir() });
  const service = new ImageGenerationService({
    provider,
    store,
    fetch: async () => imageResponse(),
  });
  return { service, store, provider };
}

describe("ImageGenerationService", () => {
  it("writes raw + meta for text-to-image", async () => {
    const { service, store, provider } = await makeService();
    const image = await service.generateText({
      model: "fake-model",
      prompt: "一座雾中的修道院",
      aspectRatio: "1:1",
      seed: 7,
    });

    expect(provider.requests[0]).toMatchObject({ prompt: "一座雾中的修道院" });
    expect(image.meta).toMatchObject({
      provider: "fake-provider",
      model: "fake-model",
      modelRef: "fake/model",
      source: "text2image",
      format: "png",
      aspectRatio: "1:1",
      seed: 7,
      predictionId: "prediction-1",
      sizeBytes: PNG_BYTES.length,
    });
    expect(await readFile(image.path)).toEqual(PNG_BYTES);
    expect(JSON.parse(await readFile(image.metaPath, "utf8"))).toMatchObject({
      filename: image.meta.filename,
      type: "image",
    });
    expect((await store.list())[0]?.filename).toBe(image.meta.filename);
  });

  it("marks edit requests and stores input references", async () => {
    const { service } = await makeService();
    const image = await service.edit({
      model: "fake-model",
      prompt: "改成水彩",
      inputImages: ["images/source.png"],
    });

    expect(image.meta.source).toBe("image_edit");
    expect(image.meta.inputImages).toEqual(["images/source.png"]);
    expect(JSON.stringify(image.meta)).not.toContain("data:image");
  });

  it("propagates provider failures", async () => {
    const { service } = await makeService();
    await expect(
      service.generateText({ model: "fake-model", prompt: "bad prompt" }),
    ).rejects.toMatchObject({ kind: "model" });
  });

  it("isolates failures in batches and keeps input order", async () => {
    const { service } = await makeService();
    const results = await service.batch(
      [
        { model: "fake-model", prompt: "first" },
        { model: "fake-model", prompt: "bad second" },
        { model: "fake-model", prompt: "third" },
      ],
      { maxConcurrency: 1 },
    );

    expect(results).toHaveLength(3);
    expect(results.map((result) => result.index)).toEqual([0, 1, 2]);
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
    expect(results[2]?.ok).toBe(true);
    if (results[0]?.ok && results[2]?.ok) {
      expect(results[0].image.meta.filename).not.toBe(results[2].image.meta.filename);
    }
  });

  it("rejects invalid requests before calling the provider", async () => {
    const { service, provider } = await makeService();
    await expect(service.generate({ model: "fake-model", prompt: "   " })).rejects.toMatchObject({
      kind: "validation",
    });
    await expect(service.generateText({ model: "missing", prompt: "x" })).rejects.toMatchObject({
      kind: "validation",
    });
    expect(provider.requests).toHaveLength(0);
  });

  it("lists and reads stored assets", async () => {
    const { service } = await makeService();
    const image = await service.generateText({ model: "fake-model", prompt: "x" });
    expect((await service.listImages())[0]?.filename).toBe(image.meta.filename);
    expect((await service.readImage(image.meta.filename)).prompt).toBe("x");
  });
});
