import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";
import { DEMO_USER } from "../src/db/demo-fixture";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getGameMemories,
  getGameState,
  parseAppearance,
  setEquipmentSlot,
} from "../src/game";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

describe("appearance input", () => {
  it("rejects system references and known actor names", () => {
    expect(() => parseAppearance({ appearance: "裹尸布上沾着石灰。" })).not.toThrow();
    expect(() => parseAppearance({ appearance: "@煤渣站在门口。" })).toThrow("系统引用");
    expect(() => parseAppearance({ appearance: "#12 站在门口。" })).toThrow("系统引用");
    // 场景与道具的名字是公共标签，写进外观的描述本身不算泄漏。
    expect(() => parseAppearance({ appearance: "煤渣倒在门口。" })).not.toThrow();
    expect(() => parseAppearance({ appearance: "煤渣倒在门口。" }, ["煤渣"])).toThrow(
      "不能包含角色名",
    );
  });
});

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
      world: BELL_MONASTERY_WORLD,
    });
    const keeper = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "奥德里克");
    expect(keeper?.appearance).toContain("斗篷");

    const service = new AppearanceService("只穿旧衬衣，手背沾着新土。");
    await expect(
      setEquipmentSlot(handle.db, created.game.slug, "奥德里克", "weapon", "补丁斗篷", {
        service,
      }),
    ).rejects.toThrow("不能放进武器槽");
    const result = await setEquipmentSlot(handle.db, created.game.slug, "奥德里克", "armor", null, {
      service,
    });

    expect(result.ok).toBe(true);
    expect(result.slot).toBe("armor");
    expect(result.itemName).toBeNull();
    expect(result.appearance).toBe("只穿旧衬衣，手背沾着新土。");
    expect(service.calls).toBe(1);
    expect(service.observation).toContain("[人类]");
    expect(service.observation).not.toContain("补丁斗篷");

    const state = await getGameState(handle.db, created.game.slug);
    const updated = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "奥德里克");
    expect(updated?.appearance).toBe("只穿旧衬衣，手背沾着新土。");
    expect(updated?.equipment.armor).toBeUndefined();

    const memories = await getGameMemories(handle.db, created.game.id);
    const keeperMemory = memories.find((memory) => memory.name === "奥德里克");
    const systemPrompt = keeperMemory?.messages.find((message) => message.type === "system");
    expect(systemPrompt?.content).toContain("[人类]");
    expect(systemPrompt?.content).not.toContain("只穿旧衬衣");
  });

  it("keeps one armor slot and one accessory slot", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "槽位收敛测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const service = new AppearanceService("裹着发黄的布，颈上的断链垂在锁骨前。");
    const wear = (slot: "armor" | "accessory", itemName: string) =>
      setEquipmentSlot(handle.db, created.game.slug, "无名者", slot, itemName, { service });

    // 护甲槽只接受 equipment 大类。
    await expect(wear("armor", "颈上的断链")).rejects.toThrow("不能放进护甲槽");

    expect((await wear("accessory", "颈上的断链")).ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const actor = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "无名者");
    expect(actor?.equipment).toEqual({
      armor: "发黄的裹尸布",
      accessory: "颈上的断链",
    });
  });
});
