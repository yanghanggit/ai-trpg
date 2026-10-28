import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTurnTrace,
  gcTrace,
  listTurns,
  readTurn,
  renderTurnText,
  tailEvents,
  traceEnabled,
  traceEvent,
  traceRoot,
  traceStats,
} from "../src/debug/trace";

const GAME = { id: "game-1", slug: "trace-test" };
const USAGE = {
  promptTokens: 10,
  completionTokens: 2,
  totalTokens: 12,
  promptCacheHitTokens: 0,
  promptCacheMissTokens: 0,
  reasoningTokens: 0,
};

describe("trace", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ai-trpg-trace-"));
    process.env.TRACE_DIR = dir;
  });

  afterAll(async () => {
    delete process.env.TRACE_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it("开关：未配置时测试环境不写，显式值优先", () => {
    expect(traceEnabled({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(false);
    expect(traceEnabled({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
    expect(traceEnabled({ TRACE_ENABLED: "false" } as NodeJS.ProcessEnv)).toBe(false);
    expect(traceEnabled({ TRACE_ENABLED: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("写入后能按回合复读、跨回合聚合、取最近事件", async () => {
    const first = createTurnTrace({
      game: GAME,
      turnKind: "actor",
      turnId: "turn-1",
      enabled: true,
    });
    if (!first) {
      throw new Error("轨迹未创建");
    }
    await traceEvent(first, {
      event: "turn_start",
      label: "守烬人",
      actorName: "守烬人",
      contentVersion: "v1",
    });
    await traceEvent(first, {
      event: "llm_call",
      round: 1,
      label: "守烬人",
      settings: {
        model: "test",
        thinking: false,
        toolChoice: "auto",
        reasoningEffort: null,
        temperature: null,
        maxTokens: null,
      },
      tools: [],
      inputMessage: "本轮任务",
      messages: [],
    });
    await traceEvent(first, {
      event: "llm_result",
      round: 1,
      label: "守烬人",
      content: "你好。",
      toolCalls: [{ id: "c1", type: "function", function: { name: "say", arguments: "{}" } }],
      usage: USAGE,
    });
    await traceEvent(first, { event: "plan", actions: [{ kind: "say" }] });
    await traceEvent(first, { event: "rejected", code: "action_rejected", reason: "目标不在场" });
    await traceEvent(first, {
      event: "phase",
      name: "death",
      status: "failed",
      actorName: "煤渣",
      detail: { reason: "事务冲突" },
    });
    await traceEvent(first, { event: "turn_end", ok: false, loopSuccess: true });

    const second = createTurnTrace({
      game: GAME,
      turnKind: "player",
      turnId: "turn-2",
      enabled: true,
    });
    if (!second) {
      throw new Error("轨迹未创建");
    }
    await traceEvent(second, { event: "turn_start", label: "wait" });
    await traceEvent(second, { event: "plan", actions: [{ kind: "wait" }] });
    await traceEvent(second, { event: "applied", actionKind: "wait", feedback: "你留在原地。" });
    await traceEvent(second, { event: "turn_end", ok: true, loopSuccess: true });

    const turns = await listTurns({ gameSlug: GAME.slug });
    expect(turns.map((turn) => turn.turnId)).toEqual(["turn-1", "turn-2"]);
    expect(turns[0]).toMatchObject({
      turnKind: "actor",
      ok: false,
      loopSuccess: true,
      rejected: "目标不在场",
      llmCalls: 1,
      promptTokens: 10,
      completionTokens: 2,
      actions: ["say"],
      failedPhases: ["death"],
    });
    expect(turns[1]?.actions).toEqual(["wait"]);

    const events = await readTurn("turn-1", { gameSlug: GAME.slug });
    expect(events.map((line) => line.event)).toEqual([
      "turn_start",
      "llm_call",
      "llm_result",
      "plan",
      "rejected",
      "phase",
      "turn_end",
    ]);

    const tail = await tailEvents({ gameSlug: GAME.slug, limit: 3 });
    expect(tail.map((line) => line.event)).toEqual(["plan", "applied", "turn_end"]);

    const rendered = renderTurnText(events);
    expect(rendered).toContain("## 第 1 轮 LLM 请求");
    expect(rendered).toContain("model: test");
    expect(rendered).toContain("## 上下文消息");
    expect(rendered).toContain("## 计划");
    expect(rendered).toContain("## 被拒");
    expect(rendered).toContain("## 子阶段");
    expect(rendered).toContain("death: failed (煤渣)");
    expect(rendered).toContain("reason: 事务冲突");
    expect(rendered).toContain("## 结束");

    const stats = await traceStats({ gameSlug: GAME.slug });
    expect(stats.turns).toBe(2);
    expect(stats.ok).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.rejections).toEqual({ action_rejected: 1 });
    expect(stats.phases).toEqual({ "death:failed": 1 });
    expect(stats.llm).toEqual({ calls: 1, errors: 0, promptTokens: 10, completionTokens: 2 });
    expect(stats.tools).toEqual({ say: 1 });
    expect(traceRoot()).toBe(dir);
  });

  it("保留策略：老文件默认压缩归档，归档后仍可读；--delete 才真删", async () => {
    const gameDir = join(dir, "trace-gc");
    await mkdir(gameDir, { recursive: true });
    const line = (turnId: string) =>
      `${JSON.stringify({
        v: 1,
        at: "2025-01-01T00:00:00.000Z",
        gameId: "game-gc",
        gameSlug: "trace-gc",
        turnId,
        turnKind: "player",
        event: "turn_start",
        label: "old",
      })}\n`;
    await writeFile(join(gameDir, "20250101.jsonl"), line("old-turn"), "utf8");

    const dryRun = await gcTrace({ before: "20260101", gameSlug: "trace-gc", dryRun: true });
    expect(dryRun.compressed.map((file) => file.endsWith("20250101.jsonl"))).toEqual([true]);

    const compressed = await gcTrace({ before: "20260101", gameSlug: "trace-gc" });
    expect(compressed.compressed).toHaveLength(1);
    // 归档后读取侧透明支持 .jsonl.gz。
    expect((await listTurns({ gameSlug: "trace-gc" })).map((turn) => turn.turnId)).toEqual([
      "old-turn",
    ]);

    // 同一天继续追加：归档在前、新文件在后，读取顺序等于发生顺序。
    await writeFile(join(gameDir, "20250101.jsonl"), line("new-turn"), "utf8");
    expect((await listTurns({ gameSlug: "trace-gc" })).map((turn) => turn.turnId)).toEqual([
      "old-turn",
      "new-turn",
    ]);

    const deleted = await gcTrace({ before: "20260101", gameSlug: "trace-gc", delete: true });
    expect(deleted.deleted).toHaveLength(2);
    expect(await listTurns({ gameSlug: "trace-gc" })).toEqual([]);
  });

  it("关闭时不落任何文件", async () => {
    const trace = createTurnTrace({ game: GAME, turnKind: "stage" });
    expect(trace).toBeUndefined();
    await traceEvent(trace, { event: "turn_start", label: "无" });
  });
});
