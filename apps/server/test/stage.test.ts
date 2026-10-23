import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DARK_FANTASY_WORLD } from "../seeds/dark-fantasy";
import { DEMO_USER } from "../src/db/demo-fixture";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  applyStagePlan,
  createGame,
  getGameMemories,
  playerMove,
  playerWhisper,
  releaseActorControl,
  runNpcTurn,
  runStageTurn,
  takeActorControl,
} from "../src/game";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

function notifyWorld(content: string): ToolCall {
  return {
    id: randomUUID(),
    type: "function",
    function: {
      name: "notify_world",
      arguments: JSON.stringify({ content }),
    },
  };
}

function submitEnvironment(environment: string): ToolCall {
  return {
    id: randomUUID(),
    type: "function",
    function: {
      name: "submit_environment",
      arguments: JSON.stringify({ environment }),
    },
  };
}

class ScriptedStageService implements ChatCompletionService {
  private readonly environments: string[];

  constructor(environments: string[]) {
    this.environments = [...environments];
  }

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    const environment = this.environments.shift();
    if (environment === undefined) {
      throw new Error("脚本化 stage 环境已耗尽");
    }
    const toolCalls = [submitEnvironment(environment)];
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: "tool_calls",
      toolCalls,
    });
  }
}

class SubmitThenNotifyService implements ChatCompletionService {
  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    const toolCalls = [
      submitEnvironment("风停了，灰烬沉在石阶缝里。"),
      notifyWorld("守烬人在门廊里找到了通往中殿的线索。"),
    ];
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: "tool_calls",
      toolCalls,
    });
  }
}

class CapturingWaitService implements ChatCompletionService {
  inputMessage = "";

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.inputMessage = request.inputMessage;
    const toolCalls: ToolCall[] = [
      {
        id: randomUUID(),
        type: "function",
        function: { name: "wait", arguments: "{}" },
      },
      {
        id: randomUUID(),
        type: "function",
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

describe.skipIf(!testDatabaseUrl)("stage mini-GM", () => {
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

  it("records private whisper and movement at both scene memories", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场景记忆测试局",
      world: TEST_WORLD,
    });
    const slug = created.game.slug;
    await takeActorControl(handle.db, slug, "守烬人");
    await playerWhisper(handle.db, slug, "守烬人", {
      targetActorName: "提灯修士",
      message: "别回头。",
    });
    await playerMove(handle.db, slug, "守烬人", { targetStageName: "断钟中殿" });
    await releaseActorControl(handle.db, slug, "守烬人");

    const memories = await getGameMemories(handle.db, created.game.id);
    const gate = memories.find((memory) => memory.name === "灰烬门廊");
    const nave = memories.find((memory) => memory.name === "断钟中殿");
    const monk = memories.find((memory) => memory.name === "提灯修士");
    const scribe = memories.find((memory) => memory.name === "缄默抄经人");

    expect(gate?.ownerType).toBe("stage");
    // 耳语内容只进发起者与目标的 memory，场景 memory 只记录“发生过一次耳语”。
    expect(
      gate?.messages.some((message) => message.content.includes("守烬人对提灯修士耳语。")),
    ).toBe(true);
    expect(gate?.messages.some((message) => message.content.includes("别回头"))).toBe(false);
    expect(gate?.messages.some((message) => message.content.includes("守烬人离开灰烬门廊"))).toBe(
      true,
    );
    expect(
      nave?.messages.some((message) => message.content.includes("守烬人从灰烬门廊进入断钟中殿")),
    ).toBe(true);
    expect(monk?.messages.some((message) => message.content.includes("别回头"))).toBe(true);
    expect(scribe?.messages.some((message) => message.content.includes("别回头"))).toBe(false);
  });

  it("applies environment updates, observes them, and feeds them to the next actor turn", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场景环境测试局",
      world: TEST_WORLD,
    });
    const slug = created.game.slug;
    const environment = "风停了，灰烬沉在石阶缝里，破窗外的天色比刚才更暗。";
    const result = await runStageTurn(handle.db, slug, "灰烬门廊", {
      service: new ScriptedStageService([environment]),
    });

    expect(result.ok).toBe(true);
    expect(result.plan?.environment).toBe(environment);
    expect(result.state.game.version).toBe(1);
    expect(result.state.world.stages.find((stage) => stage.name === "灰烬门廊")?.environment).toBe(
      environment,
    );
    expect(result.state.messages.at(-1)).toMatchObject({
      kind: "environment_change",
      stageId: result.state.world.stages.find((stage) => stage.name === "灰烬门廊")?.id,
    });

    const memories = await getGameMemories(handle.db, created.game.id);
    const gate = memories.find((memory) => memory.name === "灰烬门廊");
    const keeper = memories.find((memory) => memory.name === "守烬人");
    expect(gate?.messages.some((message) => message.content.includes(environment))).toBe(true);
    expect(keeper?.messages.some((message) => message.content.includes(environment))).toBe(false);

    const capturing = new CapturingWaitService();
    await runNpcTurn(handle.db, slug, "提灯修士", { service: capturing });
    expect(capturing.inputMessage).toContain(environment);
  });

  it("keeps notify_world calls that arrive after submit_environment", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "提交顺序测试局",
      world: TEST_WORLD,
    });
    const result = await runStageTurn(handle.db, created.game.slug, "灰烬门廊", {
      service: new SubmitThenNotifyService(),
    });

    expect(result.ok).toBe(true);
    expect(result.plan?.environment).toContain("风停了");
    expect(result.plan?.notifications).toEqual(["守烬人在门廊里找到了通往中殿的线索。"]);
    expect(result.state.game.version).toBe(1);
  });

  it("rejects an environment update when the stage lacks the capability", async () => {
    const world = {
      ...TEST_WORLD,
      stages: TEST_WORLD.stages.map((stage) =>
        stage.key === "gate" ? { ...stage, actions: [] as const } : stage,
      ),
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场景能力缺失测试局",
      world,
    });
    const stage = created.world.stages.find((item) => item.name === "灰烬门廊");
    expect(stage).toBeDefined();

    const ok = await applyStagePlan(
      handle.db,
      created.game.id,
      stage?.id as string,
      { environment: "无人的门廊，风停在石阶上。", notifications: [] },
      [],
      true,
    );
    expect(ok).toBe(false);

    const memories = await getGameMemories(handle.db, created.game.id);
    const gate = memories.find((memory) => memory.name === "灰烬门廊");
    expect(
      gate?.messages.some((message) => message.content.includes("没有 submit_environment 能力")),
    ).toBe(true);
  });

  it("rejects an environment that names an actor in the scene", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场景角色名测试局",
      world: TEST_WORLD,
    });
    const result = await runStageTurn(handle.db, created.game.slug, "灰烬门廊", {
      service: new ScriptedStageService(["守烬人站在灰烬里，斗篷被风吹动。"]),
    });

    expect(result.ok).toBe(false);
    expect(result.state.game.version).toBe(0);
    const gate = result.state.world.stages.find((stage) => stage.name === "灰烬门廊");
    expect(gate?.environment).toBe("风从破窗灌入，灰烬像雪一样落在石阶上。");

    const memories = await getGameMemories(handle.db, created.game.id);
    const stageMemory = memories.find((memory) => memory.name === "灰烬门廊");
    expect(
      stageMemory?.messages.some((message) =>
        message.content.includes("environment 不能包含角色名"),
      ),
    ).toBe(true);
  });

  it("keeps the demo environment free of actor names", () => {
    for (const stage of DARK_FANTASY_WORLD.stages) {
      const actorNames = DARK_FANTASY_WORLD.actors
        .filter((actor) => actor.stageKey === stage.key)
        .map((actor) => actor.name);
      for (const actorName of actorNames) {
        expect(stage.environment).not.toContain(actorName);
      }
    }
  });
});
