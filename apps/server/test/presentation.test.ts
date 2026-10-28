import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { createGame, getGameState } from "../src/game";
import { resolveAppearance } from "../src/game/body";
import { setActorAppearance } from "../src/game/persistence/actors";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

/**
 * 形象（presentation）是外观的唯一存储位置：actor 只持有身份与身体，
 * 「别人此刻看到的样子」永远属于某一条形象。伪装 / 变身将来靠切换形象实现。
 */
describe.skipIf(!testDatabaseUrl)("actor presentations", () => {
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

  it("creates exactly one current presentation per actor", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "形象测试局",
      world: TEST_WORLD,
    });
    const state = await getGameState(handle.db, created.game.slug);
    const actors = state.world.stages.flatMap((stage) => stage.actors);

    expect(actors).toHaveLength(TEST_WORLD.actors.length);
    const presentationIds = actors.map((actor) => actor.presentation.id);
    const presentationSeqs = actors.map((actor) => actor.presentation.seq);
    expect(new Set(presentationIds).size).toBe(actors.length);
    expect(new Set(presentationSeqs).size).toBe(actors.length);

    for (const actor of actors) {
      const source = TEST_WORLD.actors.find((candidate) => candidate.key === actor.key);
      if (!source) {
        throw new Error(`缺少 actor 内容: ${actor.key}`);
      }
      // 快照把展示值拍平到 appearance；存储位置仍是形象。
      expect(actor.appearance).toBe(resolveAppearance(source));
      expect(actor.presentation.anchor).toBe(source.baseBody.description);
      expect(actor.presentation.isDefault).toBe(true);
    }
  });

  it("stores the appearance on the presentation, not on the actor row", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "形象存储测试局",
      world: TEST_WORLD,
    });
    const state = await getGameState(handle.db, created.game.slug);
    const actor = state.world.stages.flatMap((stage) => stage.actors)[0];
    if (!actor) {
      throw new Error("缺少 actor");
    }

    // 写外观只改形象；actor 行不再有 appearance 列。
    await handle.db.transaction(async (tx) => {
      await setActorAppearance(tx, actor.id, "被雨淋透的旧斗篷。");
    });
    const updated = await getGameState(handle.db, created.game.slug);
    const reloaded = updated.world.stages.flatMap((stage) => stage.actors)[0];
    expect(reloaded?.appearance).toBe("被雨淋透的旧斗篷。");
    expect(reloaded?.presentation.id).toBe(actor.presentation.id);
  });

  it("rejects content without an actor key", async () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map(({ key: _key, ...rest }) => rest),
    } as unknown as typeof TEST_WORLD;
    await expect(
      createGame(handle.db, { username: DEMO_USER.username, name: "缺 key 局", world }),
    ).rejects.toThrow();
  });
});
