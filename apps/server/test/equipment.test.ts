import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DARK_FANTASY_WORLD } from "../seeds/dark-fantasy";
import { DEMO_USER } from "../src/db/demo-fixture";
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
      world: DARK_FANTASY_WORLD,
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
    expect(state.messages.map((message) => message.kind)).toEqual([
      "narration",
      "unequip",
      "equip",
    ]);
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
});
