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
  systemPrompts: string[] = [];

  constructor(private readonly summary = "压缩摘要：角色仍守在灰烬门廊，记得有人来过。") {}

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.calls += 1;
    this.inputs.push(request.inputMessage);
    this.systemPrompts.push(request.messages[0]?.content ?? "");
    return new ChatCompletionResult({
      request,
      aiMessage: {
        type: "ai",
        content: this.summary,
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
    expect(service.inputs.every((input) => input.startsWith("# 记忆压缩任务"))).toBe(true);
    expect(service.inputs.every((input) => input.includes("## 记忆主体"))).toBe(true);
    expect(service.inputs.every((input) => input.includes("## 待压缩记忆"))).toBe(true);
    expect(service.inputs.every((input) => input.includes("## 输出"))).toBe(true);
    expect(service.systemPrompts.every((prompt) => prompt.includes("## 本职能"))).toBe(true);
    expect(service.systemPrompts.every((prompt) => !prompt.includes("## 契约"))).toBe(true);
    // 压缩宪法由内容层定档：测试世界给的是同构的通用文本，只断言结构与注入。
    expect(service.systemPrompts.every((prompt) => prompt.includes("## 职责"))).toBe(true);
    // 压缩结果会回灌成长期记忆，所以每次压缩的宪法都要带该局的战役设定；任务提示词只放本轮内容。
    expect(
      service.systemPrompts.every((prompt) => prompt.includes(TEST_WORLD.campaignSetting)),
    ).toBe(true);
    expect(service.inputs.every((input) => !input.includes(TEST_WORLD.campaignSetting))).toBe(true);

    const after = await getGameMemories(handle.db, created.game.id);
    for (const memory of after) {
      expect(memory.messages.map((message) => message.type)).toEqual(["system", "human"]);
      expect(memory.messages[1]?.content).toContain("# 本局记忆");
      expect(memory.messages[1]?.content).toContain("压缩摘要");
      expect(memory.messages[1]?.metadata).toMatchObject({ kind: "compacted_memory" });
      expect(memory.contextUsageRatio).toBe(0);
    }
  });

  it("demotes headings inside the memory transcript under the task heading", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "压缩 Markdown 标题测试局",
      world: TEST_WORLD,
    });
    const memories = await getGameMemories(handle.db, created.game.id);
    const keeper = memories.find((memory) => memory.name === "守烬人");
    expect(keeper).toBeDefined();
    await appendMemoryMessages(handle.db, keeper?.id as string, [
      {
        type: "human",
        content: "# 行动结果\n你留在原地。\n\n# 当时\n舞台：灰烬门廊",
      },
    ]);

    const service = new SummaryService();
    await compactMemory(
      handle.db,
      created.game.slug,
      { ownerType: "actor", ref: "守烬人" },
      { service },
    );
    expect(service.inputs[0]).toContain("### 当时");
    expect(service.inputs[0]).not.toMatch(/^# 当时/m);
  });

  it("keeps route cognition verbatim and dedupes by destination", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "路线认知回填局",
      world: TEST_WORLD,
    });
    const memories = await getGameMemories(handle.db, created.game.id);
    const keeper = memories.find((memory) => memory.name === "守烬人");
    const memoryId = keeper?.id as string;

    await appendMemoryMessages(handle.db, memoryId, [
      {
        type: "human",
        content: "# 认知\n从灰烬门廊到断钟中殿：灰烬门廊 → 断钟中殿（旧结论）",
        metadata: { kind: "route_recall", routeFrom: "stage-gate", routeTo: "stage-nave" },
      },
      {
        type: "human",
        content: "# 认知\n从灰烬门廊到断钟中殿：灰烬门廊 → 断钟中殿（新结论）",
        metadata: { kind: "route_recall", routeFrom: "stage-gate", routeTo: "stage-nave" },
      },
      {
        type: "human",
        content: "# 认知\n从灰烬门廊到墓室：灰烬门廊 → 墓室",
        metadata: { kind: "route_recall", routeFrom: "stage-gate", routeTo: "stage-crypt" },
      },
      {
        type: "human",
        content: "# 认知\n你认不出「不存在的塔」这个地方，这次回忆只记下这一点。",
        metadata: { kind: "route_failed", routeToRef: "不存在的塔" },
      },
    ]);

    const service = new SummaryService();
    const result = await compactMemory(
      handle.db,
      created.game.slug,
      { ownerType: "actor", ref: "守烬人" },
      { service },
    );

    expect(result.skipped).toBe(false);
    // 摘要 + 三条回填（同一目的地只留最新结论）
    expect(result.pinnedCount).toBe(3);
    expect(result.afterMessages).toBe(5);

    const [memory] = (await getGameMemories(handle.db, created.game.id)).filter(
      (item) => item.id === memoryId,
    );
    const messages = memory?.messages ?? [];
    expect(messages.map((message) => message.type)).toEqual([
      "system",
      "human",
      "human",
      "human",
      "human",
    ]);
    expect(messages[1]?.metadata).toMatchObject({ kind: "compacted_memory" });

    const pinned = messages.slice(2);
    const meta = (message: (typeof messages)[number]) =>
      message.metadata as Record<string, unknown> | undefined;
    expect(pinned.every((message) => meta(message)?.pinned === true)).toBe(true);
    expect(pinned.map((message) => message.content)).toEqual([
      "# 认知\n从灰烬门廊到断钟中殿：灰烬门廊 → 断钟中殿（新结论）",
      "# 认知\n从灰烬门廊到墓室：灰烬门廊 → 墓室",
      "# 认知\n你认不出「不存在的塔」这个地方，这次回忆只记下这一点。",
    ]);
    // 原 kind 保留，读侧按 kind 过滤仍然认得出这是认知
    expect(pinned.map((message) => meta(message)?.kind)).toEqual([
      "route_recall",
      "route_recall",
      "route_failed",
    ]);
    // 摘要只由模型写一次，回填不经过 service
    expect(service.calls).toBe(1);
  });

  it("caps pinned routes so compaction still shortens memory", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "路线回填上限局",
      world: TEST_WORLD,
    });
    const memories = await getGameMemories(handle.db, created.game.id);
    const memoryId = memories.find((memory) => memory.name === "守烬人")?.id as string;

    await appendMemoryMessages(
      handle.db,
      memoryId,
      Array.from({ length: 12 }, (_, index) => ({
        type: "human" as const,
        content: `# 认知\n第 ${index + 1} 条路线`,
        metadata: { kind: "route_recall", routeTo: `stage-${index + 1}` },
      })),
    );

    const result = await compactMemory(
      handle.db,
      created.game.slug,
      { ownerType: "actor", ref: "守烬人" },
      { service: new SummaryService() },
    );

    expect(result.pinnedCount).toBe(8);
    const [memory] = (await getGameMemories(handle.db, created.game.id)).filter(
      (item) => item.id === memoryId,
    );
    const pinned = (memory?.messages ?? []).slice(2);
    // 只留最近的 8 条：第 5..12 条
    expect(pinned.map((message) => message.content)).toEqual(
      Array.from({ length: 8 }, (_, index) => `# 认知\n第 ${index + 5} 条路线`),
    );
  });

  it("rejects an actor summary that mentions an unknown true name", async () => {
    const world = {
      ...TEST_WORLD,
      signatureNames: (TEST_WORLD.signatureNames ?? []).filter(
        (edge) => !(edge.observer === "ember-keeper" && edge.subject === "lantern-monk"),
      ),
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "压缩真名泄漏测试局",
      world,
    });
    const memories = await getGameMemories(handle.db, created.game.id);
    const keeper = memories.find((memory) => memory.name === "守烬人");
    expect(keeper).toBeDefined();
    await appendMemoryMessages(handle.db, keeper?.id as string, [
      {
        type: "ai",
        content: "一条测试 AI 记忆。",
        metadata: { contextUsageRatio: 0.5 },
      },
    ]);
    const before = (await getGameMemories(handle.db, created.game.id)).find(
      (memory) => memory.name === "守烬人",
    );
    const service = new SummaryService("压缩摘要：你记得提灯修士来过。");
    await expect(
      compactMemory(
        handle.db,
        created.game.slug,
        { ownerType: "actor", ref: "守烬人" },
        { service },
      ),
    ).rejects.toThrow(/未认知的真名/);

    const after = (await getGameMemories(handle.db, created.game.id)).find(
      (memory) => memory.name === "守烬人",
    );
    expect(after?.messages).toHaveLength(before?.messages.length ?? -1);
    expect(after?.messages.some((message) => message.content.includes("提灯修士"))).toBe(false);
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
