import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DARK_FANTASY_WORLD, DEMO_USER } from "../seeds/dark-fantasy";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { createGame, getGameMemories, getGameState, setEquipmentSlot } from "../src/game";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

/** 只提交一个外观，并记录本次看到的外观观察。 */
class AppearanceService implements ChatCompletionService {
  observation = "";
  calls = 0;

  constructor(private readonly appearance: string) {}

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.calls += 1;
    this.observation = request.inputMessage;
    const toolCalls: ToolCall[] = [
      {
        id: randomUUID(),
        type: "function",
        function: {
          name: "submit_appearance",
          arguments: JSON.stringify({ appearance: this.appearance }),
        },
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

describe.skipIf(!testDatabaseUrl)("appearance fusion", () => {
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

  it("recomputes appearance from base body, worn equipment and memory after changing equipment", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "外观融合测试局",
      world: DARK_FANTASY_WORLD,
    });
    const keeper = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "角色.奥德里克");
    expect(keeper?.appearance).toContain("斗篷");

    const service = new AppearanceService("奥德里克只穿旧衬衣，手背沾着新土。");
    await expect(
      setEquipmentSlot(handle.db, created.game.slug, "角色.奥德里克", "weapon", "装备.补丁斗篷", {
        service,
      }),
    ).rejects.toThrow("不能放进武器槽");
    const result = await setEquipmentSlot(
      handle.db,
      created.game.slug,
      "角色.奥德里克",
      "body",
      null,
      { service },
    );

    expect(result.ok).toBe(true);
    expect(result.slot).toBe("body");
    expect(result.itemName).toBeNull();
    expect(result.appearance).toBe("奥德里克只穿旧衬衣，手背沾着新土。");
    expect(service.calls).toBe(1);
    expect(service.observation).toContain("[人类]");
    expect(service.observation).not.toContain("装备.补丁斗篷");

    const state = await getGameState(handle.db, created.game.slug);
    const updated = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "角色.奥德里克");
    expect(updated?.appearance).toBe("奥德里克只穿旧衬衣，手背沾着新土。");
    expect(updated?.equipment.body).toBeUndefined();

    const memories = await getGameMemories(handle.db, created.game.id);
    const keeperMemory = memories.find((memory) => memory.name === "角色.奥德里克");
    const systemPrompt = keeperMemory?.messages.find((message) => message.type === "system");
    expect(systemPrompt?.content).toContain("[人类]");
    expect(systemPrompt?.content).not.toContain("奥德里克只穿旧衬衣");
  });
});
