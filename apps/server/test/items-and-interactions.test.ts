import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_USER } from "../src/db/demo-fixture";
import type { World } from "../src/game/types";
import { TEST_WORLD } from "./test-world";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getGameMemories,
  getGameState,
  playerAttack,
  playerGive,
  playerMove,
  playerPickup,
  playerSteal,
  playerUse,
  takeActorControl,
} from "../src/game";

const SEALED_STAGE_NAME = "场景.封印门";
const SEALED_KEY_NAME = "饰品.测试钥匙";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

const ITEM_WORLD = {
  ...TEST_WORLD,
  stages: TEST_WORLD.stages.map((stage) =>
    stage.key === "gate"
      ? {
          ...stage,
          items: [
            {
              key: "test-torch",
              name: "武器.测试火把",
              description: "测试用的场景武器。",
              kind: "weapon" as const,
              count: 1,
              stats: { damage: 7, block: 1 },
            },
          ],
        }
      : stage,
  ),
};

const GATE_STAGE = TEST_WORLD.stages.find((stage) => stage.key === "gate");
const KEEPER_ACTOR = TEST_WORLD.actors.find((actor) => actor.name === "守烬人");
if (!GATE_STAGE || !KEEPER_ACTOR) {
  throw new Error("测试世界缺少灰烬门廊或守烬人");
}

const WEAPON_WORLD = {
  ...TEST_WORLD,
  actors: TEST_WORLD.actors.map((actor) =>
    actor.name === "提灯修士"
      ? {
          ...actor,
          items: actor.items.map((item) =>
            item.name === "铅封提灯" ? { ...item, stats: { ...item.stats, block: 2 } } : item,
          ),
        }
      : actor,
  ),
};

const SEALED_WORLD: World = {
  ...TEST_WORLD,
  stages: [
    GATE_STAGE,
    {
      key: "sealed-gate",
      name: SEALED_STAGE_NAME,
      profile: "测试用铁闸门。",
      actions: ["submit_environment"] as const,
      environment: "门板上刻着鼠牙。",
    },
  ],
  connections: [
    { from: "gate", to: "sealed-gate" },
    { from: "sealed-gate", to: "gate" },
  ],
  actors: [
    {
      ...KEEPER_ACTOR,
      stageKey: "gate",
      items: [
        {
          key: "sealed-key",
          name: SEALED_KEY_NAME,
          description: "测试用闸门钥匙。",
          kind: "accessory" as const,
        },
      ],
    },
  ],
};

describe.skipIf(!testDatabaseUrl)("items and interactions", () => {
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

  it("steals an item privately and leaves an observer unaware", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "窃取测试局",
      world: ITEM_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const stolen = await playerSteal(handle.db, created.game.slug, "守烬人", {
      targetActorName: "提灯修士",
      itemName: "铅封提灯",
    });
    expect(stolen.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.messages.at(-1)?.kind).toBe("steal");
    expect(state.messages.at(-1)?.visibility).toBe("private");
    const keeper = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人");
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(keeper?.items.map((item) => item.name)).toContain("铅封提灯");
    expect(monk?.items.map((item) => item.name)).not.toContain("铅封提灯");

    const memories = await getGameMemories(handle.db, created.game.id);
    const monkMemory = memories.find((memory) => memory.name === "提灯修士");
    const observerMemory = memories.find((memory) => memory.name === "缄默抄经人");
    expect(monkMemory?.messages.some((message) => message.content.includes("你被窃取"))).toBe(true);
    expect(observerMemory?.messages.some((message) => message.content.includes("取走了"))).toBe(
      false,
    );
  });

  it("rejects steal for an actor whose actions do not include it", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "权限测试局",
      world: ITEM_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "提灯修士");

    await expect(
      playerSteal(handle.db, created.game.slug, "提灯修士", {
        targetActorName: "守烬人",
        itemName: "裂齿短刃",
      }),
    ).rejects.toThrow("不能使用动作: steal");
  });

  it("adds weapon damage but uses target defense as the only block", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "武器伤害测试局",
      world: WEAPON_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const attacked = await playerAttack(handle.db, created.game.slug, "守烬人", {
      targetActorName: "提灯修士",
      itemNames: ["裂齿短刃"],
    });
    expect(attacked.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk?.stats.hp).toBe(4);
    expect(state.messages.at(-1)?.content).toContain("造成6点伤害");
  });

  it("gives an owned item to a living actor in the same stage", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "给予测试局",
      world: ITEM_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const given = await playerGive(handle.db, created.game.slug, "守烬人", {
      targetActorName: "提灯修士",
      itemName: "裂齿短刃",
    });
    expect(given.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk?.items.map((item) => item.name)).toContain("裂齿短刃");
    expect(state.messages.at(-1)?.kind).toBe("give");

    const memories = await getGameMemories(handle.db, created.game.id);
    const monkMemory = memories.find((memory) => memory.name === "提灯修士");
    expect(monkMemory?.messages.some((message) => message.content.includes("你收到物品"))).toBe(
      true,
    );
  });

  it("picks up a stage item into the actor inventory", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "拾取测试局",
      world: ITEM_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const picked = await playerPickup(handle.db, created.game.slug, "守烬人", {
      itemName: "武器.测试火把",
    });
    expect(picked.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const gate = state.world.stages.find((stage) => stage.name === "灰烬门廊");
    const keeper = gate?.actors.find((actor) => actor.name === "守烬人");
    expect(gate?.items).toEqual([]);
    const torch = keeper?.items.find((item) => item.name === "武器.测试火把");
    expect(torch).toMatchObject({
      key: "test-torch",
      count: 1,
      stats: { damage: 7, block: 1 },
    });
  });

  it("records where an item was used on a stage without completing the game", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场景使用描述测试局",
      world: SEALED_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    await playerMove(handle.db, created.game.slug, "守烬人", {
      targetStageName: SEALED_STAGE_NAME,
    });

    const used = await playerUse(handle.db, created.game.slug, "守烬人", {
      targetStageName: SEALED_STAGE_NAME,
      itemName: SEALED_KEY_NAME,
      targetDetail: "锁孔",
    });
    expect(used.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.game.status).toBe("active");
    expect(state.messages.at(-1)?.content).toContain("的锁孔");
    expect(state.messages.some((message) => message.kind === "game_completed")).toBe(false);

    const memories = await getGameMemories(handle.db, created.game.id);
    const stageMemory = memories.find((memory) => memory.name === SEALED_STAGE_NAME);
    expect(stageMemory?.messages.some((message) => message.content.includes("的锁孔"))).toBe(true);
  });
});
