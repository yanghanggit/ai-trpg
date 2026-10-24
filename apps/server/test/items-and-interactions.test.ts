import { randomUUID } from "node:crypto";
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
import { ChatCompletionResult, type ChatCompletionService } from "../src/llm";

class AffixDamageService implements ChatCompletionService {
  calls = 0;
  input = "";

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.calls += 1;
    this.input = request.inputMessage;
    const toolCalls = [
      {
        id: randomUUID(),
        type: "function" as const,
        function: {
          name: "damage_target",
          arguments: JSON.stringify({
            targetActorName: "提灯修士",
            amount: 42,
            reason: "测试用词缀伤害",
          }),
        },
      },
      {
        id: randomUUID(),
        type: "function" as const,
        function: { name: "submit_affix", arguments: "{}" },
      },
    ];
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: "tool_calls",
      toolCalls,
    });
  }
}

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
              effect: { type: "damage" },
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
          equipment: { armor: "铅封提灯" },
          items: actor.items.map((item) =>
            item.name === "铅封提灯" ? { ...item, stats: { ...item.stats, block: 2 } } : item,
          ),
        }
      : actor,
  ),
};

const AFFIX_WORLD = {
  ...TEST_WORLD,
  actors: TEST_WORLD.actors.map((actor) =>
    actor.name === "守烬人"
      ? {
          ...actor,
          items: actor.items.map((item) =>
            item.name === "裂齿短刃"
              ? { ...item, affixes: ["对鼠类额外造成武器伤害的一百倍"] }
              : item,
          ),
        }
      : actor,
  ),
};

const ARMORED_MONK_WORLD = {
  ...ITEM_WORLD,
  actors: ITEM_WORLD.actors.map((actor) =>
    actor.name === "提灯修士" ? { ...actor, equipment: { armor: "铅封提灯" } } : actor,
  ),
};

const CORPSE_WORLD = {
  ...ARMORED_MONK_WORLD,
  actors: ARMORED_MONK_WORLD.actors.map((actor) =>
    actor.name === "提灯修士" ? { ...actor, hp: 0, status: "dead" as const } : actor,
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
          effect: { type: "event" },
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

  it("steals a backpack item from a living actor privately and leaves an observer unaware", async () => {
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

  it("refuses to take a worn item from a living actor", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "活人窃取测试局",
      world: ARMORED_MONK_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    await expect(
      playerSteal(handle.db, created.game.slug, "守烬人", {
        targetActorName: "提灯修士",
        itemName: "铅封提灯",
      }),
    ).rejects.toThrow("拿不走已装备的物品");
  });

  it("takes a worn item from a corpse and clears the corpse's slot", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "尸体取物测试局",
      world: CORPSE_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const stolen = await playerSteal(handle.db, created.game.slug, "守烬人", {
      targetActorName: "提灯修士",
      itemName: "铅封提灯",
    });
    expect(stolen.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const actors = state.world.stages.flatMap((stage) => stage.actors);
    expect(
      actors.find((actor) => actor.name === "守烬人")?.items.map((item) => item.name),
    ).toContain("铅封提灯");
    expect(actors.find((actor) => actor.name === "提灯修士")?.equipment.armor).toBeUndefined();
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

  it("routes a weapon effect through use as well", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "使用武器效果测试局",
      world: WEAPON_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const used = await playerUse(handle.db, created.game.slug, "守烬人", {
      itemName: "裂齿短刃",
      targetActorName: "提灯修士",
    });
    expect(used.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    // use 也走同一个伤害公式：6 + 3 - 3（防御）- 2（提灯 block）= 4。
    expect(monk?.hp).toBe(6);
    expect(state.messages.at(-1)?.kind).toBe("use");
  });

  it("routes affixed damage through LLM and applies the computed damage", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "词缀伤害测试局",
      world: AFFIX_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const service = new AffixDamageService();
    const attacked = await playerAttack(
      handle.db,
      created.game.slug,
      "守烬人",
      { targetActorName: "提灯修士" },
      { service },
    );
    expect(attacked.ok).toBe(true);
    expect(service.calls).toBe(1);
    expect(service.input).toContain("对鼠类额外造成武器伤害的一百倍");
    expect(service.input).toContain("种族：人类");

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk?.hp).toBe(0);
    // 死亡广播会追加一条 kind=death 的消息，所以按攻击消息取最近两条。
    const recent = state.messages
      .filter((message) => message.kind === "attack")
      .slice(-2)
      .map((message) => message.content);
    expect(recent[0]).toContain("造成6点伤害");
    expect(recent[1]).toContain("造成42点伤害");
  });

  it("adds equipped weapon damage and lets the target's equipped block reduce it", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "武器伤害测试局",
      world: WEAPON_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const attacked = await playerAttack(handle.db, created.game.slug, "守烬人", {
      targetActorName: "提灯修士",
    });
    expect(attacked.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    // 6（守烬人自身 damage）+ 3（装备武器的 damage，裂齿短刃已装备）- 3（修士 block）- 2（铅封提灯 block）= 4
    expect(monk?.hp).toBe(6);
    expect(state.messages.at(-1)?.content).toContain("造成4点伤害");
  });

  it("attacks unarmed when the weapon slot is empty", async () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人" ? { ...actor, equipment: {} } : actor,
      ),
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "空手攻击测试局",
      world,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const attacked = await playerAttack(handle.db, created.game.slug, "守烬人", {
      targetActorName: "提灯修士",
    });
    expect(attacked.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    // 空手：6（自身 damage）- 3（修士 block）= 3 点伤害；背包里的裂齿短刃没装备，不参与结算。
    expect(monk?.hp).toBe(7);
    expect(state.messages.at(-1)?.content).toContain("造成3点伤害");
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
