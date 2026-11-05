import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getGameMemories,
  getGameState,
  playerPickup,
  takeActorControl,
} from "../src/game";
import { parseWorldContent } from "../src/game/parse-world-content";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

function torch(key: string) {
  return {
    key,
    name: "测试火把",
    description: "测试用的场景武器。",
    kind: "weapon" as const,
    count: 1,
    stats: { damage: 7, block: 1 },
    effect: { type: "damage" as const },
  };
}

/** 同一个场景的两个锚点各放一件同名物品：物品地址是 (锚点, 名字)。 */
const TWO_ANCHOR_WORLD = {
  ...TEST_WORLD,
  stages: TEST_WORLD.stages.map((stage) =>
    stage.key === "gate"
      ? {
          ...stage,
          anchors: [
            {
              key: "latch",
              label: "门闩",
              description: "门板上被灰烬塞住的门闩。",
              items: [torch("torch-latch")],
            },
            {
              key: "niche",
              label: "壁龛",
              items: [
                torch("torch-niche"),
                {
                  key: "spare-key",
                  name: "备用钥匙",
                  description: "一把没有齿纹的钥匙。",
                  kind: "valuable" as const,
                  count: 1,
                  effect: { type: "event" as const },
                },
              ],
            },
          ],
        }
      : stage,
  ),
};

describe("pickup anchors", () => {
  it("allows the same item name under different anchors", () => {
    expect(() => parseWorldContent(TWO_ANCHOR_WORLD)).not.toThrow();
  });
});

describe.skipIf(!testDatabaseUrl)("pickup anchors (db)", () => {
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

  it("resolves the item by anchor and rejects a mismatched anchor", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "锚点拾取测试局",
      world: TWO_ANCHOR_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    // 同名物品必须靠锚点区分：先拿门闩上的那件，壁龛上的不能被顺手带走。
    const first = await playerPickup(handle.db, created.game.slug, "守烬人", {
      targetAnchor: "门闩",
      itemName: "测试火把",
    });
    expect(first.ok).toBe(true);
    let state = await getGameState(handle.db, created.game.slug);
    let gate = state.world.stages.find((stage) => stage.name === "灰烬门廊");
    const anchorItems = (stageName: string) =>
      gate?.anchors.find((anchor) => anchor.label === stageName)?.items.map((item) => item.name) ??
      [];
    expect(anchorItems("门闩")).toEqual([]);
    expect(anchorItems("壁龛")).toEqual(["测试火把", "备用钥匙"]);

    // 锚点对不上：壁龛上没有这件东西。
    await expect(
      playerPickup(handle.db, created.game.slug, "守烬人", {
        targetAnchor: "壁龛",
        itemName: "不存在的东西",
      }),
    ).rejects.toThrow("「壁龛」上没有");
    const memories = await getGameMemories(handle.db, created.game.id);
    const keeperMemory = memories.find((memory) => memory.name === "守烬人");
    expect(keeperMemory?.messages.at(-1)?.content).toContain("「壁龛」上没有");

    // 壁龛上的另一件同名物品仍然可取，并与背包里的等价物品合并。
    const second = await playerPickup(handle.db, created.game.slug, "守烬人", {
      targetAnchor: "壁龛",
      itemName: "测试火把",
    });
    expect(second.ok).toBe(true);
    state = await getGameState(handle.db, created.game.slug);
    gate = state.world.stages.find((stage) => stage.name === "灰烬门廊");
    const keeper = gate?.actors.find((actor) => actor.name === "守烬人");
    expect(keeper?.items.find((item) => item.name === "测试火把")?.count).toBe(2);
  });
});
