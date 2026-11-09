import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CROW_GRAVE_WORLD } from "../seeds/dark-fantasy";
import { DEMO_USER } from "../src/db/demo-fixture";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getGameMemories,
  getGameState,
  playerMove,
  playerPickup,
  playerSteal,
  playerUse,
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
    const toolCalls = this.pending.splice(0, 1);
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      toolCalls,
    });
  }
}

async function createCrowGraveGame(handle: DatabaseHandle, name: string) {
  const created = await createGame(handle.db, {
    username: DEMO_USER.username,
    name,
    world: CROW_GRAVE_WORLD,
  });
  await takeActorControl(handle.db, created.game.slug, "拾骨人伊莱");
  return created;
}

/**
 * 鸦葬岗的 e2e：两条路线都从真实建局、真实玩家动作、真实 stage/world 回合走完。
 *
 * 推理端用 ScriptedService 固定成“场景小 GM 已经看懂事件”的那一步；
 * 这里验证的是内容链路与引擎接线，不是 LLM 的临场判断。
 */
describe.skipIf(!testDatabaseUrl)("crow grave e2e", () => {
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

  it("picks up the cellar pin, opens the sealed cellar, enters it, and lets the cellar end the game", async () => {
    const created = await createCrowGraveGame(handle, "鸦葬岗封尸窖 e2e");
    const slug = created.game.slug;

    // 窖钉卡在中庭的尸车里；拾取是普通的 anchor pickup。
    const picked = await playerPickup(handle.db, slug, "拾骨人伊莱", {
      targetAnchor: "尸车",
      itemName: "窖钉",
    });
    expect(picked.ok).toBe(true);

    // 对锁石使用窖钉：use 只写场景事件，开门留给鸦葬岗的 stage 回合。
    const used = await playerUse(handle.db, slug, "拾骨人伊莱", {
      targetStageName: "鸦葬岗",
      itemName: "窖钉",
      targetAnchor: "锁石",
    });
    expect(used.ok).toBe(true);
    const afterUse = await getGameState(handle.db, slug);
    expect(afterUse.messages.some((message) => message.content.includes("锁石"))).toBe(true);
    const memoriesAfterUse = await getGameMemories(handle.db, created.game.id);
    const graveyardMemory = memoriesAfterUse.find((memory) => memory.name === "鸦葬岗");
    expect(graveyardMemory?.messages.some((message) => message.content.includes("锁石"))).toBe(
      true,
    );

    // 鸦葬岗的小 GM 看到窖钉归位，才把石壁后的通道打开。
    const opened = await runStageTurn(handle.db, slug, "鸦葬岗", {
      service: new ScriptedService([
        call("open_passage", { targetStageName: "封尸窖" }),
        call("submit_stage_plan", {}),
      ]),
    });
    expect(opened.ok).toBe(true);
    expect(opened.plan?.actions).toEqual([
      { kind: "open_passage", targetStageName: "封尸窖" },
    ]);

    const afterOpen = await getGameState(handle.db, slug);
    const graveyard = afterOpen.world.stages.find((stage) => stage.name === "鸦葬岗");
    const cellar = afterOpen.world.stages.find((stage) => stage.name === "封尸窖");
    expect(
      afterOpen.world.connections.find(
        (connection) =>
          connection.fromStageId === graveyard?.id && connection.toStageId === cellar?.id,
      )?.passage,
    ).toBe("open");

    const moved = await playerMove(handle.db, slug, "拾骨人伊莱", { targetStageRef: "封尸窖" });
    expect(moved.ok).toBe(true);

    // 收束报告由封尸窖自己发出：窖底的东西只在这里见光。
    const notification =
      "锁石后的石壁裂开，封尸窖见了光；窖底的骨渣、烂裹尸布和一口没有钉死的小棺露了出来。";
    const reported = await runStageTurn(handle.db, slug, "封尸窖", {
      service: new ScriptedService([
        call("notify_world", { content: notification }),
        call("submit_stage_plan", {}),
      ]),
    });
    expect(reported.ok).toBe(true);
    expect(reported.plan?.actions).toEqual([{ kind: "notify_world", notification }]);

    const memoriesAfterReport = await getGameMemories(handle.db, created.game.id);
    const worldMemory = memoriesAfterReport.find((memory) => memory.ownerType === "world");
    expect(worldMemory?.messages.some((message) => message.content.includes(notification))).toBe(
      true,
    );

    const ended = await runWorldTurn(handle.db, slug, {
      service: new ScriptedService([
        call("end_game", {
          outcome: "封尸窖被打开",
          message: "锁石被撬开，窖底的小棺与骨渣终于见了光；坡上的乌鸦落回坟头。",
        }),
        call("submit_world_plan", {}),
      ]),
    });
    expect(ended.ok).toBe(true);
    expect(ended.state.game.status).toBe("completed");
    expect(ended.state.game.outcome).toBe("封尸窖被打开");
  });

  it("steals the tower key from the mad corpse-collector, unlocks the tower, and lets the tower end the game", async () => {
    const created = await createCrowGraveGame(handle, "鸦葬岗守夜塔 e2e");
    const slug = created.game.slug;

    // 钥匙在卡尔背包里、不在穿戴槽；活着也能偷。
    const stolen = await playerSteal(handle.db, slug, "拾骨人伊莱", {
      targetActorRef: "收尸人卡尔",
      itemName: "塔门钥匙",
    });
    expect(stolen.ok).toBe(true);

    const used = await playerUse(handle.db, slug, "拾骨人伊莱", {
      targetStageName: "鸦葬岗",
      itemName: "塔门钥匙",
      targetAnchor: "塔门",
    });
    expect(used.ok).toBe(true);

    const opened = await runStageTurn(handle.db, slug, "鸦葬岗", {
      service: new ScriptedService([
        call("open_passage", { targetStageName: "守夜塔" }),
        call("submit_stage_plan", {}),
      ]),
    });
    expect(opened.ok).toBe(true);
    expect(opened.plan?.actions).toEqual([
      { kind: "open_passage", targetStageName: "守夜塔" },
    ]);

    const afterOpen = await getGameState(handle.db, slug);
    const graveyard = afterOpen.world.stages.find((stage) => stage.name === "鸦葬岗");
    const tower = afterOpen.world.stages.find((stage) => stage.name === "守夜塔");
    expect(
      afterOpen.world.connections.find(
        (connection) =>
          connection.fromStageId === graveyard?.id && connection.toStageId === tower?.id,
      )?.passage,
    ).toBe("open");

    const moved = await playerMove(handle.db, slug, "拾骨人伊莱", { targetStageRef: "守夜塔" });
    expect(moved.ok).toBe(true);

    const notification = "塔门上的锁开了，有人走上了守夜塔；塔顶的火盆边堆着干芦苇。";
    const reported = await runStageTurn(handle.db, slug, "守夜塔", {
      service: new ScriptedService([
        call("notify_world", { content: notification }),
        call("submit_stage_plan", {}),
      ]),
    });
    expect(reported.ok).toBe(true);
    expect(reported.plan?.actions).toEqual([{ kind: "notify_world", notification }]);

    const ended = await runWorldTurn(handle.db, slug, {
      service: new ScriptedService([
        call("end_game", {
          outcome: "守夜塔的烽火亮了",
          message: "守夜塔的烽火亮了起来，坡下的人看见了；拾骨人走出了鸦葬岗。",
        }),
        call("submit_world_plan", {}),
      ]),
    });
    expect(ended.ok).toBe(true);
    expect(ended.state.game.status).toBe("completed");
    expect(ended.state.game.outcome).toBe("守夜塔的烽火亮了");
  });
});
