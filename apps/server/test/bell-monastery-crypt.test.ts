import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";
import { DEMO_USER } from "../src/db/demo-fixture";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { actors } from "../src/db/schema";
import {
  createGame,
  getGameMemories,
  getGameState,
  playerFit,
  playerLoot,
  playerMove,
  playerSteal,
  runStageTurn,
  runWorldTurn,
  takeActorControl,
} from "../src/game";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

function call(name: string, args: Record<string, unknown> = {}): ToolCall {
  return {
    id: randomUUID(),
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

class ScriptedService implements ChatCompletionService {
  private pending: ToolCall[];

  constructor(toolCalls: ToolCall[]) {
    this.pending = [...toolCalls];
  }

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    const toolCalls = this.pending.splice(0, 1);
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      toolCalls,
    });
  }
}

describe.skipIf(!testDatabaseUrl)("bell monastery crypt ending", () => {
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

  it("puts the rat king's clapper back on the altar, opens the crypt, and lets the crypt end the game", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "钟窖收束测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const slug = created.game.slug;
    await takeActorControl(handle.db, slug, "无名者");
    await playerMove(handle.db, slug, "无名者", { targetStageRef: "墓园" });
    await playerMove(handle.db, slug, "无名者", { targetStageRef: "地窖" });

    // 鼠王比无名者敏捷：活着的钟舌偷不到，这条路线是打死它再搜尸体。
    await expect(
      playerSteal(handle.db, slug, "无名者", {
        targetActorRef: "鼠王",
        itemName: "旧钟的钟舌",
      }),
    ).rejects.toThrow("比你敏捷，你没能得手");

    // 钟舌是鼠王随身收着的 valuable，不是身体材料：打死它才会落到尸体背包里。
    // 鼠王打不动（block 100）：这里直接写库把 hp 归零跳过战斗，钟舌留在它的背包里。
    // 与 `actor-status.test.ts` 里造尸体的做法一致；存取边界只约束 src/game。
    const corpse = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "鼠王");
    if (!corpse) {
      throw new Error("缺少鼠王");
    }
    await handle.db.update(actors).set({ hp: 0 }).where(eq(actors.id, corpse.id));
    const looted = await playerLoot(handle.db, slug, "无名者", {
      targetActorRef: "鼠王",
      itemNames: ["旧钟的钟舌"],
    });
    expect(looted.ok).toBe(true);

    // 把钟舌对上祭坛：这一步只写舞台事件，开门的决定留给地窖的 stage 回合。
    const used = await playerFit(handle.db, slug, "无名者", {
      itemName: "旧钟的钟舌",
      targetAnchor: "祭坛",
    });
    expect(used.ok).toBe(true);
    const afterUse = await getGameState(handle.db, slug);
    expect(afterUse.messages.some((message) => message.content.includes("祭坛"))).toBe(true);
    const memoriesAfterUse = await getGameMemories(handle.db, created.game.id);
    const cellarMemory = memoriesAfterUse.find((memory) => memory.name === "地窖");
    expect(cellarMemory?.messages.some((message) => message.content.includes("祭坛"))).toBe(true);

    // 地窖这座舞台看到钟舌归位，才把后墙的通道打开。
    const opened = await runStageTurn(handle.db, slug, "地窖", {
      service: new ScriptedService([
        call("open_passage", { targetStageName: "钟窖" }),
        call("submit_stage_plan", {}),
      ]),
    });
    expect(opened.ok).toBe(true);
    expect(opened.plan?.actions).toEqual([{ kind: "open_passage", targetStageName: "钟窖" }]);

    const afterOpen = await getGameState(handle.db, slug);
    const cellar = afterOpen.world.stages.find((stage) => stage.name === "地窖");
    const crypt = afterOpen.world.stages.find((stage) => stage.name === "钟窖");
    expect(
      afterOpen.world.connections.find(
        (connection) => connection.fromStageId === cellar?.id && connection.toStageId === crypt?.id,
      )?.passage,
    ).toBe("open");

    const moved = await playerMove(handle.db, slug, "无名者", { targetStageRef: "钟窖" });
    expect(moved.ok).toBe(true);

    // 收束报告由钟窖自己发出：源头压在它这里，别处报不了。
    const notification =
      "钟舌归位后地窖后墙裂开，钟窖露了出来；钟腹底下压着最早病死的人，黑疖病的源头就在这里。";
    const reported = await runStageTurn(handle.db, slug, "钟窖", {
      service: new ScriptedService([
        call("notify_world", { content: notification }),
        call("submit_stage_plan", {}),
      ]),
    });
    expect(reported.ok).toBe(true);
    expect(reported.plan?.actions).toEqual([{ kind: "notify_world", notification }]);

    const memoriesAfterReport = await getGameMemories(handle.db, created.game.id);
    const worldMemory = memoriesAfterReport.find((memory) => memory.ownerType === "world");
    expect(worldMemory?.messages.some((message) => message.content.includes(notification))).toBe(
      true,
    );

    const ended = await runWorldTurn(handle.db, slug, {
      service: new ScriptedService([
        call("end_game", {
          outcome: "钟窖被打开",
          message: "铜钟被掀开，压在底下的人终于被人看见；黑疖病的源头跟着见了光。",
        }),
        call("submit_world_plan", {}),
      ]),
    });
    expect(ended.ok).toBe(true);
    expect(ended.state.game.status).toBe("completed");
    // 收尾只看钟窖：鼠王已经被打死，钟窖的结局照样成立。
    const king = ended.state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "鼠王");
    expect(king?.hp).toBe(0);
  });

  it("lets only a character with the craft work an anchor, and only with an item that fits", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "对上授权测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const slug = created.game.slug;

    // 奥德里克带着闸门钥匙，却没有这门手艺：钥匙在他手上只是一块铁。
    await takeActorControl(handle.db, slug, "奥德里克");
    await expect(
      playerFit(handle.db, slug, "奥德里克", { itemName: "闸门钥匙", targetAnchor: "锁孔" }),
    ).rejects.toThrow("不能使用动作: fit");

    // 锚点必须真的在本舞台：对上不接受凭空点一个地方。
    await takeActorControl(handle.db, slug, "无名者");
    await expect(
      playerFit(handle.db, slug, "无名者", { itemName: "撬弯的棺钉", targetAnchor: "锁孔" }),
    ).rejects.toThrow("当前舞台没有这个可交互锚点");
    // 会手艺的人拿错了东西也不行：撬弯的棺钉没有可以拿去对上的词缀。
    const moved = await playerMove(handle.db, slug, "无名者", { targetStageRef: "墓园" });
    expect(moved.ok).toBe(true);
    await expect(
      playerFit(handle.db, slug, "无名者", { itemName: "撬弯的棺钉", targetAnchor: "锁孔" }),
    ).rejects.toThrow("没有可以拿去对上的词缀");
  });
});
