import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { actionOrderEntries } from "../src/db/schema";
import { createGame, getGameState, recordActionTaken } from "../src/game";
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

/** 顺位为空只可能是建单失败；用例里当成断言失败处理，顺带让类型收窄。 */
function firstEntry(order: ActionOrderState) {
  const entry = order.entries[0];
  if (!entry) {
    throw new Error("顺位没有条目");
  }
  return entry;
}

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

  it("开一张：活人按敏捷排成连续顺位，计数从 0 起", async () => {
    const game = await freshGame("行动顺位用例局");

    const { order } = await createActionOrderOp(handle.db, game);
    expect(order.status).toBe("active");
    expect(order.completedAt).toBeNull();
    expect(order.entries).toHaveLength(3);
    expect(order.entries.map((entry) => entry.position)).toEqual([1, 2, 3]);
    expect(order.entries.every((entry) => entry.actionsTaken === 0)).toBe(true);

    // 敏捷降序：只断言单调性，具体数值归 TEST_WORLD 内容。
    const agilities = order.entries.map((entry) => entry.agility);
    expect(agilities).toEqual([...agilities].sort((left, right) => right - left));

    // 进行中的那张就是 current；按 id 读回同一张。
    expect((await readActionOrderOp(handle.db, game)).order?.id).toBe(order.id);
    expect((await readActionOrderOp(handle.db, game, order.id)).order).toEqual(order);
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
    expect(after?.entries.map((entry) => [entry.actorName, entry.actionsTaken])).toEqual(
      order.entries.map((entry) => [entry.actorName, entry.actorId === target.actorId ? 1 : 0]),
    );
  });

  it("一局只能有一张进行中的顺位；完成后才能再开", async () => {
    const game = await freshGame("行动顺位单张局");
    const { order } = await createActionOrderOp(handle.db, game);
    await expect(createActionOrderOp(handle.db, game)).rejects.toThrow("已有进行中的行动顺位");

    const completed = await completeActionOrderOp(handle.db, game, order.id);
    expect(completed.order.status).toBe("completed");
    expect(completed.order.completedAt).not.toBeNull();
    // 完成再完成是错误，不是幂等成功。
    await expect(completeActionOrderOp(handle.db, game, order.id)).rejects.toThrow("已完成");

    // 完成后 current 是空的，计数也不再记。
    expect((await readActionOrderOp(handle.db, game)).order).toBeNull();
    const gameId = (await getGameState(handle.db, game)).game.id;
    expect(await recordActionTaken(handle.db, gameId, firstEntry(order).actorId)).toBe(false);

    // 上一张已完成，可以开下一张。
    const next = await createActionOrderOp(handle.db, game);
    expect(next.order.id).not.toBe(order.id);
    expect(next.order.status).toBe("active");
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
