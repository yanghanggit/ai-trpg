import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_USER } from "../src/db/demo-fixture";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getGameMemories,
  getGameState,
  playerPickup,
  runProbe,
  takeActorControl,
} from "../src/game";
import { ChatCompletionResult, type ChatCompletionService } from "../src/llm";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

class CapturingProbeService implements ChatCompletionService {
  request: Parameters<ChatCompletionService["complete"]>[0] | undefined;

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.request = request;
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "探针回答" },
      finishReason: "stop",
    });
  }
}

const worldWithPickup = {
  ...TEST_WORLD,
  stages: TEST_WORLD.stages.map((stage) =>
    stage.key === "gate"
      ? {
          ...stage,
          items: [
            {
              key: "probe-lantern",
              name: "测试提灯",
              description: "一盏用于探针测试的提灯。",
              kind: "valuable" as const,
              count: 1,
            },
          ],
        }
      : stage,
  ),
  actors: TEST_WORLD.actors,
};

describe.skipIf(!testDatabaseUrl)("agent probe", () => {
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

  it("answers from actor memory only, without injecting current observation", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "actor 探针测试局",
      world: worldWithPickup,
    });
    const slug = created.game.slug;
    await takeActorControl(handle.db, slug, "守烬人");
    await playerPickup(handle.db, slug, "守烬人", {
      itemName: "测试提灯",
    });

    const beforeState = await getGameState(handle.db, slug);
    const beforeMemories = await getGameMemories(handle.db, created.game.id);
    const service = new CapturingProbeService();

    const result = await runProbe(handle.db, slug, {
      service,
      target: { type: "actor", actorRef: "守烬人" },
      message: "你现在记得自己刚刚做了什么吗？",
    });

    expect(result.answer).toBe("探针回答");
    expect(result.targetName).toBe("守烬人");
    expect(service.request?.inputMessage).toContain("你现在记得自己刚刚做了什么吗？");
    expect(service.request?.inputMessage).not.toContain("## 场景物品");
    expect(
      service.request?.messages.some((message) => message.content.includes("你拾取了测试提灯。")),
    ).toBe(true);

    const afterState = await getGameState(handle.db, slug);
    const afterMemories = await getGameMemories(handle.db, created.game.id);
    expect(afterState.game.version).toBe(beforeState.game.version);
    expect(afterState.messages).toHaveLength(beforeState.messages.length);
    expect(afterMemories.map((memory) => [memory.name, memory.messages.length])).toEqual(
      beforeMemories.map((memory) => [memory.name, memory.messages.length]),
    );
  });

  it("answers from stage memory only, including the pickup event", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "stage 探针测试局",
      world: worldWithPickup,
    });
    const slug = created.game.slug;
    await takeActorControl(handle.db, slug, "守烬人");
    await playerPickup(handle.db, slug, "守烬人", {
      itemName: "测试提灯",
    });

    const beforeState = await getGameState(handle.db, slug);
    const beforeMemories = await getGameMemories(handle.db, created.game.id);
    const service = new CapturingProbeService();

    const result = await runProbe(handle.db, slug, {
      service,
      target: { type: "stage", stageRef: "灰烬门廊" },
      message: "你记得这个场景刚刚发生了什么吗？",
    });

    expect(result.targetName).toBe("灰烬门廊");
    expect(service.request?.inputMessage).toContain("你记得这个场景刚刚发生了什么吗？");
    expect(service.request?.inputMessage).not.toContain("## 场景物品");
    expect(
      service.request?.messages.some((message) =>
        message.content.includes("守烬人拾取了测试提灯。"),
      ),
    ).toBe(true);

    const afterState = await getGameState(handle.db, slug);
    const afterMemories = await getGameMemories(handle.db, created.game.id);
    expect(afterState.game.version).toBe(beforeState.game.version);
    expect(afterState.messages).toHaveLength(beforeState.messages.length);
    expect(afterMemories.map((memory) => [memory.name, memory.messages.length])).toEqual(
      beforeMemories.map((memory) => [memory.name, memory.messages.length]),
    );
  });
});
