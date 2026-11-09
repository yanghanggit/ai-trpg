import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { readTurn, type TraceContext } from "../src/debug/trace";
import { createGame } from "../src/game";
import { type AffixRequest, runAffixPhase } from "../src/game/affixes";
import type { ChatCompletionService } from "../src/llm";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

const trace: TraceContext = {
  gameId: "00000000-0000-4000-8000-000000000000",
  gameSlug: "affix-phase-test",
  turnId: "22222222-2222-4222-8222-222222222222",
  turnKind: "actor",
};

/** 词缀阶段的输入只要形状正确；这条测试不落到任何物品上。 */
const REQUEST: AffixRequest = {
  actorId: "00000000-0000-4000-8000-000000000001",
  itemId: "00000000-0000-4000-8000-000000000002",
  trigger: "strike",
  defaultFeedback: "刀锋磕在骨头上。",
};

/** 一旦被调用就说明定位阶段没有先失败；本用例只关心外层的兜底。 */
const UNREACHABLE_SERVICE: ChatCompletionService = {
  complete: async () => {
    throw new Error("定位失败时不应调用模型");
  },
};

async function lastPhase() {
  const phases = (await readTurn(trace.turnId)).flatMap((line) =>
    line.event === "phase" ? [line] : [],
  );
  return phases.at(-1);
}

describe.skipIf(!testDatabaseUrl)("词缀阶段的兜底", () => {
  let handle: DatabaseHandle;
  let dir = "";
  const previous = process.env.TRACE_DIR;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ai-trpg-affix-phase-"));
    process.env.TRACE_DIR = dir;
    handle = openDatabase("TEST_DATABASE_URL");
    await runMigrations(handle.db);
    await resetDomainData(handle.db);
    await seedDemoData(handle.db);
  });

  afterAll(async () => {
    await handle.pool.end();
    if (previous === undefined) {
      delete process.env.TRACE_DIR;
    } else {
      process.env.TRACE_DIR = previous;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("没有 service 时记为 skipped，而不是失败", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "词缀兜底测试局",
      world: TEST_WORLD,
    });

    await runAffixPhase(handle.db, created.game.slug, REQUEST, undefined, trace);

    const phase = await lastPhase();
    expect(phase?.status).toBe("skipped");
    expect(phase?.detail).toMatchObject({ reason: "未配置 LLM service" });
  });

  it("抛错只落一条 failed，不外抛；下一件物品照常结算", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "词缀独立测试局",
      world: TEST_WORLD,
    });

    await expect(
      runAffixPhase(handle.db, "不存在的局", REQUEST, UNREACHABLE_SERVICE, trace),
    ).resolves.toBeUndefined();

    const failed = await lastPhase();
    expect(failed?.status).toBe("failed");
    expect(failed?.detail).toMatchObject({ reason: expect.stringContaining("游戏不存在") });

    // 前一件失败不改变后一件的结果。
    await runAffixPhase(handle.db, created.game.slug, REQUEST, undefined, trace);
    expect((await lastPhase())?.status).toBe("skipped");
  });
});
