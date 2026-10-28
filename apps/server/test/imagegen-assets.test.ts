import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectImageFormat,
  downloadImage,
  ImageAssetStore,
  type ImageMeta,
  imageFormatFromContentType,
  imageFormatFromUrl,
  newImageFilename,
  normalizeImageFormat,
} from "../src/imagegen";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP_BYTES = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

const temporaryDirs: string[] = [];

async function temporaryDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ai-trpg-imagegen-"));
  temporaryDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function metaFor(filename: string): ImageMeta {
  return {
    schemaVersion: 1,
    type: "image",
    filename,
    provider: "test-provider",
    model: "test-model",
    modelRef: "owner/model",
    source: "text2image",
    prompt: "一座雾中的修道院",
    negativePrompt: "",
    aspectRatio: "16:9",
    width: 0,
    height: 0,
    seed: null,
    steps: null,
    guidance: null,
    format: "png",
    inputImages: [],
    providerOptions: {},
    sizeBytes: PNG_BYTES.length,
    predictionId: "prediction-1",
    elapsedMs: 12,
    createdAt: new Date("2026-01-02T03:04:05.000Z").toISOString(),
  };
}

describe("image format helpers", () => {
  it("normalizes aliases and rejects unknown formats", () => {
    expect(normalizeImageFormat("JPEG")).toBe("jpg");
    expect(normalizeImageFormat(".png")).toBe("png");
    expect(normalizeImageFormat("gif")).toBeUndefined();
    expect(imageFormatFromUrl("https://cdn.example/a/b.webp?x=1")).toBe("webp");
    expect(imageFormatFromContentType("image/jpeg; charset=binary")).toBe("jpg");
    expect(detectImageFormat(PNG_BYTES)).toBe("png");
    expect(detectImageFormat(JPEG_BYTES)).toBe("jpg");
    expect(detectImageFormat(WEBP_BYTES)).toBe("webp");
    expect(detectImageFormat(Buffer.from("not an image"))).toBeUndefined();
  });

  it("builds sortable, collision-free filenames", () => {
    const first = newImageFilename("png", new Date("2026-01-02T03:04:05.000Z"), "aaaaaaaa-aaaa");
    const second = newImageFilename("jpeg", new Date("2026-01-02T03:04:06.000Z"), "bbbbbbbb-bbbb");
    expect(first).toBe("20260102T030405Z_aaaaaaaaaaaa.png");
    expect(second).toBe("20260102T030406Z_bbbbbbbbbbbb.jpg");
    expect(first < second).toBe(true);
  });
});

describe("ImageAssetStore", () => {
  it("writes raw + meta and reads them back", async () => {
    const store = new ImageAssetStore({ dir: await temporaryDir() });
    const filename = newImageFilename("png");
    const saved = await store.save(metaFor(filename), PNG_BYTES);

    expect(await readFile(saved.path)).toEqual(PNG_BYTES);
    const rawMeta = await readFile(saved.metaPath, "utf8");
    expect(rawMeta).not.toContain("data:image");
    expect(JSON.parse(rawMeta)).toMatchObject({ filename, provider: "test-provider" });

    const loaded = await store.readMeta(filename);
    expect(loaded.filename).toBe(filename);
    expect((await store.list()).map((meta) => meta.filename)).toEqual([filename]);
  });

  it("accepts a meta path and rejects traversal", async () => {
    const store = new ImageAssetStore({ dir: await temporaryDir() });
    const filename = newImageFilename("png");
    await store.save(metaFor(filename), PNG_BYTES);

    expect((await store.readMeta(`${filename}.meta`)).filename).toBe(filename);
    expect(() => store.pathFor("../escape.png")).toThrow(/非法资产文件名/);
    await expect(store.readMeta("missing.png")).rejects.toThrow(/meta 不存在/);
  });

  it("rejects invalid meta before writing raw", async () => {
    const store = new ImageAssetStore({ dir: await temporaryDir() });
    const filename = newImageFilename("png");
    const broken = { ...metaFor(filename), format: "gif" } as unknown as ImageMeta;
    await expect(store.save(broken, PNG_BYTES)).rejects.toThrow();
    await expect(store.readMeta(filename)).rejects.toThrow(/meta 不存在/);
  });

  it("enforces filename/format consistency and records the actual size", async () => {
    const store = new ImageAssetStore({ dir: await temporaryDir() });
    const filename = newImageFilename("png");
    await store.save({ ...metaFor(filename), sizeBytes: 0 }, PNG_BYTES);
    expect((await store.readMeta(filename)).sizeBytes).toBe(PNG_BYTES.length);

    await expect(store.save({ ...metaFor(filename), format: "webp" }, PNG_BYTES)).rejects.toThrow(
      /不一致/,
    );
  });
});

describe("downloadImage", () => {
  it("prefers the URL extension and returns raw bytes", async () => {
    const result = await downloadImage("https://cdn.example/a.png", {
      fetch: async () =>
        new Response(PNG_BYTES, {
          status: 200,
          headers: { "content-type": "image/png", "content-length": String(PNG_BYTES.length) },
        }),
    });
    expect(result.format).toBe("png");
    expect(result.bytes).toEqual(PNG_BYTES);
  });

  it("falls back to content type / magic bytes", async () => {
    const byContentType = await downloadImage("https://cdn.example/download", {
      fetch: async () =>
        new Response(JPEG_BYTES, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    });
    expect(byContentType.format).toBe("jpg");

    const byMagic = await downloadImage("https://cdn.example/download", {
      fetch: async () => new Response(WEBP_BYTES, { status: 200 }),
    });
    expect(byMagic.format).toBe("webp");
  });

  it("rejects non-http URLs, HTTP errors and oversized payloads", async () => {
    await expect(downloadImage("file:///tmp/a.png")).rejects.toThrow(/只支持 http/);
    await expect(
      downloadImage("https://cdn.example/a.png", {
        fetch: async () => new Response("nope", { status: 401 }),
      }),
    ).rejects.toMatchObject({ kind: "api", statusCode: 401 });
    await expect(
      downloadImage("https://cdn.example/a.png", {
        fetch: async () =>
          new Response(PNG_BYTES, {
            status: 200,
            headers: { "content-length": "999999" },
          }),
        maxBytes: 10,
      }),
    ).rejects.toThrow(/产物过大/);
  });
});

describe("input fixtures", () => {
  it("keeps a writable fixture helper for provider tests", async () => {
    const dir = await temporaryDir();
    const path = join(dir, "input.png");
    await writeFile(path, PNG_BYTES);
    expect((await readFile(path)).length).toBe(PNG_BYTES.length);
  });
});
