import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { createGame, getGameState, playerMove, takeActorControl } from "../src/game";
import type { World } from "../src/game/content";
import { buildActorTurnInput } from "../src/game/npc";
import { recordStageVisit } from "../src/game/persistence/visits";
import { buildKnownStagesTool, describeKnownStages } from "../src/game/plan";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!testDatabaseUrl)("stage visits", () => {
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

  it("hides unvisited exit names behind entity numbers and reveals them after arrival", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "访问列表测试局",
      world: TEST_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const before = await getGameState(handle.db, created.game.slug);
    const gate = before.world.stages.find((stage) => stage.name === "灰烬门廊");
    const nave = before.world.stages.find((stage) => stage.name === "断钟中殿");
    const keeper = gate?.actors.find((actor) => actor.name === "守烬人");
    if (!gate || !nave || !keeper) {
      throw new Error("缺少测试数据");
    }

    expect(buildActorTurnInput(before, { actor: keeper, stage: gate })).toContain(`#${nave.seq}`);
    expect(buildActorTurnInput(before, { actor: keeper, stage: gate })).not.toContain("断钟中殿");

    expect(describeKnownStages(before, keeper.id, gate.id)).toContain("灰烬门廊（当前）");
    expect(describeKnownStages(before, keeper.id, gate.id)).not.toContain("断钟中殿");
    expect(buildKnownStagesTool().function.name).toBe("get_known_stages");

    const moved = await playerMove(handle.db, created.game.slug, "守烬人", {
      targetStageRef: `#${nave.seq}`,
    });
    expect(moved.ok).toBe(true);

    const after = await getGameState(handle.db, created.game.slug);
    const movedNave = after.world.stages.find((stage) => stage.name === "断钟中殿");
    const movedKeeper = movedNave?.actors.find((actor) => actor.name === "守烬人");
    if (!movedNave || !movedKeeper) {
      throw new Error("移动后缺少测试数据");
    }

    expect(after.visits.filter((visit) => visit.actorId === keeper.id)).toHaveLength(2);
    const input = buildActorTurnInput(after, { actor: movedKeeper, stage: movedNave });
    expect(input).toContain("@灰烬门廊");
    expect(input).not.toContain(`#${gate.seq}`);
    expect(describeKnownStages(after, movedKeeper.id, movedNave.id)).toContain("断钟中殿（当前）");
  });

  it("orders visits that share a timestamp by stage ordinal", async () => {
    // 同一回合的多次到达共享同一个 now；并列时要按场景序号兜底，顺序才可复现。
    const world: World = {
      ...TEST_WORLD,
      contentVersion: "test-visits-order.v1",
      stages: [
        ...TEST_WORLD.stages,
        {
          key: "crypt",
          name: "灰烬地窖",
          profile: "中殿地下的石室，墙上刻满了谁都不再读的名单。",
          actions: ["submit_environment", "notify_world"],
          environment: "台阶上积着灰，墙角的旧蜡还在慢慢淌。",
        },
      ],
      connections: [...TEST_WORLD.connections, { from: "gate", to: "crypt" }],
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "访问顺序测试局",
      world,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const state = await getGameState(handle.db, created.game.slug);
    const stageId = (key: string) => {
      const stage = state.world.stages.find((candidate) => candidate.key === key);
      if (!stage) {
        throw new Error(`缺少场景: ${key}`);
      }
      return stage.id;
    };
    const keeper = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人");
    if (!keeper) {
      throw new Error("缺少测试数据");
    }

    // 倒序写入同一时刻：读取顺序应来自场景序号，而不是写入先后。
    const sameNow = new Date(Date.now() + 60_000);
    await recordStageVisit(handle.db, state.game.id, keeper.id, stageId("crypt"), sameNow);
    await recordStageVisit(handle.db, state.game.id, keeper.id, stageId("nave"), sameNow);

    const after = await getGameState(handle.db, created.game.slug);
    expect(
      after.visits.filter((visit) => visit.actorId === keeper.id).map((v) => v.stageId),
    ).toEqual([stageId("gate"), stageId("nave"), stageId("crypt")]);
  });
});
