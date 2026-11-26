import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { actionOrderEntries, actors } from "../src/db/schema";
import {
  createGame,
  getGameMeta,
  getGameState,
  listGameMessages,
  nextEntry,
  recordTurnTaken,
} from "../src/game";
import type { ActionOrderState } from "../src/game/kernel/types";
import {
  advanceNpc,
  completeActionOrderOp,
  createActionOrderOp,
  passTurn,
  readActionOrderOp,
  removeActionOrderOp,
  submitPlayerAction,
  takeControlOp,
} from "../src/game-ops";
import { DEMO_USER } from "../src/identity";
import { ChatCompletionResult, type ChatCompletionService } from "../src/llm";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/** 只提交一次 wait：回合能落账，但什么都不改，方便只看计数。 */
class WaitService implements ChatCompletionService {
  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
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

/** 卡在服务里的一个回合：让第一发推进占着位置，直到测试放行。 */
class BlockingService implements ChatCompletionService {
  private readonly started = deferred();
  private readonly gate = deferred();

  /** 第一发已经进入模型调用，也就是已经占住那个位置。 */
  readonly entered = this.started.promise;

  release(): void {
    this.gate.resolve();
  }

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.started.resolve();
    await this.gate.promise;
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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
    control: "agent" as const,
    alive: true,
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
      control: "agent",
    });
    // 名次是快照，生死与执行方是读出时的当下事实：刚开的顺位人人活着、都归 agent。
    expect(order.entries.every((entry) => entry.alive && entry.control === "agent")).toBe(true);

    // 进行中的那条就是 current；按 id 读回同一条。
    expect((await readActionOrderOp(handle.db, game)).order?.id).toBe(order.id);
    expect((await readActionOrderOp(handle.db, game, order.id)).order).toEqual(order);
  });

  it("“谁快轮到”跟着计数走，死者留在名次上但不再被选中", async () => {
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
    const shrunk = (await readActionOrderOp(handle.db, game)).order;
    expect(shrunk?.nextActor?.position).toBe(3);
    // 人留在名次上、计数留着，只是不再被选中——死者不是「删掉」，是「轮不到」。
    expect(entryAt(shrunk as ActionOrderState, 2).alive).toBe(false);
  });

  it("玩家接管不改变名次，只改变谁执行；玩家提交的动作也是标准回合", async () => {
    const game = await freshGame("行动顺位玩家局");
    const { order } = await createActionOrderOp(handle.db, game);
    const lead = firstEntry(order);

    // 接管之前：这个人排在名次 1，由 agent 跑循环。
    expect(lead.control).toBe("agent");

    await takeControlOp(handle.db, game, lead.actorName);
    const taken = (await readActionOrderOp(handle.db, game)).order;
    // 接管不把人从序列里摘出去——只是这一回合改由客户端直接提交动作。
    expect(entryAt(taken as ActionOrderState, 1).control).toBe("player");
    expect(taken?.nextActor).toEqual({
      position: 1,
      actorId: lead.actorId,
      actorName: lead.actorName,
      control: "player",
    });

    // 玩家直接提交一个动作：同一条落账路径，同一个回合计数。
    await submitPlayerAction(
      handle.db,
      game,
      lead.actorName,
      { kind: "wait" },
      {
        service: new WaitService(),
        inferenceService: new WaitService(),
      },
    );

    const after = (await readActionOrderOp(handle.db, game)).order;
    expect(entryAt(after as ActionOrderState, 1).turnsTaken).toBe(1);
    // 计数走完，轮到下一个；玩家不会因为「不是 agent」而被跳过。
    expect(after?.nextActor?.position).toBe(2);
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

  it("空回合也计数：跳过的一轮不会让下一个人堵住", async () => {
    const game = await freshGame("行动顺位空回合局");
    const { order } = await createActionOrderOp(handle.db, game);
    const lead = firstEntry(order);

    expect(await passTurn(handle.db, game, { actors: [lead.actorName] })).toEqual({
      results: [{ actorName: lead.actorName, counted: true }],
    });

    const after = (await readActionOrderOp(handle.db, game)).order;
    expect(entryAt(after as ActionOrderState, 1).turnsTaken).toBe(1);
    // 空回合不写动作、也不写事件：它只记「轮到过他」。
    expect(after?.nextActor?.position).toBe(2);
    const gameId = (await getGameMeta(handle.db, game)).id;
    expect(await listGameMessages(handle.db, gameId)).toEqual([]);

    // 顺位不在进行中时照旧只是「没记上」。
    await completeActionOrderOp(handle.db, game, order.id);
    expect(await passTurn(handle.db, game, { actors: [lead.actorName] })).toEqual({
      results: [{ actorName: lead.actorName, counted: false }],
    });
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
    expect(await recordTurnTaken(handle.db, gameId, firstEntry(order).actorId)).toBe(false);

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
    // 卡在服务里：第一发一直占着这个 actor，不用拿睡眠去赌时序。
    const slow = new BlockingService();
    const services = { service: slow, inferenceService: slow };

    const first = advanceNpc(handle.db, game, { actors: [target] }, services);
    await slow.entered;
    await expect(advanceNpc(handle.db, game, { actors: [target] }, services)).rejects.toThrow(
      "正在推进中",
    );

    slow.release();
    await expect(first).resolves.toMatchObject({ results: [{ ok: true }] });
    expect((await readActionOrderOp(handle.db, game)).order?.entries[0]?.turnsTaken).toBe(1);
  });

  it("同一 actor 并发推进：玩家动作与点名推进共用一个位置", async () => {
    const game = await freshGame("行动顺位玩家并发局");
    const { order } = await createActionOrderOp(handle.db, game);
    const lead = firstEntry(order);
    await takeControlOp(handle.db, game, lead.actorName);

    // 换装会补一次外观推理：把它卡在服务里，第一发就一直占着这个 actor。
    const slow = new BlockingService();
    const services = { service: slow, inferenceService: slow };
    const first = submitPlayerAction(
      handle.db,
      game,
      lead.actorName,
      { kind: "unequip", slot: "armor" },
      services,
    );
    await slow.entered;

    await expect(
      submitPlayerAction(handle.db, game, lead.actorName, { kind: "wait" }, services),
    ).rejects.toThrow("正在推进中");

    slow.release();
    // 一个动作一个回合：换装落了账，外观推理失败不影响这回合成功。
    await expect(first).resolves.toMatchObject({
      plan: { actions: [{ kind: "unequip", slot: "armor" }] },
    });
    // 被拒的那一发没落账：一个动作一个回合，计数只加一。
    const after = (await readActionOrderOp(handle.db, game)).order as ActionOrderState;
    expect(entryAt(after, 1).turnsTaken).toBe(1);

    // 位置放开了，下一发照常。
    await expect(
      submitPlayerAction(handle.db, game, lead.actorName, { kind: "wait" }, services),
    ).resolves.toBeDefined();
    const later = (await readActionOrderOp(handle.db, game)).order as ActionOrderState;
    expect(entryAt(later, 1).turnsTaken).toBe(2);
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

  it("玩家动作也在过程轨迹里留推进对账，与回合同一条", async () => {
    const game = await freshGame("行动顺位对账局");
    const { order } = await createActionOrderOp(handle.db, game);
    const lead = firstEntry(order);
    await takeControlOp(handle.db, game, lead.actorName);

    // 测试环境默认不落盘：这一段显式打开，并换成临时目录。
    const dir = await mkdtemp(join(tmpdir(), "ai-trpg-dispatch-"));
    const previous = { dir: process.env.TRACE_DIR, enabled: process.env.TRACE_ENABLED };
    process.env.TRACE_DIR = dir;
    process.env.TRACE_ENABLED = "1";
    try {
      await submitPlayerAction(
        handle.db,
        game,
        lead.actorName,
        { kind: "wait" },
        { service: new WaitService(), inferenceService: new WaitService() },
      );

      const files = (await readdir(join(dir, game))).filter((file) => file.endsWith(".jsonl"));
      const events = (
        await Promise.all(
          files.map(async (file) =>
            (
              await readFile(join(dir, game, file), "utf8")
            )
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line)),
          ),
        )
      ).flat();

      const started = events.find((event) => event.event === "turn_start");
      const dispatch = events.find((event) => event.event === "dispatch");
      // 对账挂在同一个回合上：同一个 turnId，不是一条孤立记录。
      expect(dispatch).toMatchObject({
        turnId: started?.turnId,
        turnKind: "player",
        actorId: lead.actorId,
        orderId: order.id,
        expectedPosition: 1,
        actualPosition: 1,
        followed: true,
      });
    } finally {
      process.env.TRACE_DIR = previous.dir;
      process.env.TRACE_ENABLED = previous.enabled;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
