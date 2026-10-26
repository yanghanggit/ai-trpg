import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";
import { DEMO_USER } from "../src/db/demo-fixture";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  adjacentStageNames,
  applyStagePlan,
  createGame,
  getGameMemories,
  getGameState,
  playerMove,
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
    // 每次只返回一步，未用完的调用留到下一轮；脚本耗尽后返回空调用结束 loop。
    const toolCalls = this.pending.splice(0, 1);
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      toolCalls,
    });
  }
}

/** 记录本轮暴露的工具名，然后提交一个空计划（用于观察能力过滤）。 */
class ToolCaptureService implements ChatCompletionService {
  tools: string[] = [];

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.tools = request.tools?.map((tool) => tool.function.name) ?? [];
    const toolCalls = [call("submit_environment", {})];
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: "tool_calls",
      toolCalls,
    });
  }
}

const GATE = "场景.铁闸门";
const PATH = "场景.山道";

describe.skipIf(!testDatabaseUrl)("stage passage", () => {
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

  const createBellGame = async (name: string) =>
    createGame(handle.db, {
      username: DEMO_USER.username,
      name,
      world: BELL_MONASTERY_WORLD,
    });

  const stageIdOf = (state: Awaited<ReturnType<typeof getGameState>>, name: string) => {
    const stage = state.world.stages.find((candidate) => candidate.name === name);
    if (!stage) {
      throw new Error(`缺少场景: ${name}`);
    }
    return stage.id;
  };

  const passageBetween = (
    state: Awaited<ReturnType<typeof getGameState>>,
    from: string,
    to: string,
  ) => {
    const connection = state.world.connections.find(
      (candidate) =>
        candidate.fromStageId === stageIdOf(state, from) &&
        candidate.toStageId === stageIdOf(state, to),
    );
    return connection?.passage;
  };

  it("keeps the mountain path sealed and unreachable until the gate opens it", async () => {
    const created = await createBellGame("通道封锁测试局");
    const state = await getGameState(handle.db, created.game.slug);

    expect(passageBetween(state, GATE, PATH)).toBe("sealed");
    expect(adjacentStageNames(state, stageIdOf(state, GATE))).toEqual(["场景.墓园"]);
    expect(adjacentStageNames(state, stageIdOf(state, PATH))).toEqual([]);

    await takeActorControl(handle.db, created.game.slug, "角色.无名者");
    await playerMove(handle.db, created.game.slug, "角色.无名者", { targetStageName: "场景.墓园" });
    await playerMove(handle.db, created.game.slug, "角色.无名者", { targetStageName: GATE });
    await expect(
      playerMove(handle.db, created.game.slug, "角色.无名者", { targetStageName: PATH }),
    ).rejects.toThrow(/通道/);
  });

  it("opens the passage from the gate stage without notifying the world", async () => {
    const created = await createBellGame("开门测试局");
    await takeActorControl(handle.db, created.game.slug, "角色.无名者");
    await playerMove(handle.db, created.game.slug, "角色.无名者", { targetStageName: "场景.墓园" });
    await playerMove(handle.db, created.game.slug, "角色.无名者", { targetStageName: GATE });

    const result = await runStageTurn(handle.db, created.game.slug, GATE, {
      service: new ScriptedService([
        call("open_passage", { targetStageName: PATH }),
        call("submit_environment", {}),
      ]),
    });
    expect(result.ok).toBe(true);
    expect(result.plan).toEqual({ actions: [{ kind: "open_passage", targetStageName: PATH }] });

    const state = await getGameState(handle.db, created.game.slug);
    expect(passageBetween(state, GATE, PATH)).toBe("open");
    expect(adjacentStageNames(state, stageIdOf(state, GATE))).toContain(PATH);
    // 连通性变化是场景级事件，不写 world memory。
    expect(state.messages.some((message) => message.kind === "passage_change")).toBe(true);

    const memories = await getGameMemories(handle.db, created.game.id);
    const gateMemory = memories.find((memory) => memory.name === GATE);
    expect(
      gateMemory?.messages.some((message) =>
        message.content.includes(`${GATE}通往${PATH}的通道开启了`),
      ),
    ).toBe(true);
    const worldMemory = memories.find((memory) => memory.ownerType === "world");
    expect(
      worldMemory?.messages.some((message) => message.content.includes("来自场景的通知")),
    ).toBe(false);

    // 单向：走出去之后回不来。
    await playerMove(handle.db, created.game.slug, "角色.无名者", { targetStageName: PATH });
    await expect(
      playerMove(handle.db, created.game.slug, "角色.无名者", { targetStageName: GATE }),
    ).rejects.toThrow(/通道/);
    const moved = await getGameState(handle.db, created.game.slug);
    expect(moved.world.stages.find((stage) => stage.name === PATH)?.actors).toHaveLength(1);
  });

  it("lets only the mountain path report to the world, and ends the game there", async () => {
    const created = await createBellGame("逃出测试局");
    await takeActorControl(handle.db, created.game.slug, "角色.无名者");
    await playerMove(handle.db, created.game.slug, "角色.无名者", { targetStageName: "场景.墓园" });
    await playerMove(handle.db, created.game.slug, "角色.无名者", { targetStageName: GATE });
    await runStageTurn(handle.db, created.game.slug, GATE, {
      service: new ScriptedService([
        call("open_passage", { targetStageName: PATH }),
        call("submit_environment", {}),
      ]),
    });
    await playerMove(handle.db, created.game.slug, "角色.无名者", { targetStageName: PATH });

    // 铁闸门已不再拥有 notify_world，工具清单里没有它。
    const gateTools = new ToolCaptureService();
    await runStageTurn(handle.db, created.game.slug, GATE, { service: gateTools });
    expect(gateTools.tools).toContain("submit_environment");
    expect(gateTools.tools).not.toContain("notify_world");
    expect(gateTools.tools).not.toContain("open_passage"); // 边已打开，没有候选

    const notification = "一个裹着裹尸布的人从铁闸门后走出来，正沿山道往河谷去。";
    const reported = await runStageTurn(handle.db, created.game.slug, PATH, {
      service: new ScriptedService([
        call("notify_world", { content: notification }),
        call("submit_environment", {}),
      ]),
    });
    expect(reported.plan).toEqual({ actions: [{ kind: "notify_world", notification }] });
    expect(reported.ok).toBe(true);

    const memories = await getGameMemories(handle.db, created.game.id);
    const worldMemory = memories.find((memory) => memory.ownerType === "world");
    expect(worldMemory?.messages.some((message) => message.content.includes(notification))).toBe(
      true,
    );

    const ending = "那个人走出了枯钟修道院，山道尽头只剩风声。";
    const world = await runWorldTurn(handle.db, created.game.slug, {
      service: new ScriptedService([
        call("end_game", { message: ending }),
        call("submit_world_plan", {}),
      ]),
    });
    expect(world.ok).toBe(true);
    expect(world.state.game.status).toBe("completed");
  });

  it("rejects passage changes from stages without the ability or without a sealed edge", async () => {
    const created = await createBellGame("通道拒绝测试局");
    const state = await getGameState(handle.db, created.game.slug);

    // 墓园没有 open_passage 能力。
    const graveyard = state.world.stages.find((stage) => stage.name === "场景.墓园");
    if (!graveyard) {
      throw new Error("缺少墓园");
    }
    const rejectedByAbility = await applyStagePlan(
      handle.db,
      state.game.id,
      graveyard.id,
      { actions: [{ kind: "open_passage", targetStageName: PATH }] },
      [],
      true,
    );
    expect(rejectedByAbility).toBe(false);
    expect(
      (await getGameState(handle.db, created.game.slug)).world.connections.some(
        (connection) =>
          connection.passage === "open" && connection.toStageId === stageIdOf(state, PATH),
      ),
    ).toBe(false);

    // 铁闸门不能打开一条不存在的通道（地窖）。
    const gate = state.world.stages.find((stage) => stage.name === GATE);
    if (!gate) {
      throw new Error("缺少铁闸门");
    }
    const rejectedByEdge = await applyStagePlan(
      handle.db,
      state.game.id,
      gate.id,
      { actions: [{ kind: "open_passage", targetStageName: "场景.地窖" }] },
      [],
      true,
    );
    expect(rejectedByEdge).toBe(false);

    const memories = await getGameMemories(handle.db, state.game.id);
    const gateMemory = memories.find((memory) => memory.name === GATE);
    expect(gateMemory?.messages.some((message) => message.content.includes("未开启通道"))).toBe(
      true,
    );
  });
});
