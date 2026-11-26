import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  actionOrderEntries,
  actionOrders,
  actorControls,
  actors,
  agentMemories,
  dialogueBlocks,
  gameMessages,
  gamePlayers,
  games,
  worlds,
} from "../src/db/schema";
import { allActors, createGame, endGame, getGameStateSlice, listGameMessages } from "../src/game";
import { createActionOrderOp, deleteGameOp, endGameOp } from "../src/game-ops";
import { DEMO_USER } from "../src/identity";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/** 一局的直接子表：删局之后这些都该没有行，靠外键级联而不是业务代码。 */
const GAME_SCOPED = [
  { table: worlds, column: worlds.gameId },
  { table: gamePlayers, column: gamePlayers.gameId },
  { table: gameMessages, column: gameMessages.gameId },
  { table: actionOrders, column: actionOrders.gameId },
  { table: actorControls, column: actorControls.gameId },
  { table: agentMemories, column: agentMemories.gameId },
  { table: dialogueBlocks, column: dialogueBlocks.gameId },
];

describe.skipIf(!testDatabaseUrl)("game lifecycle", () => {
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
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name,
      world: TEST_WORLD,
    });
    return created.game;
  }

  it("客户端叫停：翻状态、写结束事件，版本跟着走", async () => {
    const game = await freshGame("结束一局用例局");

    const ended = await endGameOp(handle.db, game.slug, {
      outcome: "钟声停了",
      message: "钟声停在中殿，故事到此为止。",
    });
    expect(ended).toEqual({ ended: true });

    const row = async () => (await handle.db.select().from(games).where(eq(games.id, game.id)))[0];
    expect(await row()).toMatchObject({ status: "completed", outcome: "钟声停了" });

    const messages = await listGameMessages(handle.db, game.id);
    expect(messages.filter((message) => message.kind === "game_completed")).toHaveLength(1);

    // 结束是一次写入：客户端据此重读，不能停在旧版本上。
    expect((await row())?.version).toBeGreaterThan(game.version);

    // 结束再结束是收敛：不报错、不写第二条事件、不改结局。
    expect(await endGameOp(handle.db, game.slug, { outcome: "另一个结局" })).toEqual({
      ended: false,
    });
    expect(await row()).toMatchObject({ status: "completed", outcome: "钟声停了" });
    const after = await listGameMessages(handle.db, game.id);
    expect(after.filter((message) => message.kind === "game_completed")).toHaveLength(1);
  });

  it("不给正文就只翻状态，不编句子", async () => {
    const game = await freshGame("结束无正文用例局");

    expect(await endGame(handle.db, game.id, { outcome: "无人知晓" })).toEqual({ ended: true });
    const messages = await listGameMessages(handle.db, game.id);
    expect(messages.filter((message) => message.kind === "game_completed")).toHaveLength(0);
  });

  it("结局标签不能为空", async () => {
    const game = await freshGame("结束空标签用例局");
    await expect(endGame(handle.db, game.id, { outcome: "  " })).rejects.toThrow(
      "结局标签不能为空",
    );
    await expect(
      endGame(handle.db, "00000000-0000-4000-8000-0000000000ff", {
        outcome: "不存在",
      }),
    ).rejects.toThrow("游戏不存在");
  });

  it("删局：一条级联清干净，读回就是不存在", async () => {
    const game = await freshGame("删除一局用例局");
    // 先记下这一局的 actor：它们挂在舞台、舞台挂在 world 上，两跳都该跟着没。
    const actorIds = allActors(await getGameStateSlice(handle.db, game.slug)).map(
      ({ actor }) => actor.id,
    );
    expect(actorIds.length).toBeGreaterThan(0);
    const { order } = await createActionOrderOp(handle.db, game.slug);
    expect(order.entries.length).toBeGreaterThan(0);
    await endGameOp(handle.db, game.slug, { outcome: "删掉了" });

    await expect(deleteGameOp(handle.db, game.slug)).resolves.toEqual({
      deleted: game.id,
      slug: game.slug,
    });

    for (const { table, column } of GAME_SCOPED) {
      expect(await handle.db.select().from(table).where(eq(column, game.id))).toEqual([]);
    }
    // actor 挂在舞台、舞台挂在 world 上：两级都断了，它们也就没有落脚处。
    for (const actorId of actorIds) {
      expect(await handle.db.select().from(actors).where(eq(actors.id, actorId))).toEqual([]);
    }
    // 顺位条目随顺位一起没，不需要单独删。
    expect(
      await handle.db
        .select()
        .from(actionOrderEntries)
        .where(eq(actionOrderEntries.orderId, order.id)),
    ).toEqual([]);

    await expect(deleteGameOp(handle.db, game.slug)).rejects.toThrow("游戏不存在");
  });
});
