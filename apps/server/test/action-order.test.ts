import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { actionOrderEntries, actors } from "../src/db/schema";
import { createGame, getGameMeta, getGameState, nextEntry, recordActionTaken } from "../src/game";
import type { ActionOrderState } from "../src/game/kernel/types";
import {
  advanceNpc,
  completeActionOrderOp,
  createActionOrderOp,
  readActionOrderOp,
  removeActionOrderOp,
} from "../src/game-ops";
import { ChatCompletionResult, type ChatCompletionService } from "../src/llm";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/** 只提交一次 wait：回合能落账，但什么都不改，方便只看计数。 */
class WaitService implements ChatCompletionService {
  constructor(private readonly delayMs = 0) {}

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    if (this.delayMs > 0) {
      await new Promise((done) => setTimeout(done, this.delayMs));
    }
    const toolCalls = [
      { id: "call-1", type: "function" as const, function: { name: "wait", arguments: "{}" } },
      {
        id: "call-2",
        type: "function" as const,
        function: { name: "submit_plan", arguments: "{}" },
      },
    ];
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: "tool_calls",
      toolCalls,
    });
  }
}

/** 顺位为空只可能是建单失败；用例里当成断言失败处理，顺带让类型收窄。 */
function firstEntry(order: ActionOrderState) {
  const entry = order.entries[0];
  if (!entry) {
    throw new Error("顺位没有条目");
  }
  return entry;
}

/** 按名次取条目：比数组下标清楚，也不依赖「下标恰好等于名次」。 */
function entryAt(order: ActionOrderState, position: number) {
  const entry = order.entries.find((item) => item.position === position);
  if (!entry) {
    throw new Error(`顺位没有名次 ${position}`);
  }
  return entry;
}

describe("nextEntry", () => {
  const entry = (position: number, turnsTaken: number) => ({
    actorId: `actor-${position}`,
    actorName: `甲${position}`,
    position,
    agility: 1,
    turnsTaken,
  });

  it("取回合计数最少的；同值取名次靠前", () => {
    const entries = [entry(1, 2), entry(2, 1), entry(3, 3)];
    const all = new Set(entries.map((item) => item.actorId));
    expect(nextEntry(entries, all)?.actorId).toBe("actor-2");
    // 2 与 3 的次数相同，名次靠前的赢。
    expect(nextEntry([entry(1, 1), entry(2, 2), entry(3, 2)], all)?.position).toBe(1);
  });

  it("只从候选里挑；候选为空就是没有下一个", () => {
    const entries = [entry(1, 0), entry(2, 0)];
    expect(nextEntry(entries, new Set(["actor-2"]))?.position).toBe(2);
    expect(nextEntry(entries, new Set())).toBeNull();
    expect(nextEntry([], new Set(["actor-1"]))).toBeNull();
  });
});

describe.skipIf(!testDatabaseUrl)("action order", () => {
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
    return created.game.slug;
  }

  it("开一条：活人按敏捷排成连续顺位，计数从 0 起", async () => {
    const game = await freshGame("行动顺位用例局");

    const { order } = await createActionOrderOp(handle.db, game);
    expect(order.status).toBe("active");
    expect(order.completedAt).toBeNull();
    expect(order.entries).toHaveLength(3);
    expect(order.entries.map((entry) => entry.position)).toEqual([1, 2, 3]);
    expect(order.entries.every((entry) => entry.turnsTaken === 0)).toBe(true);

    // 敏捷降序：只断言单调性，具体数值归 TEST_WORLD 内容。
    const agilities = order.entries.map((entry) => entry.agility);
    expect(agilities).toEqual([...agilities].sort((left, right) => right - left));

    // 全员 0 次时，该轮到名次 1；世界版本一并给出，客户端拿它去比对。
    expect(order.gameVersion).toBe((await getGameMeta(handle.db, game)).version);
    expect(order.nextActor).toEqual({
      position: 1,
      actorId: firstEntry(order).actorId,
      actorName: firstEntry(order).actorName,
    });

    // 进行中的那条就是 current；按 id 读回同一条。
    expect((await readActionOrderOp(handle.db, game)).order?.id).toBe(order.id);
    expect((await readActionOrderOp(handle.db, game, order.id)).order).toEqual(order);
  });

  it("“谁快轮到”跟着计数走，死者从候选里退出来", async () => {
    const game = await freshGame("行动顺位候选局");
    const { order } = await createActionOrderOp(handle.db, game);
    const lead = firstEntry(order);

    await advanceNpc(
      handle.db,
      game,
      { actors: [lead.actorName] },
      { service: new WaitService(), inferenceService: new WaitService() },
    );
    // 名次 1 推过了，轮到名次 2。
    expect((await readActionOrderOp(handle.db, game)).order?.nextActor?.position).toBe(2);

    // 名次 2 的人死掉后不再算候选，他的席位也就没人接班。
    await handle.db
      .update(actors)
      .set({ hp: 0 })
      .where(eq(actors.id, entryAt(order, 2).actorId));
    expect((await readActionOrderOp(handle.db, game)).order?.nextActor?.position).toBe(3);
  });

  it("推进一个 NPC 只给他在顺位上 +1", async () => {
    const game = await freshGame("行动顺位计数局");
    const { order } = await createActionOrderOp(handle.db, game);
    const target = firstEntry(order);

    await advanceNpc(
      handle.db,
      game,
      { actors: [target.actorName] },
      {
        service: new WaitService(),
        inferenceService: new WaitService(),
      },
    );

    const after = (await readActionOrderOp(handle.db, game)).order;
    expect(after?.entries.map((entry) => [entry.actorName, entry.turnsTaken])).toEqual(
      order.entries.map((entry) => [entry.actorName, entry.actorId === target.actorId ? 1 : 0]),
    );
  });

  it("一局只能有一条进行中的顺位；完成后才能再开", async () => {
    const game = await freshGame("行动顺位单张局");
    const { order } = await createActionOrderOp(handle.db, game);
    await expect(createActionOrderOp(handle.db, game)).rejects.toThrow("已有进行中的行动顺位");

    const completed = await completeActionOrderOp(handle.db, game, order.id);
    expect(completed.order.status).toBe("completed");
    expect(completed.order.completedAt).not.toBeNull();
    // 完成是收敛：重复完成回同一行，且不重写完成时间。
    const again = await completeActionOrderOp(handle.db, game, order.id);
    expect(again.order.status).toBe("completed");
    expect(again.order.completedAt).toBe(completed.order.completedAt);

    // 完成后 current 是空的，计数也不再记。
    expect((await readActionOrderOp(handle.db, game)).order).toBeNull();
    const gameId = (await getGameState(handle.db, game)).game.id;
    expect(await recordActionTaken(handle.db, gameId, firstEntry(order).actorId)).toBe(false);

    // 上一条已完成，可以开下一条。
    const next = await createActionOrderOp(handle.db, game);
    expect(next.order.id).not.toBe(order.id);
    expect(next.order.status).toBe("active");
  });

  it("视图过期直接拒：客户端必须重读后再推", async () => {
    const game = await freshGame("行动顺位视图局");
    const { order } = await createActionOrderOp(handle.db, game);
    const meta = await getGameMeta(handle.db, game);

    await expect(
      advanceNpc(
        handle.db,
        game,
        { actors: [firstEntry(order).actorName], expectedVersion: meta.version + 1 },
        { service: new WaitService(), inferenceService: new WaitService() },
      ),
    ).rejects.toThrow("视图已过期");

    // 对得上就照常推进，计数也照常记。
    await advanceNpc(
      handle.db,
      game,
      { actors: [firstEntry(order).actorName], expectedVersion: meta.version },
      { service: new WaitService(), inferenceService: new WaitService() },
    );
    expect((await readActionOrderOp(handle.db, game)).order?.entries[0]?.turnsTaken).toBe(1);
  });

  it("同一 actor 并发推进：后来的那个被拒，前面的照常落账", async () => {
    const game = await freshGame("行动顺位并发局");
    const { order } = await createActionOrderOp(handle.db, game);
    const target = firstEntry(order).actorName;
    // 慢一点，才能在第一个推进还没跑完时发第二个。
    const slow = new WaitService(300);
    const services = { service: slow, inferenceService: slow };

    const first = advanceNpc(handle.db, game, { actors: [target] }, services);
    // 等第一个请求占住名单（它要先读一次 game 行）。
    await new Promise((done) => setTimeout(done, 100));
    await expect(advanceNpc(handle.db, game, { actors: [target] }, services)).rejects.toThrow(
      "正在推进中",
    );

    await expect(first).resolves.toMatchObject({ results: [{ ok: true }] });
    expect((await readActionOrderOp(handle.db, game)).order?.entries[0]?.turnsTaken).toBe(1);
  });

  it("移除删行：条目级联，按 id 也读不回来", async () => {
    const game = await freshGame("行动顺位移除局");
    const { order } = await createActionOrderOp(handle.db, game);

    await expect(removeActionOrderOp(handle.db, game, order.id)).resolves.toEqual({
      removed: order.id,
    });
    expect((await readActionOrderOp(handle.db, game, order.id)).order).toBeNull();
    expect(
      await handle.db
        .select()
        .from(actionOrderEntries)
        .where(eq(actionOrderEntries.orderId, order.id)),
    ).toEqual([]);
    await expect(completeActionOrderOp(handle.db, game, order.id)).rejects.toThrow("不存在");
  });

  it("没有进行中的顺位时推进照旧，不报错也不记数", async () => {
    const game = await freshGame("行动顺位空台账局");
    const result = await advanceNpc(
      handle.db,
      game,
      { actors: ["守烬人"] },
      {
        service: new WaitService(),
        inferenceService: new WaitService(),
      },
    );
    expect(result.results).toHaveLength(1);
    expect((await readActionOrderOp(handle.db, game)).order).toBeNull();
  });
});
