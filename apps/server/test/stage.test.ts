import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";
import { DEMO_USER } from "../src/db/demo-fixture";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  applyStagePlan,
  createGame,
  getGameMemories,
  getGameState,
  playerMove,
  playerWhisper,
  releaseActorControl,
  runNpcTurn,
  runStageTurn,
  takeActorControl,
} from "../src/game";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";
import { allowAllDialogue } from "./test-dialogue-judge";
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

function submitAnchors(anchors: Array<{ label: string; description?: string }>): ToolCall {
  return {
    id: randomUUID(),
    type: "function",
    function: {
      name: "submit_environment",
      arguments: JSON.stringify({ anchors }),
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

class ScriptedAnchorService implements ChatCompletionService {
  constructor(private readonly anchors: Array<{ label: string; description?: string }>) {}

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    const toolCalls = [submitAnchors(this.anchors)];
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: "tool_calls",
      toolCalls,
    });
  }
}

class SubmitEnvironmentThenAnchorsService implements ChatCompletionService {
  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    const toolCalls = [
      submitEnvironment("风停了，灰烬沉在石阶缝里。"),
      submitAnchors([{ label: "锁舌", description: "门板内侧新露出的铜锁舌。" }]),
    ];
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
  useAnchorEnum: string[] | undefined;

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.inputMessage = request.inputMessage;
    const use = request.tools?.find((tool) => tool.function.name === "use");
    const properties = use?.function.parameters.properties as
      | Record<string, { enum?: string[] }>
      | undefined;
    this.useAnchorEnum = properties?.targetAnchor?.enum;
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
    await playerWhisper(
      handle.db,
      slug,
      "守烬人",
      {
        targetActorRef: "提灯修士",
        message: "别回头。",
      },
      { judge: allowAllDialogue },
    );
    await playerMove(handle.db, slug, "守烬人", { targetStageRef: "断钟中殿" });
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
    // 信息不对称：旧场景只知道“离开”，新场景只知道“进入”，路线只有移动者自己知道。
    const gateText = gate?.messages.map((message) => message.content).join("\n") ?? "";
    const naveText = nave?.messages.map((message) => message.content).join("\n") ?? "";
    expect(gateText).toContain("守烬人离开了灰烬门廊");
    expect(gateText).not.toContain("断钟中殿");
    expect(naveText).toContain("守烬人进入了断钟中殿");
    expect(naveText).not.toContain("灰烬门廊");
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
    expect(result.plan?.actions).toEqual([{ kind: "submit_environment", environment }]);
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
    // 过程轨迹不写进长期记忆：stage 记忆里只有 system、场景事件与仲裁结论，没有 loop 的 tool 轨迹。
    expect(gate?.messages.some((message) => message.type === "tool")).toBe(false);

    const capturing = new CapturingWaitService();
    await runNpcTurn(handle.db, slug, "提灯修士", { service: capturing });
    expect(capturing.inputMessage).toContain(environment);
  });

  it("updates anchors without environment and exposes them to the next actor turn", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场景锚点更新测试局",
      world: TEST_WORLD,
    });
    const anchors = [{ label: "锁舌", description: "门板内侧新露出的铜锁舌。" }];
    const result = await runStageTurn(handle.db, created.game.slug, "灰烬门廊", {
      service: new ScriptedAnchorService(anchors),
    });

    expect(result.ok).toBe(true);
    expect(result.plan?.actions).toEqual([{ kind: "submit_environment", anchors }]);
    expect(result.state.game.version).toBe(1);
    expect(result.state.world.stages.find((stage) => stage.name === "灰烬门廊")?.anchors).toEqual(
      anchors,
    );
    expect(result.state.messages.at(-1)).toMatchObject({
      kind: "anchor_change",
      stageId: result.state.world.stages.find((stage) => stage.name === "灰烬门廊")?.id,
    });

    const capturing = new CapturingWaitService();
    await runNpcTurn(handle.db, created.game.slug, "守烬人", { service: capturing });
    expect(capturing.inputMessage).toContain("## 可交互锚点");
    expect(capturing.inputMessage).toContain("锁舌：门板内侧新露出的铜锁舌。");
    expect(capturing.useAnchorEnum).toEqual(["锁舌"]);
  });

  it("merges environment and anchors submitted in the same turn", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场景快照合并测试局",
      world: TEST_WORLD,
    });
    const environment = "风停了，灰烬沉在石阶缝里。";
    const anchors = [{ label: "锁舌", description: "门板内侧新露出的铜锁舌。" }];
    const result = await runStageTurn(handle.db, created.game.slug, "灰烬门廊", {
      service: new SubmitEnvironmentThenAnchorsService(),
    });

    expect(result.ok).toBe(true);
    expect(result.plan?.actions).toEqual([{ kind: "submit_environment", environment, anchors }]);
    const stage = result.state.world.stages.find((candidate) => candidate.name === "灰烬门廊");
    expect(stage?.environment).toBe(environment);
    expect(stage?.anchors).toEqual(anchors);
  });

  it("rejects anchor labels that leak actor names or system references", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场景锚点守卫测试局",
      world: TEST_WORLD,
    });
    const state = await getGameState(handle.db, created.game.slug);
    const gate = state.world.stages.find((stage) => stage.name === "灰烬门廊");
    if (!gate) {
      throw new Error("缺少灰烬门廊");
    }

    for (const label of ["守烬人的门闩", "@门闩", "#12 门闩"]) {
      const ok = await applyStagePlan(
        handle.db,
        created.game.id,
        gate.id,
        { actions: [{ kind: "submit_environment", anchors: [{ label }] }] },
        true,
      );
      expect(ok).toBe(false);
    }

    const after = await getGameState(handle.db, created.game.slug);
    expect(after.game.version).toBe(0);
    expect(after.world.stages.find((stage) => stage.id === gate.id)?.anchors).toEqual(gate.anchors);
    const memories = await getGameMemories(handle.db, created.game.id);
    const gateMemory = memories.find((memory) => memory.name === "灰烬门廊");
    expect(
      gateMemory?.messages.filter((message) => message.content.includes("锚点更新被拒绝")).length,
    ).toBe(3);
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
    expect(result.plan?.actions).toEqual([
      { kind: "submit_environment", environment: "风停了，灰烬沉在石阶缝里。" },
      { kind: "notify_world", notification: "守烬人在门廊里找到了通往中殿的线索。" },
    ]);
    expect(result.state.game.version).toBe(1);
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

  it("rejects a bare actor name with production canonical names", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "生产名字环境测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const before = await getGameState(handle.db, created.game.slug);
    const graveyard = before.world.stages.find((stage) => stage.name === "墓园");
    if (!graveyard) {
      throw new Error("缺少墓园");
    }

    // 生产 seed 里 actor.name 是 `奥德里克`；旧守卫只查这个完整写法，
    // 裸本名正好从缝隙里漏过去。
    const ok = await applyStagePlan(
      handle.db,
      before.game.id,
      graveyard.id,
      {
        actions: [
          { kind: "submit_environment", environment: "奥德里克站在灰烬里，斗篷被风吹动。" },
        ],
      },
      true,
    );
    expect(ok).toBe(false);

    const after = await getGameState(handle.db, created.game.slug);
    expect(after.world.stages.find((stage) => stage.id === graveyard.id)?.environment).toBe(
      graveyard.environment,
    );
  });

  it("rejects system references but allows public item names in the environment", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "环境指代测试局",
      world: TEST_WORLD,
    });
    const before = await getGameState(handle.db, created.game.slug);
    const gate = before.world.stages.find((stage) => stage.name === "灰烬门廊");
    if (!gate) {
      throw new Error("缺少灰烬门廊");
    }

    expect(
      await applyStagePlan(
        handle.db,
        before.game.id,
        gate.id,
        { actions: [{ kind: "submit_environment", environment: " @12 站在门后。" }] },
        true,
      ),
    ).toBe(false);
    // 道具名是公共标签：environment 里自然叙述它是合法的。
    expect(
      await applyStagePlan(
        handle.db,
        before.game.id,
        gate.id,
        { actions: [{ kind: "submit_environment", environment: "门边靠着一把裂齿短刃。" }] },
        true,
      ),
    ).toBe(true);
  });

  it("rejects a plan that updates the environment twice", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "重复环境测试局",
      world: TEST_WORLD,
    });
    const stage = created.world.stages.find((item) => item.name === "灰烬门廊");

    const ok = await applyStagePlan(
      handle.db,
      created.game.id,
      stage?.id as string,
      {
        actions: [
          { kind: "submit_environment", environment: "风停了。" },
          { kind: "submit_environment", environment: "风又起了。" },
        ],
      },
      true,
    );
    expect(ok).toBe(false);
    expect(
      (await getGameState(handle.db, created.game.slug)).world.stages.find(
        (item) => item.id === stage?.id,
      )?.environment,
    ).toBe("风从破窗灌入，灰烬像雪一样落在石阶上。");
  });

  it("keeps the demo environment free of actor names", () => {
    for (const stage of BELL_MONASTERY_WORLD.stages) {
      const actorNames = BELL_MONASTERY_WORLD.actors
        .filter((actor) => actor.stageKey === stage.key)
        .map((actor) => actor.name);
      for (const actorName of actorNames) {
        expect(stage.environment).not.toContain(actorName);
      }
    }
  });
});
