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
  learnStageName,
  playerMove,
  takeActorControl,
} from "../src/game";
import { buildActorTurnInput } from "../src/game/npc";
import { describeKnownStages } from "../src/game/plan";
import type { World } from "../src/game/world-definition";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

/** 建局时就「听说过」断钟中殿的测试世界；门廊仍然只来自到访。 */
function worldWithKnowledge(): World {
  return {
    ...TEST_WORLD,
    contentVersion: "test-known-stages.v1",
    knownStages: [
      { actor: "ember-keeper", stage: "nave" },
      { actor: "ember-keeper", stage: "nave" },
    ],
  };
}

describe.skipIf(!testDatabaseUrl)("known stages", () => {
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

  it("records content-declared stage names without a visit", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场景知识测试局",
      world: worldWithKnowledge(),
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const state = await getGameState(handle.db, created.game.slug);
    const gate = state.world.stages.find((stage) => stage.name === "灰烬门廊");
    const nave = state.world.stages.find((stage) => stage.name === "断钟中殿");
    const keeper = gate?.actors.find((actor) => actor.name === "守烬人");
    if (!gate || !nave || !keeper) {
      throw new Error("缺少测试数据");
    }

    // 重复声明只留一条；来源是内容，没有「在哪儿听说」。
    expect(state.knownStages).toEqual([
      {
        actorId: keeper.id,
        stageId: nave.id,
        firstLearnedAt: expect.any(String),
        source: "content",
        learnedStageId: null,
      },
    ]);
    expect(state.visits.filter((visit) => visit.actorId === keeper.id)).toHaveLength(1);

    // 只知道名字也算知道：相邻方向写名字，不再退化成实体编号。
    const input = buildActorTurnInput(state, { actor: keeper, stage: gate });
    expect(input).toContain("@断钟中殿");
    expect(input).not.toContain(`#${nave.seq}`);

    const view = await getActorView(handle.db, created.game.slug, "守烬人");
    expect(view.unvisitedKnownStages).toEqual([{ stageId: nave.id, name: "断钟中殿" }]);
    expect(view.visitedStages).toEqual([{ stageId: gate.id, name: "灰烬门廊" }]);

    expect(describeKnownStages(state, keeper.id, gate.id)).toContain(
      "## 只知道名字，还没去过\n断钟中殿",
    );
  });

  it("keeps visited and only-learned stages in separate sections after arrival", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场景知识到访测试局",
      world: worldWithKnowledge(),
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const before = await getGameState(handle.db, created.game.slug);
    const nave = before.world.stages.find((stage) => stage.name === "断钟中殿");
    if (!nave) {
      throw new Error("缺少测试数据");
    }

    const moved = await playerMove(handle.db, created.game.slug, "守烬人", {
      targetStageRef: `#${nave.seq}`,
    });
    expect(moved.ok).toBe(true);

    const after = await getGameState(handle.db, created.game.slug);
    const keeper = after.world.stages
      .find((stage) => stage.name === "断钟中殿")
      ?.actors.find((actor) => actor.name === "守烬人");
    if (!keeper) {
      throw new Error("移动后缺少测试数据");
    }

    const view = await getActorView(handle.db, created.game.slug, "守烬人");
    expect(view.unvisitedKnownStages).toEqual([]);
    expect(view.visitedStages).toEqual([
      {
        stageId: after.world.stages.find((stage) => stage.name === "灰烬门廊")?.id,
        name: "灰烬门廊",
      },
      { stageId: nave.id, name: "断钟中殿" },
    ]);

    // 知识行不因到访消失，但工具输出里只出现在「去过」那段，不重复列两次。
    const listing = describeKnownStages(after, keeper.id, nave.id);
    expect(listing).toContain("断钟中殿（当前）");
    expect(listing).toContain("## 只知道名字，还没去过\n无");
  });

  it("orders known stages that share a timestamp by stage ordinal", async () => {
    // 建局写入共用同一个 now；并列时按场景序号兜底，顺序才可复现。
    const world: World = {
      ...TEST_WORLD,
      contentVersion: "test-known-stages-order.v1",
      // 先声明 ordinal 更大的场景，检验排序不依赖声明顺序。
      knownStages: [
        { actor: "ember-keeper", stage: "nave" },
        { actor: "ember-keeper", stage: "gate" },
      ],
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场景知识排序测试局",
      world,
    });

    const state = await getGameState(handle.db, created.game.slug);
    const gate = state.world.stages.find((stage) => stage.name === "灰烬门廊");
    const nave = state.world.stages.find((stage) => stage.name === "断钟中殿");
    if (!gate || !nave) {
      throw new Error("缺少测试数据");
    }
    expect(state.knownStages.map((record) => record.stageId)).toEqual([gate.id, nave.id]);
  });

  it("grants a known stage at runtime without advancing a turn", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场景知识授予测试局",
      world: { ...TEST_WORLD, contentVersion: "test-known-stages-grant.v1" },
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const before = await getGameState(handle.db, created.game.slug);
    const nave = before.world.stages.find((stage) => stage.name === "断钟中殿");
    const gate = before.world.stages.find((stage) => stage.name === "灰烬门廊");
    const keeper = gate?.actors.find((actor) => actor.name === "守烬人");
    if (!nave || !gate || !keeper) {
      throw new Error("缺少测试数据");
    }

    const learned = await learnStageName(handle.db, created.game.slug, "守烬人", "断钟中殿");
    expect(learned).toMatchObject({
      actorId: keeper.id,
      stageId: nave.id,
      created: true,
      version: before.game.version + 1,
    });

    const after = await getGameState(handle.db, created.game.slug);
    expect(after.game.version).toBe(before.game.version + 1);
    // 授予发生在门廊，所以「在哪儿听说的」记在这里；没有新增公共事件。
    expect(after.knownStages).toEqual([
      {
        actorId: keeper.id,
        stageId: nave.id,
        firstLearnedAt: expect.any(String),
        source: "runtime",
        learnedStageId: gate.id,
      },
    ]);
    expect(after.messages).toHaveLength(before.messages.length);
    expect(buildActorTurnInput(after, { actor: keeper, stage: gate })).toContain("@断钟中殿");

    // 重复授予幂等：不写库、不 bump 版本。
    const again = await learnStageName(handle.db, created.game.slug, "守烬人", nave.id);
    expect(again.created).toBe(false);
    expect(again.version).toBe(after.game.version);
    const state = await getGameState(handle.db, created.game.slug);
    expect(state.knownStages).toHaveLength(1);
    expect(state.game.version).toBe(after.game.version);
  });

  it("rejects granting the current stage or an unknown stage", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场景知识授予校验局",
      world: { ...TEST_WORLD, contentVersion: "test-known-stages-grant-invalid.v1" },
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    // 当前场景名始终可见，不需要记录。
    await expect(
      learnStageName(handle.db, created.game.slug, "守烬人", "灰烬门廊"),
    ).rejects.toThrow(/当前场景名始终可见/);
    await expect(
      learnStageName(handle.db, created.game.slug, "守烬人", "不存在的地方"),
    ).rejects.toThrow(/场景不存在/);
  });

  it("rejects content that references unknown actors or stages", async () => {
    await expect(
      createGame(handle.db, {
        username: DEMO_USER.username,
        name: "场景知识校验测试局",
        world: {
          ...TEST_WORLD,
          contentVersion: "test-known-stages-invalid.v1",
          knownStages: [{ actor: "ember-keeper", stage: "no-such-stage" }],
        },
      }),
    ).rejects.toThrow(/knownStages 引用了不存在的场景/);
  });
});
