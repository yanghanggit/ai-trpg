import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_USER } from "../src/db/demo-fixture";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { createGame, getGameMemories, getGameState, runStory } from "../src/game";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

function call(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: randomUUID(),
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

class StoryService implements ChatCompletionService {
  private readonly script: ToolCall[][];
  calls = 0;
  tools: string[] = [];
  inputs: string[] = [];

  constructor(script: ToolCall[][]) {
    this.script = [...script];
  }

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.calls += 1;
    this.tools = request.tools?.map((tool) => tool.function.name) ?? [];
    this.inputs.push(request.inputMessage);
    const toolCalls = this.script.shift();
    if (!toolCalls) {
      throw new Error("story 脚本已耗尽");
    }
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: "tool_calls",
      toolCalls,
    });
  }
}

function storyScript(): ToolCall[][] {
  return [
    [call("list_memories", {})],
    [call("read_memory", { ownerType: "world", name: "世界.灰烬测试局" })],
    [call("read_memory", { ownerType: "stage", name: "灰烬门廊" })],
    [call("read_memory", { ownerType: "stage", name: "断钟中殿" })],
    [call("read_memory", { ownerType: "actor", name: "守烬人" })],
    [call("read_memory", { ownerType: "actor", name: "提灯修士" })],
    [call("read_memory", { ownerType: "actor", name: "缄默抄经人" })],
    [call("read_events", {})],
    [call("submit_story", { story: "灰烬门廊的故事进行到这里。" })],
  ];
}

describe.skipIf(!testDatabaseUrl)("game story", () => {
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

  it("reads every memory and event, then returns a read-only story", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "story 测试局",
      world: TEST_WORLD,
    });

    const before = await getGameState(handle.db, created.game.slug);
    const beforeMemories = await getGameMemories(handle.db, created.game.id);
    expect(before.game.status).toBe("active");

    const service = new StoryService(storyScript());
    const result = await runStory(handle.db, created.game.slug, { service });
    expect(result.gameStatus).toBe("active");
    expect(result.story).toContain("灰烬门廊");
    expect(result.memoriesRead).toHaveLength(6);
    expect(result.eventsRead).toBe(true);
    expect(result.rounds).toBe(9);
    expect(service.tools).toEqual(
      expect.arrayContaining(["list_memories", "read_memory", "read_events", "submit_story"]),
    );

    const after = await getGameState(handle.db, created.game.slug);
    const afterMemories = await getGameMemories(handle.db, created.game.id);
    expect(after.game.version).toBe(before.game.version);
    expect(after.messages).toEqual(before.messages);
    expect(afterMemories).toEqual(beforeMemories);
  });
});
