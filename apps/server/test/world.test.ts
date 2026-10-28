import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_USER } from "../src/db/demo-fixture";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  DEFAULT_STAGE_MAX_ROUNDS,
  DEFAULT_WORLD_MAX_ROUNDS,
  getGameMemories,
  getGameState,
  MAX_STAGE_NOTIFICATIONS_PER_TURN,
  MAX_WORLD_ACTIONS_PER_TURN,
  runStageTurn,
  runWorldTurn,
  settleDeaths,
} from "../src/game";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

function call(name: string, args: Record<string, unknown> = {}): ToolCall {
  return {
    id: randomUUID(),
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

class ScriptedService implements ChatCompletionService {
  private readonly toolCalls: ToolCall[];

  constructor(toolCalls: ToolCall[]) {
    this.toolCalls = toolCalls;
  }

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls: this.toolCalls },
      finishReason: "tool_calls",
      toolCalls: this.toolCalls,
    });
  }
}

/** 按轮次返回不同工具调用；空数组表示这一轮直接 stop。 */
class ScriptedRoundsService implements ChatCompletionService {
  private round = 0;

  constructor(private readonly rounds: ToolCall[][]) {}

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    const toolCalls = this.rounds[this.round] ?? [];
    this.round += 1;
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      toolCalls,
    });
  }
}

describe("turn round budgets", () => {
  it("按任务提示正常规划时，探查、全部写动作与提交能装进一轮", () => {
    // world：look_stage + 全部写动作 + submit_world_plan
    expect(DEFAULT_WORLD_MAX_ROUNDS).toBeGreaterThanOrEqual(MAX_WORLD_ACTIONS_PER_TURN + 2);
    // stage：look_stage + submit_environment + open_passage + 两条通知
    expect(DEFAULT_STAGE_MAX_ROUNDS).toBeGreaterThanOrEqual(MAX_STAGE_NOTIFICATIONS_PER_TURN + 3);
  });
});

describe.skipIf(!testDatabaseUrl)("world agent", () => {
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

  it("lets a stage notify the world without changing environment", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "世界通知测试局",
      world: TEST_WORLD,
    });
    const notification = "守烬人把钥匙插进了灰烬门廊的锁孔，锁芯有转动声。";
    const result = await runStageTurn(handle.db, created.game.slug, "灰烬门廊", {
      service: new ScriptedService([
        call("notify_world", { content: notification }),
        call("submit_environment", {}),
      ]),
    });

    expect(result.ok).toBe(true);
    expect(result.plan).toEqual({ actions: [{ kind: "notify_world", notification }] });
    expect(result.state.world.stages.find((stage) => stage.name === "灰烬门廊")?.environment).toBe(
      "风从破窗灌入，灰烬像雪一样落在石阶上。",
    );

    const memories = await getGameMemories(handle.db, created.game.id);
    const world = memories.find((memory) => memory.ownerType === "world");
    expect(world?.messages.some((message) => message.content.includes(notification))).toBe(true);
  });

  it("lets the world notify a stage and end the game as the last action", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "世界裁决测试局",
      world: TEST_WORLD,
    });
    const notification = "守烬人把钥匙插进了灰烬门廊的锁孔，锁芯有转动声。";
    await runStageTurn(handle.db, created.game.slug, "灰烬门廊", {
      service: new ScriptedService([
        call("notify_world", { content: notification }),
        call("submit_environment", {}),
      ]),
    });

    const directive = "灰烬门廊的门已经打开，外面的风进入了门厅。";
    const ending = "门后的路出现了，故事在此收束。";
    const result = await runWorldTurn(handle.db, created.game.slug, {
      service: new ScriptedService([
        call("notify_stage", { stageName: "灰烬门廊", content: directive }),
        call("end_game", { outcome: "escaped", message: ending }),
        call("submit_world_plan", {}),
      ]),
    });

    expect(result.ok).toBe(true);
    expect(result.state.game.status).toBe("completed");
    expect(result.state.game.outcome).toBe("escaped");
    expect(result.state.messages.some((message) => message.kind === "game_completed")).toBe(true);

    const memories = await getGameMemories(handle.db, created.game.id);
    const gate = memories.find((memory) => memory.name === "灰烬门廊");
    expect(gate?.messages.some((message) => message.content.includes(directive))).toBe(true);
  });

  it("rejects a world directive that names an actor", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "世界下推名字测试局",
      world: TEST_WORLD,
    });

    const result = await runWorldTurn(handle.db, created.game.slug, {
      service: new ScriptedService([
        call("notify_stage", { stageName: "灰烬门廊", content: "守烬人把门打开了。" }),
        call("submit_world_plan", {}),
      ]),
    });
    expect(result.ok).toBe(false);

    const memories = await getGameMemories(handle.db, created.game.id);
    const worldMemory = memories.find((memory) => memory.ownerType === "world");
    expect(
      worldMemory?.messages.some((message) => message.content.includes("不能包含角色名")),
    ).toBe(true);
    const gate = memories.find((memory) => memory.name === "灰烬门廊");
    expect(gate?.messages.some((message) => message.content.includes("守烬人把门"))).toBe(false);
  });

  it("rejects an ending that names an actor", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "结局名字测试局",
      world: TEST_WORLD,
    });

    const result = await runWorldTurn(handle.db, created.game.slug, {
      service: new ScriptedService([
        call("end_game", { outcome: "escaped", message: "守烬人走出了门廊。" }),
        call("submit_world_plan", {}),
      ]),
    });
    expect(result.ok).toBe(false);
    const state = await getGameState(handle.db, created.game.slug);
    expect(state.game.status).toBe("active");
  });

  it("主角死亡只通知 world，收尾与结局标签由 world 给出", async () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "提灯修士" ? { ...actor, isDefaultPlayer: true, hp: 0 } : actor,
      ),
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "主角陨落测试局",
      world,
    });

    const phase = await settleDeaths(handle.db, created.game.id);
    expect(phase.settled).toEqual(["提灯修士"]);

    const afterDeath = await getGameState(handle.db, created.game.slug);
    expect(afterDeath.game.status).toBe("active");
    expect(afterDeath.game.outcome).toBeNull();

    const ending = "灯灭了，灰烬盖住了那具身体，故事到此为止。";
    const result = await runWorldTurn(handle.db, created.game.slug, {
      service: new ScriptedService([
        call("end_game", { outcome: "主角陨落", message: ending }),
        call("submit_world_plan", {}),
      ]),
    });

    expect(result.ok).toBe(true);
    expect(result.state.game.status).toBe("completed");
    expect(result.state.game.outcome).toBe("主角陨落");
    expect(result.state.messages.some((message) => message.kind === "game_completed")).toBe(true);
  });

  it("rejects an end_game without an outcome", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "世界结局标签测试局",
      world: TEST_WORLD,
    });

    // 模型每轮都只给 message：工具报错、计划始终为空，整局保持 active。
    const result = await runWorldTurn(handle.db, created.game.slug, {
      service: new ScriptedService([
        call("end_game", { message: "门在身后合上了。" }),
        call("submit_world_plan", {}),
      ]),
    });

    expect(result.loopSuccess).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.state.game.status).toBe("active");
    expect(result.state.game.outcome).toBeNull();
  });

  it("fits two stage directives plus end_game in one turn", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "世界多动作测试局",
      world: TEST_WORLD,
    });
    const ending = "门后的路出现了，故事在此收束。";
    const result = await runWorldTurn(handle.db, created.game.slug, {
      service: new ScriptedService([
        call("notify_stage", { stageName: "灰烬门廊", content: "门廊的灯灭了。" }),
        call("notify_stage", { stageName: "断钟中殿", content: "中殿的钟裂开了。" }),
        call("end_game", { outcome: "escaped", message: ending }),
        call("submit_world_plan", {}),
      ]),
    });

    expect(result.ok).toBe(true);
    expect(result.plan?.actions).toHaveLength(3);
    expect(result.state.game.status).toBe("completed");
    expect(result.state.game.outcome).toBe("escaped");
  });

  it("rejects an end_game that is not the last world action", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "世界顺序测试局",
      world: TEST_WORLD,
    });
    const result = await runWorldTurn(handle.db, created.game.slug, {
      service: new ScriptedService([
        call("end_game", { outcome: "other", message: "提前结束。" }),
        call("notify_stage", { stageName: "灰烬门廊", content: "迟到的通知。" }),
        call("submit_world_plan", {}),
      ]),
    });

    expect(result.ok).toBe(false);
    expect(result.state.game.status).toBe("active");
    expect((await getGameState(handle.db, created.game.slug)).game.status).toBe("active");
  });

  it("轮次用尽时仍落账已暂存的动作，不丢 end_game", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "世界轮次耗尽测试局",
      world: TEST_WORLD,
    });
    const directive = "门廊的灯灭了。";
    const ending = "门后的路出现了，故事在此收束。";

    // 写两个动作后模型不再调终止工具：纠偏到上限后 loop 以失败结束。
    const result = await runWorldTurn(handle.db, created.game.slug, {
      service: new ScriptedRoundsService([
        [call("notify_stage", { stageName: "灰烬门廊", content: directive })],
        [call("end_game", { outcome: "escaped", message: ending })],
        [],
        [],
        [],
      ]),
    });

    expect(result.loopSuccess).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.plan?.actions.map((action) => action.kind)).toEqual(["notify_stage", "end_game"]);
    expect(result.state.game.status).toBe("completed");
    expect(result.state.messages.some((message) => message.kind === "game_completed")).toBe(true);

    const memories = await getGameMemories(handle.db, created.game.id);
    const gate = memories.find((memory) => memory.name === "灰烬门廊");
    expect(gate?.messages.some((message) => message.content.includes(directive))).toBe(true);
  });
});
