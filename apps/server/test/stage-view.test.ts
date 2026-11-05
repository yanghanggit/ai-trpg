import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getStageView,
  playerMove,
  releaseActorControl,
  runStageTurn,
  takeActorControl,
} from "../src/game";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

function submitEnvironment(environment: string): ToolCall {
  return {
    id: randomUUID(),
    type: "function",
    function: { name: "submit_environment", arguments: JSON.stringify({ environment }) },
  };
}

function submitStagePlan(): ToolCall {
  return {
    id: randomUUID(),
    type: "function",
    function: { name: "submit_stage_plan", arguments: "{}" },
  };
}

class ScriptedStageService implements ChatCompletionService {
  constructor(private readonly environments: string[]) {}

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    const environment = this.environments.shift();
    if (environment === undefined) {
      throw new Error("脚本化 stage 环境已耗尽");
    }
    const toolCalls = [submitEnvironment(environment), submitStagePlan()];
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: "tool_calls",
      toolCalls,
    });
  }
}

/** stage 投影不复用 actor 的日志白名单；名字与出边按场景自己的可见性给。 */
describe.skipIf(!testDatabaseUrl)("stage view", () => {
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

  it("projects the scene with real names and sealed exits", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场景视图测试局",
      world: BELL_MONASTERY_WORLD,
    });

    const graveyard = await getStageView(handle.db, created.game.slug, "墓园");
    expect(graveyard.viewer).toEqual({
      stageId: created.world.stages.find((stage) => stage.name === "墓园")?.id,
      name: "墓园",
    });
    expect(graveyard.scene.environment).toBe(
      created.world.stages.find((stage) => stage.name === "墓园")?.environment,
    );
    // 场景看到的是真名，不做观察者遮罩。
    expect(graveyard.scene.actors.map((actor) => actor.name).sort()).toEqual(
      ["小狗“煤渣”", "奥德里克", "小鼠“坏运气”"].sort(),
    );
    expect(graveyard.scene.actors.every((actor) => actor.appearance.length > 0)).toBe(true);
    expect(graveyard.scene.actors.find((actor) => actor.name === "奥德里克")?.appearance).toContain(
      "铁锹",
    );
    expect(graveyard.scene.exits.map((exit) => [exit.name, exit.passage]).sort()).toEqual([
      ["地窖", "open"],
      ["焚尸房", "open"],
      ["铁闸门", "open"],
    ]);
    expect(graveyard.scene.anchors).toEqual([
      { label: "锁孔", description: "铁闸门上被干蜡塞住的锁孔。" },
    ]);

    // 铁闸门通往山道的边是 sealed：stage 自己就是开门的写入方，所以它要看到通行状态。
    const gate = await getStageView(handle.db, created.game.slug, "铁闸门");
    expect(gate.scene.exits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "墓园", passage: "open" }),
        expect.objectContaining({ name: "山道", passage: "sealed" }),
      ]),
    );

    // 还没有仲裁过：log 为空，不含 system prompt。
    expect(graveyard.log).toEqual([]);
  });

  it("logs the opening snapshot and only stage-owned memory kinds", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场景视图日志测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const before = await getStageView(handle.db, created.game.slug, "墓园");
    const environment = "石灰被夜露打湿，枯草伏倒；北侧铁链上结了一层白霜。";
    expect(environment).not.toBe(before.scene.environment);

    await runStageTurn(handle.db, created.game.slug, "墓园", {
      service: new ScriptedStageService([environment]),
    });

    const after = await getStageView(handle.db, created.game.slug, "墓园");
    expect(after.log.map((entry) => entry.kind)).toEqual([
      "stage_opening_snapshot",
      "stage_observation",
    ]);
    expect(after.log[0]?.content).toContain("# 本局开局场景");
    expect(after.log[0]?.content).toContain(before.scene.environment);
    expect(after.log[1]?.eventKind).toBe("environment_change");
    expect(after.log[1]?.content).toContain(environment);
    // 日志只收 stage memory 自己的类别：actor 的私有观察、反馈与识名都不能混进来。
    expect(new Set(after.log.map((entry) => entry.kind))).toEqual(
      new Set(["stage_opening_snapshot", "stage_observation"]),
    );
  });

  it("writes the baseline before the first scene event, even without arbitration", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场景基线先于事件测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const cellarEnvironment = created.world.stages.find(
      (stage) => stage.name === "地窖",
    )?.environment;
    if (cellarEnvironment === undefined) {
      throw new Error("缺少地窖");
    }

    // actor 移动会立刻写两侧 stage memory，早于任何一次 stage 仲裁。
    await takeActorControl(handle.db, created.game.slug, "奥德里克");
    await playerMove(handle.db, created.game.slug, "奥德里克", { targetStageRef: "地窖" });
    await releaseActorControl(handle.db, created.game.slug, "奥德里克");

    const cellar = await getStageView(handle.db, created.game.slug, "地窖");
    expect(cellar.log.map((entry) => entry.kind)).toEqual([
      "stage_opening_snapshot",
      "stage_observation",
    ]);
    expect(cellar.log[0]?.content).toContain(cellarEnvironment);
    expect(cellar.log[1]?.eventKind).toBe("move_enter");

    // 起点场景同样先落基线，再落离开事件。
    const graveyard = await getStageView(handle.db, created.game.slug, "墓园");
    expect(graveyard.log.map((entry) => entry.kind)).toEqual([
      "stage_opening_snapshot",
      "stage_observation",
    ]);
    expect(graveyard.log[1]?.eventKind).toBe("move_leave");
  });
});
