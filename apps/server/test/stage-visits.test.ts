import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { createGame, getGameState, playerMove, takeActorControl } from "../src/game";
import { buildActorTurnInput } from "../src/game/npc";
import { buildVisitedStagesTool, describeVisitedStages } from "../src/game/plan";
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

    expect(describeVisitedStages(before, keeper.id, gate.id)).toContain("灰烬门廊（当前）");
    expect(describeVisitedStages(before, keeper.id, gate.id)).not.toContain("断钟中殿");
    expect(buildVisitedStagesTool().function.name).toBe("get_visited_stages");

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
    expect(describeVisitedStages(after, movedKeeper.id, movedNave.id)).toContain(
      "断钟中殿（当前）",
    );
  });
});
