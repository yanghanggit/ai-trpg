import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { createGame, getActorView, playerMove, takeActorControl } from "../src/game";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

/**
 * 观看者投影：客户端要按角色视角展示时，读这个角色的记忆（本来就按观察者渲染过），
 * 而不是重新渲染公共事件流——后者的文本在写入时就已含规范名。
 */
describe.skipIf(!testDatabaseUrl)("actor view", () => {
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

  it("projects the scene and log through the viewer's knowledge", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "观看者投影测试局",
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "角色.无名者");
    await playerMove(handle.db, created.game.slug, "角色.无名者", {
      targetStageName: "场景.墓园",
    });

    // 煤渣认识奥德里克，但没见过无名者的名字。
    const view = await getActorView(handle.db, created.game.slug, "角色.煤渣");
    expect(view.viewer.name).toBe("角色.煤渣");
    expect(view.scene?.name).toBe("场景.墓园");
    expect(view.scene?.exits.map((exit) => exit.name).sort()).toEqual(
      ["场景.地窖", "场景.焚尸房", "场景.铁闸门"].sort(),
    );

    const self = view.scene?.actors.find((actor) => actor.self);
    expect(self?.actorId).toBe(view.viewer.actorId);
    expect(self?.label).toBe("你自己");

    const odric = view.scene?.actors.find((actor) => actor.knownName === "奥德里克");
    expect(odric?.label).toContain("奥德里克");
    expect(odric?.token).toMatch(/^@\d+$/);

    const stranger = view.scene?.actors.find(
      (actor) => !actor.self && actor.label.includes("裹尸布"),
    );
    expect(stranger?.knownName).toBeNull();
    expect(stranger?.token).toMatch(/^@\d+$/);
    expect(view.scene?.actors.some((actor) => actor.label.includes("无名者"))).toBe(false);

    const log = view.log.map((entry) => entry.content).join("\n");
    expect(log).toContain("裹尸布");
    expect(log).not.toContain("无名者");
    expect(view.knowledge).toHaveLength(1);
  });

  it("keeps scene items free of type prefixes", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "观看者物品测试局",
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "角色.无名者");
    await playerMove(handle.db, created.game.slug, "角色.无名者", {
      targetStageName: "场景.墓园",
    });
    await playerMove(handle.db, created.game.slug, "角色.无名者", {
      targetStageName: "场景.焚尸房",
    });

    const view = await getActorView(handle.db, created.game.slug, "角色.无名者");
    expect(view.scene?.name).toBe("场景.焚尸房");
    // 内容里是 `武器.松脂火把`，角色看到的是去掉类型前缀的写法。
    expect(view.scene?.items.map((item) => item.name)).toEqual(["松脂火把"]);
  });
});
