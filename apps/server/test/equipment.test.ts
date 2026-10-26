import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";
import { DEMO_USER } from "../src/db/demo-fixture";
import { TEST_WORLD } from "./test-world";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getGameState,
  playerEquip,
  playerUnequip,
  takeActorControl,
} from "../src/game";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!testDatabaseUrl)("equip and unequip actions", () => {
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

  const createKeeperGame = async (name: string) => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name,
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "角色.奥德里克");
    return created;
  };

  it("换装只改穿戴索引，不自动重写外观快照", async () => {
    const created = await createKeeperGame("换装不推外观测试局");
    const before = await getGameState(handle.db, created.game.slug);
    const appearanceBefore = before.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "角色.奥德里克")?.appearance;

    // 先把斗篷卸下，再穿回去，两次都是纯动作。
    const removed = await playerUnequip(handle.db, created.game.slug, "角色.奥德里克", {
      slot: "armor",
    });
    expect(removed.ok).toBe(true);
    expect(removed.plan?.actions[0]).toEqual({ kind: "unequip", slot: "armor" });

    const worn = await playerEquip(handle.db, created.game.slug, "角色.奥德里克", {
      itemName: "装备.补丁斗篷",
      slot: "armor",
    });
    expect(worn.ok).toBe(true);
    expect(worn.plan?.actions[0]).toEqual({
      kind: "equip",
      itemName: "装备.补丁斗篷",
      slot: "armor",
    });

    const state = await getGameState(handle.db, created.game.slug);
    const keeper = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "角色.奥德里克");
    expect(keeper?.equipment.armor).toBe("装备.补丁斗篷");
    // 外观是独立快照：动作不会顺手改它，需要 agent:game appearance 单独推动。
    expect(keeper?.appearance).toBe(appearanceBefore);
    expect(state.messages.map((message) => message.kind)).toEqual(["unequip", "equip"]);
  });

  it("物品仍在背包里，只是不再计入穿戴", async () => {
    const created = await createKeeperGame("卸下后仍在背包测试局");
    const removed = await playerUnequip(handle.db, created.game.slug, "角色.奥德里克", {
      slot: "weapon",
    });
    expect(removed.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const keeper = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "角色.奥德里克");
    expect(keeper?.equipment.weapon).toBeUndefined();
    expect(keeper?.items.map((item) => item.name)).toContain("武器.掘墓人的铁锹");
  });

  it("槽位大类不匹配时拒绝", async () => {
    const created = await createKeeperGame("槽位大类测试局");
    await expect(
      playerEquip(handle.db, created.game.slug, "角色.奥德里克", {
        itemName: "饰品.闸门钥匙",
        slot: "armor",
      }),
    ).rejects.toThrow("不能放进护甲槽");
  });

  it("空槽位不能卸下", async () => {
    const created = await createKeeperGame("空槽位测试局");
    await expect(
      playerUnequip(handle.db, created.game.slug, "角色.奥德里克", { slot: "accessory2" }),
    ).rejects.toThrow("槽没有装备");
  });

  it("同槽再穿一件是替换：旧装备退回背包，外观不动", async () => {
    const spare = {
      key: "spare-blade",
      name: "备用短刀",
      description: "刀背磨得发亮。",
      kind: "weapon" as const,
      count: 1,
      stats: { damage: 2, block: 0 },
      effect: { type: "damage" as const },
    };
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人" ? { ...actor, items: [...actor.items, spare] } : actor,
      ),
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "同槽替换测试局",
      world,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    const appearanceBefore = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人")?.appearance;

    // 背包里已有裂齿短刃，换成备用短刀。
    await playerEquip(handle.db, created.game.slug, "守烬人", {
      itemName: "备用短刀",
      slot: "weapon",
    });
    let state = await getGameState(handle.db, created.game.slug);
    const afterFirst = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人");
    expect(afterFirst?.equipment.weapon).toBe("备用短刀");

    // 再穿回裂齿短刃：不报错、不需要先卸下，槽位直接替换。
    await playerEquip(handle.db, created.game.slug, "守烬人", {
      itemName: "裂齿短刃",
      slot: "weapon",
    });
    state = await getGameState(handle.db, created.game.slug);
    const keeper = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人");
    expect(keeper?.equipment.weapon).toBe("裂齿短刃");
    // 被替换下来的装备仍在背包里，没有丢也没有重复穿戴。
    expect(keeper?.items.map((item) => item.name).sort()).toEqual(["备用短刀", "裂齿短刃"]);
    expect(Object.values(keeper?.equipment ?? {}).filter((name) => name === "备用短刀")).toEqual(
      [],
    );
    // 换装只改索引：外观快照保持原样，不触发任何推理。
    expect(keeper?.appearance).toBe(appearanceBefore);
    expect(state.messages.map((message) => message.kind)).toEqual(["equip", "equip"]);
  });
});
