import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getGameMemories,
  getMemoryState,
  playerWait,
  takeActorControl,
} from "../src/game";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

/**
 * 批量投影与单 owner 投影必须同形同序：前者一次取回全部消息，后者按 owner 查。
 * 两边漂移会让日志、审计与故事整理看到不同顺序。
 */
describe.skipIf(!testDatabaseUrl)("memory store projections", () => {
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

  it("keeps both projections in the same shape and order", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "记忆投影一致性测试局",
      world: TEST_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    await playerWait(handle.db, created.game.slug, "守烬人");
    await playerWait(handle.db, created.game.slug, "守烬人");

    const all = await getGameMemories(handle.db, created.game.id);
    expect(all.length).toBeGreaterThan(1);
    expect(all.map((memory) => memory.name)).toEqual([...all.map((memory) => memory.name)].sort());
    for (const memory of all) {
      const sequences = memory.messages.map((message) => message.sequence);
      expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
      expect(new Set(sequences).size).toBe(sequences.length);
    }

    const keeper = all.find((memory) => memory.name === "守烬人");
    if (!keeper) {
      throw new Error("缺少守烬人的记忆");
    }
    // 两次等待各写一条行动结果，单 owner 投影应与批量结果逐字相同。
    expect(keeper.messages.length).toBeGreaterThan(2);
    expect(await getMemoryState(handle.db, created.game.id, "actor", keeper.ownerId)).toEqual(
      keeper,
    );
  });
});
