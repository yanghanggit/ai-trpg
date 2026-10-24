import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_USER } from "../src/db/demo-fixture";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getGameState,
  loadAgentMemory,
  playerMove,
  takeActorControl,
} from "../src/game";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!testDatabaseUrl)("move writes memory on both sides", () => {
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

  it("离开方与进入方都有记忆，且移动者记得路线", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "移动记忆测试局",
      world: TEST_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const result = await playerMove(handle.db, created.game.slug, "守烬人", {
      targetStageName: "断钟中殿",
    });
    expect(result.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const stages = state.world.stages;
    const gate = stages.find((stage) => stage.name === "灰烬门廊");
    const nave = stages.find((stage) => stage.name === "断钟中殿");
    if (!gate || !nave) {
      throw new Error("缺少测试数据");
    }
    // ActorState 不带 stageId：按所在场景确认移动结果。
    const keeper = nave.actors.find((a) => a.name === "守烬人");
    const monk = gate.actors.find((a) => a.name === "提灯修士");
    const scribe = nave.actors.find((a) => a.name === "缄默抄经人");
    if (!keeper || !monk || !scribe) {
      throw new Error("缺少测试数据");
    }
    expect(gate.actors.map((actor) => actor.name)).not.toContain("守烬人");

    const read = async (kind: "stage" | "actor", id: string) => {
      const memory = await loadAgentMemory(handle.db, created.game.id, kind, id);
      return memory?.messages.map((message) => message.content).join("\n") ?? "";
    };

    // 只有移动者自己知道完整路线。
    const own = await read("actor", keeper.id);
    expect(own).toContain("你从灰烬门廊抵达了断钟中殿");

    // 旧场景：只知道“他走了”，不知道他去了哪。
    const gateStage = await read("stage", gate.id);
    const monkMemory = await read("actor", monk.id);
    expect(gateStage).toContain("守烬人离开了灰烬门廊");
    expect(monkMemory).toContain("守烬人离开了灰烬门廊");
    expect(gateStage).not.toContain("断钟中殿");
    expect(monkMemory).not.toContain("断钟中殿");

    // 新场景：只知道“他来了”，不知道他从哪来。
    const naveStage = await read("stage", nave.id);
    const scribeMemory = await read("actor", scribe.id);
    expect(naveStage).toContain("守烬人进入了断钟中殿");
    expect(scribeMemory).toContain("守烬人进入了断钟中殿");
    expect(naveStage).not.toContain("灰烬门廊");
    expect(scribeMemory).not.toContain("灰烬门廊");

    // 移动者不会收到自己的离开/进入观察，只留一条行动结果。
    expect(own).not.toContain("守烬人离开了灰烬门廊");
    expect(own).not.toContain("守烬人进入了断钟中殿");
  });
});
