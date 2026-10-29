import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_USER } from "../src/db/demo-fixture";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { createGame, getGameMemories, getGameState } from "../src/game";
import { appendSelfObservation, appendStageMemory } from "../src/game/observations";
import { TEST_WORLD } from "./test-world";

/**
 * 世界面写 seam：actor 记忆的事件文本（含当事人自述）不得含角色名与引用；
 * stage 自己的记忆是上帝视角，名字合法。
 */

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!testDatabaseUrl)("world-face write seams", () => {
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

  async function fixture() {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: `写 seam 测试局-${Date.now()}`,
      world: TEST_WORLD,
    });
    const state = await getGameState(handle.db, created.game.slug);
    const stage = state.world.stages.find((candidate) => candidate.name === "灰烬门廊");
    const actor = stage?.actors.find((candidate) => candidate.name === "守烬人");
    if (!stage || !actor) {
      throw new Error("TEST_WORLD 缺少夹具");
    }
    return { created, stage, actor };
  }

  async function actorMemory(gameId: string, actorId: string) {
    return (await getGameMemories(handle.db, gameId)).find(
      (memory) => memory.ownerType === "actor" && memory.ownerId === actorId,
    );
  }

  it("rejects a self observation that names an actor", async () => {
    const { created, stage, actor } = await fixture();

    await expect(
      appendSelfObservation(handle.db, created.game.id, stage.id, actor.id, "守烬人看见了你。"),
    ).rejects.toThrow(/自述 不能包含/);

    const memory = await actorMemory(created.game.id, actor.id);
    expect(memory?.messages.some((message) => message.content.includes("守烬人看见了你"))).toBe(
      false,
    );
  });

  it("lets a neutral self observation through and keeps stage memory god-view", async () => {
    const { created, stage, actor } = await fixture();

    await appendSelfObservation(
      handle.db,
      created.game.id,
      stage.id,
      actor.id,
      "火焰舔过你的手背，皮肉在油脂里发紧。",
    );
    const memory = await actorMemory(created.game.id, actor.id);
    expect(
      memory?.messages.some(
        (message) => message.content === "火焰舔过你的手背，皮肉在油脂里发紧。",
      ),
    ).toBe(true);

    // stage 自己是上帝视角：名字与引用不出现在环境与下推里，但允许出现在它自己的记忆。
    await appendStageMemory(handle.db, created.game.id, stage.id, "# 场景事件\n守烬人推开了门。", {
      eventKind: "wait",
    });
    const stageMemory = (await getGameMemories(handle.db, created.game.id)).find(
      (entry) => entry.ownerType === "stage" && entry.ownerId === stage.id,
    );
    expect(
      stageMemory?.messages.some((message) => message.content.includes("守烬人推开了门")),
    ).toBe(true);
  });
});
