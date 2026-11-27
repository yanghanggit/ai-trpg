import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { eq } from "drizzle-orm";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { actionOrderTurns } from "../src/db/schema";
import {
  createGame,
  getGameState,
  readActionOrderRound,
  recordStageTurn,
  recordTurnTaken,
  recordWorldTurn,
} from "../src/game";
import { createActionOrderOp, passTurn, readActionOrderOp } from "../src/game-ops";
import { DEMO_USER } from "../src/identity";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

/**
 * 回合账：顺位上每落账一个回合记一行，行动轮从账上读出来。
 *
 * 只测「记了没有、算得对不对」：写入点在回合落账处，这里直接调记录口，
 * 免得为了测一笔账去跑一次模型。
 */
describe.skipIf(!testDatabaseUrl)("action order turns", () => {
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

  async function freshOrder(name: string) {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name,
      world: TEST_WORLD,
    });
    const { order } = await createActionOrderOp(handle.db, created.game.slug);
    const state = await getGameState(handle.db, created.game.slug);
    const stage = state.world.stages[0];
    if (stage === undefined) {
      throw new Error("测试世界没有舞台");
    }
    return { slug: created.game.slug, gameId: created.game.id, order, stage, state };
  }

  it("没有顺位就没有账：读回来是 null", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "无顺位测试局",
      world: TEST_WORLD,
    });
    expect(await readActionOrderOp(handle.db, created.game.slug)).toEqual({
      order: null,
      round: null,
    });
  });

  it("一轮走完：演员、舞台、world 各就各位，world 归它收尾的那一轮", async () => {
    const { slug, order, stage, state } = await freshOrder("回合账测试局");
    const actorId = state.world.stages[0]?.actors[0]?.id;
    if (actorId === undefined) {
      throw new Error("测试世界没有角色");
    }

    expect(order).not.toBeNull();
    const orderId = order?.id ?? "";
    expect((await readActionOrderRound(handle.db, orderId)).index).toBe(1);

    await passTurn(handle.db, slug, { actors: [state.world.stages[0]?.actors[0]?.name ?? ""] });
    let round = await readActionOrderRound(handle.db, orderId);
    expect(round.index).toBe(1);
    expect(round.actors.map((actor) => [actor.name, actor.empty])).toHaveLength(1);
    expect(round.actors[0]?.empty).toBe(true);
    expect(round.stages).toEqual([]);
    expect(round.world).toBe(false);

    await recordStageTurn(handle.db, state.game.id, stage);
    await recordStageTurn(handle.db, state.game.id, stage);
    round = await readActionOrderRound(handle.db, orderId);
    expect(round.stages).toEqual([{ stageId: stage.id, name: stage.name, turns: 2 }]);
    expect(round.world).toBe(false);

    await recordWorldTurn(handle.db, state.game.id, state.world.name);
    round = await readActionOrderRound(handle.db, orderId);
    // world 属于它收尾的那一轮：推完之后读数仍报这一轮，直到下一笔角色回合开新轮。
    expect(round.world).toBe(true);
    expect(round.index).toBe(1);
    expect(round.actors).toHaveLength(1);

    await passTurn(handle.db, slug, { actors: [state.world.stages[0]?.actors[0]?.name ?? ""] });
    round = await readActionOrderRound(handle.db, orderId);
    expect(round.index).toBe(2);
    expect(round.world).toBe(false);
    expect(round.stages).toEqual([]);
    expect(round.actors).toHaveLength(1);
  });

  it("读顺位的投影把 round 与 order 并列给出", async () => {
    const { slug } = await freshOrder("并列投影测试局");
    const payload = await readActionOrderOp(handle.db, slug);
    expect(payload.order?.status).toBe("active");
    expect(payload.round).toEqual({
      index: 1,
      actors: [],
      stages: [],
      world: false,
    });
  });

  it("角色行带上当时的舞台与对账三元组", async () => {
    const { gameId, order, state } = await freshOrder("对账测试局");
    const actorId = state.world.stages[0]?.actors[0]?.id ?? "";
    await recordTurnTaken(handle.db, gameId, actorId, {
      facts: { expectedPosition: 1, actualPosition: 2, followed: false },
    });
    const [row] = await handle.db
      .select()
      .from(actionOrderTurns)
      .where(eq(actionOrderTurns.orderId, order?.id ?? ""));
    expect(row?.kind).toBe("actor");
    expect(row?.stageId).toBe(state.world.stages[0]?.id);
    expect([row?.expectedPosition, row?.actualPosition, row?.followed]).toEqual([1, 2, false]);
    expect(row?.round).toBe(1);
  });

  it("空回合记成 pass：同一行动轮里能看到它，但不是有动作的回合", async () => {
    const { order, state } = await freshOrder("空回合测试局");
    const name = state.world.stages[0]?.actors[0]?.name ?? "";
    await passTurn(handle.db, state.game.slug, { actors: [name] });
    const round = await readActionOrderRound(handle.db, order?.id ?? "");
    expect(round.actors).toEqual([{ actorId: expect.any(String), name, empty: true }]);
    // 空回合也带对账：顺位期望谁、实际推了谁。
    const [row] = await handle.db
      .select()
      .from(actionOrderTurns)
      .where(eq(actionOrderTurns.orderId, order?.id ?? ""));
    expect(row?.kind).toBe("pass");
    expect(row?.expectedPosition).toBe(1);
    expect(row?.actualPosition).toBe(1);
    expect(row?.followed).toBe(true);
  });
});
