import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_USER } from "../src/db/demo-fixture";
import { TEST_WORLD } from "./test-world";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { actors } from "../src/db/schema";
import {
  createGame,
  getGameState,
  playerAttack,
  playerSteal,
  runNpcTurn,
  takeActorControl,
} from "../src/game";
import { describeStats } from "../src/game/plan";
import { ChatCompletionResult, type ChatCompletionService } from "../src/llm";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

/** 提交一个 wait 的 NPC 服务；用于确认死亡 actor 根本进不了 loop。 */
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

/** 内容里直接声明为尸体，并且故意不写 hp。 */
const DEAD_CONTENT_WORLD = {
  ...TEST_WORLD,
  actors: TEST_WORLD.actors.map((actor) =>
    actor.name === "提灯修士"
      ? { ...actor, status: "dead" as const, equipment: { armor: "铅封提灯" } }
      : actor,
  ),
};

describe.skipIf(!testDatabaseUrl)("actor status", () => {
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

  it("内容声明 status=dead 时把 hp 归一成 0，不会出现满血尸体", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "内容尸体测试局",
      world: DEAD_CONTENT_WORLD,
    });

    const monk = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk?.status).toBe("dead");
    expect(monk?.hp).toBe(0);

    if (!monk) {
      throw new Error("缺少提灯修士");
    }
    expect(describeStats(monk)).toContain("HP：0/10");
    expect(describeStats(monk)).toContain("状态：已死亡");
  });

  it("尸体仍然可以被搜刮，但不会进入 NPC loop", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "尸体搜刮测试局",
      world: DEAD_CONTENT_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const stolen = await playerSteal(handle.db, created.game.slug, "守烬人", {
      targetActorName: "提灯修士",
      itemName: "铅封提灯",
    });
    expect(stolen.ok).toBe(true);

    await expect(
      runNpcTurn(handle.db, created.game.slug, "提灯修士", { service: new WaitService() }),
    ).rejects.toThrow("已死亡");
  });

  it("hp 归零后即使 status 还写着 alive 也被当成死亡", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "hp 唯一真相测试局",
      world: TEST_WORLD,
    });
    const monk = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    if (!monk) {
      throw new Error("缺少提灯修士");
    }
    // 只改 hp，不动 status，模拟外部写入或未来 heal 逻辑遗漏。
    await handle.db.update(actors).set({ hp: 0 }).where(eq(actors.id, monk.id));

    await expect(
      runNpcTurn(handle.db, created.game.slug, "提灯修士", { service: new WaitService() }),
    ).rejects.toThrow("已死亡");

    await takeActorControl(handle.db, created.game.slug, "守烬人");
    await expect(
      playerAttack(handle.db, created.game.slug, "守烬人", { targetActorName: "提灯修士" }),
    ).rejects.toThrow("目标已经死亡");

    const state = await getGameState(handle.db, created.game.slug);
    const updated = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    if (!updated) {
      throw new Error("缺少提灯修士");
    }
    expect(describeStats(updated)).toContain("状态：已死亡");
  });
});
