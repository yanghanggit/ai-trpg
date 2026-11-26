import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getGameMemories,
  getGameState,
  loadAgentMemory,
  playerMove,
  playerRecallRoute,
  playerRecognizeIdentity,
  playerWait,
  runActorTurn,
  takeActorControl,
} from "../src/game";
import type { World } from "../src/game/world-definition";
import { DEMO_USER } from "../src/identity";
import { ChatCompletionResult, type ChatCompletionService } from "../src/llm";
import { memoryBody } from "./memory-content";
import { TEST_WORLD } from "./test-world";

const ITEM_WORLD: World = {
  ...TEST_WORLD,
  stages: TEST_WORLD.stages.map((stage) =>
    stage.key === "gate"
      ? {
          ...stage,
          anchors: (stage.anchors ?? []).map((anchor) => ({
            ...anchor,
            items: [
              {
                key: "test-lantern",
                name: "测试提灯",
                description: "测试用的舞台道具。",
                kind: "equipment",
              },
            ],
          })),
        }
      : stage,
  ),
};

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

/** 提交 wait 的 NPC 服务：用来确认自主 NPC 也拿到同一份状态锚点。 */
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

/** 按顺序发给定工具调用的 NPC 服务：用来构造一份既有动作又有认知的计划。 */
class ScriptedTools implements ChatCompletionService {
  constructor(private readonly calls: readonly { name: string; args: object }[]) {}

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    const toolCalls = [
      ...this.calls.map((call, index) => ({
        id: `call-${index}`,
        type: "function" as const,
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      })),
      {
        id: "submit",
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

describe.skipIf(!testDatabaseUrl)("memory state snapshot", () => {
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

  const actorByName = async (slug: string, name: string) => {
    const state = await getGameState(handle.db, slug);
    const actor = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((item) => item.name === name);
    if (!actor) {
      throw new Error(`缺少 actor: ${name}`);
    }
    return { state, actor };
  };

  const lastMemory = async (gameId: string, actorId: string) => {
    const memory = await loadAgentMemory(handle.db, gameId, "actor", actorId);
    return memory?.messages.at(-1)?.content ?? "";
  };

  it("records the final stage, visible addresses and stage items after an action", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "记忆状态快照测试局",
      world: TEST_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    await playerMove(handle.db, created.game.slug, "守烬人", {
      targetStageRef: "断钟中殿",
    });

    const { actor } = await actorByName(created.game.slug, "守烬人");
    const content = await lastMemory(created.game.id, actor.id);
    expect(content).toContain("# 当时");
    expect(content).toContain("舞台：断钟中殿");
    expect(content).toContain("在场：你、缄默抄经人");
    expect(content).toContain("可交互：无");
    expect(content).not.toContain("舞台：灰烬门廊\n");
  });

  it("lists stage items by public name in the snapshot", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "记忆状态快照道具局",
      world: ITEM_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    await playerWait(handle.db, created.game.slug, "守烬人");

    const { actor } = await actorByName(created.game.slug, "守烬人");
    const content = await lastMemory(created.game.id, actor.id);
    expect(content).toContain("# 当时");
    expect(content).toContain("可交互：门闩（测试提灯）");
  });

  it("attaches the same state snapshot to a rejected plan", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "记忆状态快照拒绝局",
      world: TEST_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    await expect(
      playerMove(handle.db, created.game.slug, "守烬人", { targetStageRef: "不存在的地方" }),
    ).rejects.toThrow();

    const { actor } = await actorByName(created.game.slug, "守烬人");
    const content = await lastMemory(created.game.id, actor.id);
    expect(content).toContain("# 行动结果\n行动被拒绝");
    expect(content).toContain("# 当时");
    expect(content).toContain("舞台：灰烬门廊");
    expect(content).toContain("在场：你、提灯修士");
  });

  it("keeps the stage snapshot out of cognition memories", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "认知不带现场局",
      world: TEST_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    await playerRecallRoute(handle.db, created.game.slug, "守烬人", { toStageRef: "断钟中殿" });

    const { actor } = await actorByName(created.game.slug, "守烬人");
    const routeMemory = await lastMemory(created.game.id, actor.id);
    expect(routeMemory).toContain("# 认知");
    expect(routeMemory).not.toContain("# 当时");

    await playerRecognizeIdentity(handle.db, created.game.slug, "守烬人", {
      targetActorRef: "缄默抄经人",
      name: "提灯修士",
    });
    const identityMemory = await lastMemory(created.game.id, actor.id);
    expect(identityMemory).toContain("# 认知");
    expect(identityMemory).not.toContain("# 当时");
  });

  it("keeps the action result snapshot while cognition turns stay clean", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "认知与动作两回合局",
      world: TEST_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    // 一个回合一个动作：动作用一个回合，认知用另一个回合；状态块只挂在动作结果上。
    await playerWait(handle.db, created.game.slug, "守烬人");
    await playerRecallRoute(handle.db, created.game.slug, "守烬人", {
      fromStageRef: "灰烬门廊",
      toStageRef: "断钟中殿",
    });

    const memories = await getGameMemories(handle.db, created.game.id);
    const contents = (memories.find((memory) => memory.name === "守烬人")?.messages ?? []).map(
      (message) => message.content,
    );
    const actionResult = contents
      .map(memoryBody)
      .find((content) => content.startsWith("# 行动结果"));
    const cognition = contents.map(memoryBody).filter((content) => content.startsWith("# 认知"));

    expect(actionResult).toContain("# 当时");
    expect(cognition.length).toBeGreaterThan(0);
    expect(cognition.every((content) => !content.includes("# 当时"))).toBe(true);
  });

  it("keeps cognition out of the state snapshot inside one plan", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "同计划混合局",
      world: TEST_WORLD,
    });
    const { state } = await actorByName(created.game.slug, "守烬人");
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    if (!monk) {
      throw new Error("缺少 actor: 提灯修士");
    }

    // 一份计划里既有动作又有认知：状态块挂在行动结果上，认知各自干净。
    const result = await runActorTurn(handle.db, created.game.slug, "守烬人", {
      service: new ScriptedTools([
        {
          name: "recognize_identity",
          args: { handle: `#${monk.signature.seq}`, name: "提灯修士" },
        },
        { name: "wait", args: {} },
        { name: "recall_route", args: { to: "断钟中殿" } },
      ]),
    });
    expect(result.ok).toBe(true);

    const memories = await getGameMemories(handle.db, created.game.id);
    const contents = (memories.find((memory) => memory.name === "守烬人")?.messages ?? []).map(
      (message) => message.content,
    );
    const actionResult = contents
      .map(memoryBody)
      .find((content) => content.startsWith("# 行动结果"));
    const cognition = contents.map(memoryBody).filter((content) => content.startsWith("# 认知"));

    expect(actionResult).toContain("# 当时");
    expect(cognition.length).toBeGreaterThan(0);
    expect(cognition.every((content) => !content.includes("# 当时"))).toBe(true);
  });

  it("gives an autonomous NPC the same state snapshot", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "自主 NPC 记忆状态快照局",
      world: TEST_WORLD,
    });
    const result = await runActorTurn(handle.db, created.game.slug, "守烬人", {
      service: new WaitService(),
    });
    expect(result.ok).toBe(true);

    const { actor } = await actorByName(created.game.slug, "守烬人");
    const content = await lastMemory(created.game.id, actor.id);
    expect(content).toContain("# 行动结果");
    expect(content).toContain("# 当时");
    expect(content).toContain("舞台：灰烬门廊");
    expect(content).toContain("在场：你、提灯修士");
  });
});
