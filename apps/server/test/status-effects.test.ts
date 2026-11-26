import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { createGame } from "../src/game";
import { describeStats } from "../src/game/agents/actor-turn";
import { effectiveSourcesOf } from "../src/game/gameplay";
import { EMPTY_STATS } from "../src/game/kernel/attributes";
import { DEMO_USER } from "../src/identity";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

/**
 * 守烬人开局带一条静态效果：力量 -2。
 *
 * 效果只写在内容里；建局时物化进 actor 行，面板与结算都读同一份现值。
 */
const EFFECT_WORLD = {
  ...TEST_WORLD,
  actors: TEST_WORLD.actors.map((actor) =>
    actor.name === "守烬人"
      ? {
          ...actor,
          statusEffects: [
            { key: "hunger", name: "饥饿", content: "力气被抽走。", stats: { strength: -2 } },
          ],
        }
      : actor,
  ),
};

describe.skipIf(!testDatabaseUrl)("status effects", () => {
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

  it("建局时注入 actor 行，面板与现值读同一条加法", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "状态效果测试局",
      world: EFFECT_WORLD,
    });
    const keeper = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人");
    if (!keeper) {
      throw new Error("缺少守烬人");
    }

    // 落库的是归一化后的完整形状：未写出的字段补 0。
    expect(keeper.statusEffects).toEqual([
      {
        key: "hunger",
        name: "饥饿",
        content: "力气被抽走。",
        stats: { ...EMPTY_STATS, strength: -2 },
      },
    ]);
    // 本体力量 6 - 效果 2 = 4；武器终值 3 另算。
    expect(effectiveSourcesOf(keeper)).toMatchObject({ strength: 4, agility: 4 });
    expect(describeStats(keeper)).toContain("力量：4");
    expect(describeStats(keeper)).toContain("伤害：7");
    expect(describeStats(keeper)).toContain("状态效果：[饥饿]力气被抽走。");
  });
});
