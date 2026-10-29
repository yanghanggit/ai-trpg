import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_USER } from "../src/db/demo-fixture";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  appendMemoryMessages,
  compactAllMemories,
  compactMemory,
  createGame,
  getGameMemories,
} from "../src/game";
import { ChatCompletionResult, type ChatCompletionService } from "../src/llm";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

class SummaryService implements ChatCompletionService {
  calls = 0;
  inputs: string[] = [];

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.calls += 1;
    this.inputs.push(request.inputMessage);
    return new ChatCompletionResult({
      request,
      aiMessage: {
        type: "ai",
        content: "压缩摘要：角色仍守在灰烬门廊，记得有人来过。",
        metadata: { contextUsageRatio: 0.01 },
      },
      finishReason: "stop",
    });
  }
}

describe.skipIf(!testDatabaseUrl)("memory compaction", () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = openDatabase("TEST_DATABASE_URL");
    await runMigrations(handle.db);
    await resetDomainData(handle.db);
    await seedDemoData(handle.db);
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  it("tracks contextUsageRatio from AI messages and compacts all memory owners", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "压缩测试局",
      world: TEST_WORLD,
    });
    const memories = await getGameMemories(handle.db, created.game.id);
    expect(memories).toHaveLength(6);

    for (const memory of memories) {
      await appendMemoryMessages(handle.db, memory.id, [
        {
          type: "ai",
          content: "一条测试 AI 记忆。",
          metadata: { contextUsageRatio: 0.5 },
        },
      ]);
    }
    const before = await getGameMemories(handle.db, created.game.id);
    expect(before.every((memory) => memory.contextUsageRatio === 0.5)).toBe(true);

    const service = new SummaryService();
    const results = await compactAllMemories(handle.db, created.game.slug, { service });
    expect(results).toHaveLength(6);
    expect(results.every((result) => result.skipped === false)).toBe(true);
    expect(service.calls).toBe(6);
    expect(service.inputs.every((input) => input.includes("记忆压缩"))).toBe(true);
    // 压缩结果会回灌成长期记忆，所以每次压缩都要带该局的战役设定。
    expect(service.inputs.every((input) => input.includes(TEST_WORLD.campaignSetting))).toBe(true);

    const after = await getGameMemories(handle.db, created.game.id);
    for (const memory of after) {
      expect(memory.messages.map((message) => message.type)).toEqual(["system", "human"]);
      expect(memory.messages[1]?.content).toContain("# 本局记忆");
      expect(memory.messages[1]?.content).toContain("压缩摘要");
      expect(memory.messages[1]?.metadata).toMatchObject({ kind: "compacted_memory" });
      expect(memory.contextUsageRatio).toBe(0);
    }
  });

  it("archives old messages under the new human summary, preserving nested compact branches", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "压缩树测试局",
      world: TEST_WORLD,
    });
    const memories = await getGameMemories(handle.db, created.game.id);
    const keeper = memories.find((memory) => memory.name === "守烬人");
    expect(keeper).toBeDefined();

    await appendMemoryMessages(handle.db, keeper?.id as string, [
      {
        type: "ai",
        content: "第一次压缩前的记忆。",
        metadata: { contextUsageRatio: 0.4 },
      },
    ]);
    const service = new SummaryService();
    const first = await compactMemory(
      handle.db,
      created.game.slug,
      { ownerType: "actor", ref: "守烬人" },
      { service },
    );
    expect(first.skipped).toBe(false);

    const afterFirst = (await getGameMemories(handle.db, created.game.id)).find(
      (memory) => memory.name === "守烬人",
    );
    const firstArchive = afterFirst?.messages[1]?.metadata as
      | { compactedMessages?: unknown[] }
      | undefined;
    expect(firstArchive?.compactedMessages).toHaveLength(1);

    await appendMemoryMessages(handle.db, keeper?.id as string, [
      {
        type: "ai",
        content: "第一次压缩之后的新记忆。",
        metadata: { contextUsageRatio: 0.6 },
      },
    ]);
    const second = await compactMemory(
      handle.db,
      created.game.slug,
      { ownerType: "actor", ref: "守烬人" },
      { service },
    );
    expect(second.skipped).toBe(false);

    const afterSecond = (await getGameMemories(handle.db, created.game.id)).find(
      (memory) => memory.name === "守烬人",
    );
    const secondArchive = afterSecond?.messages[1]?.metadata as
      | { compactedMessages?: Array<{ metadata?: { compactedMessages?: unknown[] } }> }
      | undefined;
    expect(secondArchive?.compactedMessages).toHaveLength(2);
    expect(secondArchive?.compactedMessages?.[0]?.metadata?.compactedMessages).toHaveLength(1);
  });

  it("skips compaction when contextUsageRatio is below the threshold", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "压缩阈值测试局",
      world: TEST_WORLD,
    });
    const memories = await getGameMemories(handle.db, created.game.id);
    const keeper = memories.find((memory) => memory.name === "守烬人");
    expect(keeper).toBeDefined();
    await appendMemoryMessages(handle.db, keeper?.id as string, [
      {
        type: "ai",
        content: "一条低占用 AI 记忆。",
        metadata: { contextUsageRatio: 0.2 },
      },
    ]);

    const service = new SummaryService();
    const result = await compactMemory(
      handle.db,
      created.game.slug,
      { ownerType: "actor", ref: "守烬人" },
      { service, minRatio: 0.5 },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("低于阈值");
    expect(service.calls).toBe(0);

    const after = await getGameMemories(handle.db, created.game.id);
    const keeperAfter = after.find((memory) => memory.name === "守烬人");
    expect(keeperAfter?.messages).toHaveLength(2);
    expect(keeperAfter?.messages[1]?.type).toBe("ai");
  });
});
