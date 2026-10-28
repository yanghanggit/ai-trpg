import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ImageGenError } from "../src/imagegen";
import { createReplicateProvider, ReplicateProvider } from "../src/imagegen/providers/replicate";
import type { FetchLike } from "../src/imagegen/types";

type Call = { url: string; init: RequestInit | undefined };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function successfulPrediction(output: unknown = ["https://cdn.example/out.png"]): Response {
  return jsonResponse({
    id: "prediction-1",
    status: "succeeded",
    output,
    logs: "ok",
    error: null,
    metrics: { predict_time: 1.25 },
    urls: { get: "https://api.replicate.com/v1/predictions/prediction-1" },
  });
}

function recordingFetch(respond: (call: Call, index: number) => Response): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      return respond(call, calls.length - 1);
    },
  };
}

const temporaryDirs: string[] = [];

async function temporaryDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ai-trpg-provider-"));
  temporaryDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("hosted provider model catalog", () => {
  it("exposes logical models with capabilities", () => {
    const provider = new ReplicateProvider({ apiToken: "token" });
    const models = provider.listModels();
    expect(models.map((model) => model.id)).toContain("nano-banana");
    expect(provider.supports("nano-banana")).toBe(true);
    expect(provider.supports("missing")).toBe(false);
    const nano = models.find((model) => model.id === "nano-banana");
    expect(nano?.capabilities.sources).toEqual(["text2image", "image_edit"]);
    expect(nano?.capabilities.outputFormats).toEqual(["png", "jpg"]);
  });
});

describe("ReplicateProvider.generate", () => {
  it("maps text-to-image input and uses the official model endpoint", async () => {
    const { fetch, calls } = recordingFetch(() => successfulPrediction());
    const provider = new ReplicateProvider({ apiToken: "token", fetch, waitSeconds: 1 });

    const result = await provider.generate({
      model: "nano-banana",
      prompt: "一座雾中的修道院",
      aspectRatio: "16:9",
      width: 1024,
      height: 1024,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://api.replicate.com/v1/models/google/nano-banana/predictions",
    );
    expect(calls[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer token",
      Prefer: "wait=1",
    });
    const body = JSON.parse(String(calls[0]?.init?.body)) as { input: Record<string, unknown> };
    expect(body.input).toEqual({
      prompt: "一座雾中的修道院",
      aspect_ratio: "16:9",
      output_format: "png",
    });
    expect(result).toMatchObject({
      predictionId: "prediction-1",
      model: "nano-banana",
      modelRef: "google/nano-banana",
      outputUrls: ["https://cdn.example/out.png"],
    });
    expect(result.metrics).toEqual({ predict_time: 1.25 });
  });

  it("derives aspect ratio from width/height when no ratio is given", async () => {
    const { fetch, calls } = recordingFetch(() => successfulPrediction());
    const provider = new ReplicateProvider({ apiToken: "token", fetch });
    await provider.generate({ model: "nano-banana", prompt: "x", width: 1600, height: 900 });
    const body = JSON.parse(String(calls[0]?.init?.body)) as { input: Record<string, unknown> };
    expect(body.input.aspect_ratio).toBe("16:9");
  });

  it("sends local edit inputs as data URLs but keeps meta placeholders", async () => {
    const dir = await temporaryDir();
    const input = join(dir, "input.png");
    await writeFile(input, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const { fetch, calls } = recordingFetch(() => successfulPrediction());
    const provider = new ReplicateProvider({ apiToken: "token", fetch });
    const result = await provider.generate({
      model: "nano-banana",
      prompt: "改成水彩",
      inputImages: [input],
    });

    const body = JSON.parse(String(calls[0]?.init?.body)) as { input: Record<string, unknown> };
    expect(body.input.aspect_ratio).toBe("match_input_image");
    const images = body.input.image_input as string[];
    expect(images[0]).toMatch(/^data:image\/png;base64,/);
    expect(result.resolvedInput.image_input).toEqual([`<input:${input}>`]);
  });

  it("maps provider-specific parameters only when the model supports them", async () => {
    const { fetch, calls } = recordingFetch(() => successfulPrediction());
    const provider = new ReplicateProvider({ apiToken: "token", fetch });
    await provider.generate({
      model: "flux-schnell",
      prompt: "x",
      steps: 3,
      seed: 42,
      outputFormat: "webp",
      aspectRatio: "9:16",
    });
    const body = JSON.parse(String(calls[0]?.init?.body)) as { input: Record<string, unknown> };
    expect(body.input).toEqual({
      prompt: "x",
      num_inference_steps: 3,
      seed: 42,
      aspect_ratio: "9:16",
      output_format: "webp",
      num_outputs: 1,
    });
  });

  it("rejects unsupported fields instead of silently dropping them", async () => {
    const { fetch, calls } = recordingFetch(() => successfulPrediction());
    const provider = new ReplicateProvider({ apiToken: "token", fetch });

    await expect(
      provider.generate({ model: "nano-banana", prompt: "x", negativePrompt: "bad" }),
    ).rejects.toMatchObject({ kind: "validation" });
    await expect(
      provider.generate({
        model: "nano-banana",
        prompt: "x",
        providerOptions: { resolution: "2K" },
      }),
    ).rejects.toMatchObject({ kind: "validation" });
    await expect(
      provider.generate({ model: "flux-schnell", prompt: "x", inputImages: ["a.png"] }),
    ).rejects.toMatchObject({ kind: "validation" });
    expect(calls).toHaveLength(0);
  });

  it("polls when the synchronous response is still processing", async () => {
    const { fetch, calls } = recordingFetch((_call, index) =>
      index === 0
        ? jsonResponse({
            id: "prediction-2",
            status: "processing",
            output: null,
            logs: "",
            urls: { get: "https://api.replicate.com/v1/predictions/prediction-2" },
          })
        : successfulPrediction(["https://cdn.example/polled.png"]),
    );
    const provider = new ReplicateProvider({
      apiToken: "token",
      fetch,
      pollIntervalMs: 100,
      timeoutMs: 2_000,
    });

    const result = await provider.generate({ model: "nano-banana", prompt: "x" });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe("https://api.replicate.com/v1/predictions/prediction-2");
    expect(result.outputUrls).toEqual(["https://cdn.example/polled.png"]);
  });

  it("maps failed predictions and HTTP errors to ImageGenError", async () => {
    const failed = recordingFetch(() =>
      jsonResponse({
        id: "prediction-3",
        status: "failed",
        output: null,
        error: "model exploded",
        logs: "stack trace",
        urls: {},
      }),
    );
    const provider = new ReplicateProvider({ apiToken: "token", fetch: failed.fetch });
    await expect(provider.generate({ model: "nano-banana", prompt: "x" })).rejects.toMatchObject({
      kind: "model",
      details: { predictionId: "prediction-3", logs: "stack trace" },
    });

    const unauthorized = recordingFetch(() =>
      jsonResponse({ title: "Unauthenticated", detail: "bad token" }, 401),
    );
    const denied = new ReplicateProvider({ apiToken: "token", fetch: unauthorized.fetch });
    await expect(denied.generate({ model: "nano-banana", prompt: "x" })).rejects.toMatchObject({
      kind: "api",
      statusCode: 401,
      retryable: false,
    });
  });

  it("requires a token and reports connection status", async () => {
    const missing = createReplicateProvider({ apiToken: "" });
    await expect(missing.generate({ model: "nano-banana", prompt: "x" })).rejects.toBeInstanceOf(
      ImageGenError,
    );

    const { fetch, calls } = recordingFetch(() => jsonResponse({ results: [] }));
    const provider = new ReplicateProvider({ apiToken: "token", fetch });
    const status = await provider.checkConnection();
    expect(status.ok).toBe(true);
    expect(calls[0]?.url).toBe("https://api.replicate.com/v1/models?limit=1");
  });
});
