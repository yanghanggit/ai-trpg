import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseContentPack, readContentPackFile } from "../src/content-pack";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  DeterministicEmbeddingProvider,
  indexKnowledgeBase,
  searchDocuments,
  worldCollection,
} from "../src/rag";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

describe("content pack", () => {
  const pack = {
    world: TEST_WORLD,
    knowledge: { 地理: ["门廊在修道院南边。", "中殿有一口断钟。"] },
  };

  it("parses a world + knowledge pack and keeps collection naming stable", () => {
    const parsed = parseContentPack(pack);
    expect(parsed.world.worldName).toBe(TEST_WORLD.worldName);
    // 世界内容不携带开场文本字段，开场信息只在 stage / actor 内容里。
    expect("initialNarration" in parsed.world).toBe(false);
    expect(parsed.knowledge.地理).toHaveLength(2);
    expect(worldCollection(parsed.world.contentKey, parsed.world.contentVersion)).toBe(
      "world:test-world:test-world.v1",
    );
  });

  it("trims duplicate entries and rejects empty or malformed knowledge", () => {
    const parsed = parseContentPack({
      world: TEST_WORLD,
      knowledge: { "  地理  ": ["  门廊在南边  ", "  门廊在南边  "] },
    });
    expect(parsed.knowledge).toEqual({ 地理: ["门廊在南边"] });

    expect(() => parseContentPack({ world: TEST_WORLD, knowledge: {} })).toThrow(/不能为空/);
    expect(() => parseContentPack({ world: TEST_WORLD, knowledge: { " ": ["事实"] } })).toThrow(
      /分类名/,
    );
    expect(() => parseContentPack({ world: TEST_WORLD, knowledge: { 地理: ["  "] } })).toThrow(
      /条目/,
    );
  });

  it("rejects a pack whose world fails the create-game validation", () => {
    const { actions: _actions, ...withoutActions } = TEST_WORLD;
    expect(() => parseContentPack({ world: withoutActions, knowledge: pack.knowledge })).toThrow();
  });

  it("reads the same pack from a JSON file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-trpg-pack-"));
    try {
      const path = join(dir, "pack.json");
      await writeFile(path, JSON.stringify(pack), "utf8");
      const parsed = await readContentPackFile(path);
      expect(parsed.world.worldName).toBe(TEST_WORLD.worldName);
      expect(parsed.knowledge.地理).toEqual(pack.knowledge.地理);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!testDatabaseUrl)("content pack knowledge ingestion", () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = openDatabase("TEST_DATABASE_URL");
    await runMigrations(handle.db);
    await resetDomainData(handle.db);
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  it("indexes a pack's knowledge into its own collection and retrieves it", async () => {
    const pack = parseContentPack({
      world: TEST_WORLD,
      knowledge: { 地理: ["灰烬门廊位于中殿南侧。"] },
    });
    const collection = worldCollection(pack.world.contentKey, pack.world.contentVersion);
    const provider = new DeterministicEmbeddingProvider();

    await indexKnowledgeBase(handle.db, provider, collection, pack.knowledge, {
      source: "test:pack",
      docType: "knowledge",
    });
    const results = await searchDocuments(handle.db, provider, {
      collection,
      query: "灰烬门廊位于中殿南侧。",
      topK: 1,
    });
    expect(results[0]?.content).toBe("灰烬门廊位于中殿南侧。");
    expect(results[0]?.metadata.category).toBe("地理");
  });
});
