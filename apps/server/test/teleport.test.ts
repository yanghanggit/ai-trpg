import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getActorView,
  getGameState,
  playerMove,
  playerTeleport,
  takeActorControl,
} from "../src/game";
import { buildActorObservation } from "../src/game/npc";
import { teleportTargetsFor } from "../src/game/teleport";
import type { World } from "../src/game/types";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

function teleportWorld(blockedNave = false): World {
  return {
    ...TEST_WORLD,
    contentVersion: "test-teleport.v1",
    stages: TEST_WORLD.stages.map((stage) =>
      stage.key === "nave" && blockedNave ? { ...stage, teleportBlocked: true } : stage,
    ),
    actors: TEST_WORLD.actors.map((actor) =>
      actor.key === "ember-keeper"
        ? { ...actor, actions: [...actor.actions, "teleport" as const] }
        : actor,
    ),
  };
}

describe.skipIf(!testDatabaseUrl)("teleport", () => {
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

  const createGameWith = async (name: string, world: World) => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name,
      world,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    return created;
  };

  it("records the starting stage and creates no teleport target until another stage is visited", async () => {
    const created = await createGameWith("传送初始测试局", teleportWorld());
    const state = await getGameState(handle.db, created.game.slug);
    const keeper = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人");
    if (!keeper) {
      throw new Error("缺少守烬人");
    }
    const gate = state.world.stages.find((stage) => stage.key === "gate");
    if (!gate) {
      throw new Error("缺少灰烬门廊");
    }

    expect(
      state.visits.filter((visit) => visit.actorId === keeper.id).map((v) => v.stageId),
    ).toEqual([gate.id]);
    expect(teleportTargetsFor(state, keeper, gate)).toEqual([]);

    const view = await getActorView(handle.db, created.game.slug, "守烬人");
    expect(view.visitedStages).toEqual([{ stageId: gate.id, name: "灰烬门廊" }]);
    expect(view.teleportTargets).toEqual([]);
  });

  it("rejects a stage that has not been visited", async () => {
    const created = await createGameWith("传送未访问测试局", teleportWorld());
    await expect(
      playerTeleport(handle.db, created.game.slug, "守烬人", { targetStageRef: "断钟中殿" }),
    ).rejects.toThrow(/没有去过/);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.game.version).toBe(0);
  });

  it("teleports to a visited, unblocked stage and records the arrival", async () => {
    const created = await createGameWith("传送成功测试局", teleportWorld());
    await playerMove(handle.db, created.game.slug, "守烬人", { targetStageRef: "断钟中殿" });

    const before = await getGameState(handle.db, created.game.slug);
    const keeper = before.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人");
    const gate = before.world.stages.find((stage) => stage.key === "gate");
    const nave = before.world.stages.find((stage) => stage.key === "nave");
    if (!keeper || !gate || !nave) {
      throw new Error("缺少测试数据");
    }
    expect(teleportTargetsFor(before, keeper, nave)).toEqual([gate]);
    expect(buildActorObservation(before, { actor: keeper, stage: nave })).toContain(
      "可传送至（已去过且未禁传）",
    );

    const result = await playerTeleport(handle.db, created.game.slug, "守烬人", {
      targetStageRef: "灰烬门廊",
    });
    expect(result.ok).toBe(true);

    const after = await getGameState(handle.db, created.game.slug);
    expect(
      after.world.stages
        .find((stage) => stage.key === "gate")
        ?.actors.some((actor) => actor.name === "守烬人"),
    ).toBe(true);
    const visits = after.visits.filter((visit) => visit.actorId === keeper.id);
    expect(visits.map((visit) => visit.stageId).sort()).toEqual([gate.id, nave.id].sort());
    expect(after.messages.at(-1)?.kind).toBe("teleport");
  });

  it("blocks teleport out of a teleport_blocked stage", async () => {
    const created = await createGameWith("传送禁出测试局", teleportWorld(true));
    await playerMove(handle.db, created.game.slug, "守烬人", { targetStageRef: "断钟中殿" });

    await expect(
      playerTeleport(handle.db, created.game.slug, "守烬人", { targetStageRef: "灰烬门廊" }),
    ).rejects.toThrow(/禁止传送/);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.world.stages.find((stage) => stage.key === "nave")?.teleportBlocked).toBe(true);
  });

  it("blocks teleport into a teleport_blocked stage", async () => {
    const created = await createGameWith("传送禁入测试局", teleportWorld(true));

    // 走进被禁传的中殿是允许的：teleport_blocked 只影响 teleport。
    await playerMove(handle.db, created.game.slug, "守烬人", { targetStageRef: "断钟中殿" });
    const afterMove = await getGameState(handle.db, created.game.slug);
    expect(
      afterMove.world.stages
        .find((stage) => stage.key === "nave")
        ?.actors.some((actor) => actor.name === "守烬人"),
    ).toBe(true);

    await playerMove(handle.db, created.game.slug, "守烬人", { targetStageRef: "灰烬门廊" });
    await expect(
      playerTeleport(handle.db, created.game.slug, "守烬人", { targetStageRef: "断钟中殿" }),
    ).rejects.toThrow(/禁止传送/);
  });

  it("requires the actor to have the teleport action", async () => {
    const created = await createGameWith("传送能力测试局", TEST_WORLD);
    await expect(
      playerTeleport(handle.db, created.game.slug, "守烬人", { targetStageRef: "断钟中殿" }),
    ).rejects.toThrow(/不能使用动作: teleport/);
  });
});
