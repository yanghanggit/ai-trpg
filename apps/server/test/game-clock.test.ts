import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  actorTurnContext,
  applyStagePlan,
  applyWorldPlan,
  buildStageTurnInput,
  buildWorldTurnInput,
  createGame,
  findActorByName,
  getGameMemories,
  getGameState,
  openActionOrder,
  readActionOrder,
  recordPassTurn,
  renderActorTurnInput,
  settleActorPlan,
} from "../src/game";
import { MEMORY_KINDS } from "../src/game/memory/kinds";
import { appendStageMemory } from "../src/game/observations";
import { passTurn } from "../src/game-ops";
import { DEMO_USER } from "../src/identity";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

/**
 * 时刻是回合制游戏的时间：每落账一个回合 +1，任何一层都一样。
 *
 * 这里只钉住三件事——谁让它前进、它落在记忆的哪一行、提示词读到的「现在」是哪一刻。
 */
describe.skipIf(!testDatabaseUrl)("game clock", () => {
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

  async function freshGame(name: string) {
    return (
      await createGame(handle.db, {
        username: DEMO_USER.username,
        name,
        world: TEST_WORLD,
      })
    ).game.slug;
  }

  async function clockOf(game: string): Promise<number> {
    return (await getGameState(handle.db, game)).game.clock;
  }

  async function actorOf(game: string, name: string) {
    return findActorByName(await getGameState(handle.db, game), name).actor;
  }

  it("只有落账的回合推进时间；被拒的计划不推进", async () => {
    const game = await freshGame("时刻推进局");
    const state = await getGameState(handle.db, game);
    expect(state.game.clock).toBe(0);

    const order = await openActionOrder(handle.db, state);
    expect(order.clock).toBe(0);
    const keeper = await actorOf(game, "守烬人");

    // 一个动作落账：世界进入第 1 刻，这条行动事实也落在第 1 刻。
    const applied = await settleActorPlan(
      handle.db,
      state.game.id,
      keeper.id,
      { actions: [{ kind: "wait" }] },
      true,
    );
    expect(applied.ok).toBe(true);
    expect(await clockOf(game)).toBe(1);
    const keeperMemory = (await getGameMemories(handle.db, state.game.id)).find(
      (memory) => memory.name === "守烬人",
    );
    const last = keeperMemory?.messages.at(-1);
    expect(last?.metadata).toMatchObject({ at: 1, kind: MEMORY_KINDS.actionFeedback });
    expect(last?.content.startsWith("第 1 刻\n\n# 行动结果")).toBe(true);

    // 计划被拒：没有落账，时间停在第 1 刻；那条拒绝记忆也写在第 1 刻。
    const rejected = await settleActorPlan(handle.db, state.game.id, keeper.id, null, true);
    expect(rejected.ok).toBe(false);
    expect(await clockOf(game)).toBe(1);
    const afterRejected = (await getGameMemories(handle.db, state.game.id)).find(
      (memory) => memory.name === "守烬人",
    );
    expect(afterRejected?.messages.at(-1)?.metadata).toMatchObject({
      at: 1,
      kind: MEMORY_KINDS.planFailed,
    });

    // 顺位计数发生在回合入口上，不在结算函数里：这里只钉住时间与记忆的口径。
    const orderAfter = await readActionOrder(handle.db, state.game.id);
    expect(orderAfter?.entries[0]?.turnsTaken).toBe(0);
    expect(orderAfter?.clock).toBe(1);
  });

  it("舞台与世界的回合同样占一刻；空计划也是走过一刻", async () => {
    const game = await freshGame("时刻分层局");
    const state = await getGameState(handle.db, game);
    const stage = state.world.stages[0] as (typeof state.world.stages)[number];

    await applyStagePlan(handle.db, state.game.id, stage.id, { actions: [] }, true);
    expect(await clockOf(game)).toBe(1);

    await applyWorldPlan(handle.db, state.game.id, { actions: [] }, true);
    expect(await clockOf(game)).toBe(2);

    // 被拒的舞台计划不占时间：没有提交计划就是这一回合没走完。
    await applyStagePlan(handle.db, state.game.id, stage.id, null, true);
    expect(await clockOf(game)).toBe(2);
  });

  it("空回合没有顺位也推进时间；顺位只回答计数", async () => {
    const game = await freshGame("时刻空回合局");
    const state = await getGameState(handle.db, game);
    const keeper = await actorOf(game, "守烬人");

    expect(await recordPassTurn(handle.db, state.game.id, keeper.id)).toBe(false);
    expect(await clockOf(game)).toBe(1);

    const counted = await passTurn(handle.db, game, { actors: [keeper.name] });
    expect(counted).toEqual({ results: [{ actorName: keeper.name, counted: false }] });
    expect(await clockOf(game)).toBe(2);
  });

  it("提示词读到的「现在」是当前时刻，落账后进入下一刻", async () => {
    const game = await freshGame("时刻提示词局");
    const state = await getGameState(handle.db, game);
    const { actor, stage } = findActorByName(state, "守烬人");

    const actorInput = renderActorTurnInput(actorTurnContext(state, { actor, stage }));
    expect(actorInput).toContain("现在：第 0 刻");
    expect(actorInput).toContain("本回合落账后：第 1 刻");
    expect(buildStageTurnInput(state, stage)).toContain("现在：第 0 刻");
    expect(buildWorldTurnInput(state)).toContain("现在：第 0 刻");
  });

  it("开局基线固定写第 0 刻，不跟着补写那一刻漂", async () => {
    const game = await freshGame("时刻开局局");
    const state = await getGameState(handle.db, game);
    const stage = state.world.stages[0] as (typeof state.world.stages)[number];

    // 先让时间走一格，再第一次写这个舞台的记忆：开局基线仍属于第 0 刻。
    await applyWorldPlan(handle.db, state.game.id, { actions: [] }, true);
    await appendStageMemory(handle.db, state.game.id, stage.id, "# 舞台事件\n门被推开了。", {
      eventKind: "wait",
    });

    const memory = (await getGameMemories(handle.db, state.game.id)).find(
      (entry) => entry.ownerType === "stage" && entry.ownerId === stage.id,
    );
    const messages = memory?.messages ?? [];
    const kindOf = (message: { metadata?: unknown }) =>
      (message.metadata as Record<string, unknown> | undefined)?.kind;
    const opening = messages.find(
      (message) => kindOf(message) === MEMORY_KINDS.stageOpeningSnapshot,
    );
    const event = messages.at(-1);
    expect(opening?.metadata).toMatchObject({ at: 0 });
    expect(opening?.content.startsWith("第 0 刻")).toBe(true);
    expect(event?.metadata).toMatchObject({ at: 1 });
    expect(event?.content.startsWith("第 1 刻")).toBe(true);
  });
});
