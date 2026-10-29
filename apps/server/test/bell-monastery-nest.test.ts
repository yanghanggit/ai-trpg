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
  playerMove,
  playerSteal,
  playerUse,
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

describe.skipIf(!testDatabaseUrl)("bell monastery nest ending", () => {
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

  it("uses the rat king's flint on the nest, reports it, and lets the world end the game", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "鼠窝收束测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const slug = created.game.slug;
    await takeActorControl(handle.db, slug, "无名者");
    await playerMove(handle.db, slug, "无名者", { targetStageRef: "墓园" });
    await playerMove(handle.db, slug, "无名者", { targetStageRef: "地窖" });

    // 燧石是鼠王随身收着的 valuable，不是身体材料；活着也能偷。
    const stolen = await playerSteal(handle.db, slug, "无名者", {
      targetActorRef: "鼠王",
      itemName: "窝里的燧石",
    });
    expect(stolen.ok).toBe(true);

    const used = await playerUse(handle.db, slug, "无名者", {
      targetStageName: "地窖",
      itemName: "窝里的燧石",
      targetAnchor: "鼠窝",
    });
    expect(used.ok).toBe(true);

    const afterUse = await getGameState(handle.db, slug);
    expect(afterUse.messages.some((message) => message.content.includes("鼠窝"))).toBe(true);
    const memoriesAfterUse = await getGameMemories(handle.db, created.game.id);
    const cellarMemory = memoriesAfterUse.find((memory) => memory.name === "地窖");
    expect(cellarMemory?.messages.some((message) => message.content.includes("鼠窝"))).toBe(true);

    // 模拟鼠王已经倒下；真正收束仍由 world 回合裁决。
    const king = afterUse.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "鼠王");
    if (!king) {
      throw new Error("缺少鼠王");
    }
    await handle.db.update(actors).set({ hp: 0 }).where(eq(actors.id, king.id));

    const notification = "地窖的鼠窝被燧石点着，鼠王已经倒下，黑疖病的源头正在燃烧。";
    const reported = await runStageTurn(handle.db, slug, "地窖", {
      service: new ScriptedService([
        call("notify_world", { content: notification }),
        call("submit_environment", {}),
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
          outcome: "鼠窝焚毁",
          message: "地窖深处的火吞掉了旧巢，黑疖病的源头终于断了。",
        }),
        call("submit_world_plan", {}),
      ]),
    });
    expect(ended.ok).toBe(true);
    expect(ended.state.game.status).toBe("completed");
  });
});
