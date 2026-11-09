import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CROW_BELL_WORLD } from "../seeds/dark-fantasy";
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

async function createCrowBellGame(handle: DatabaseHandle, name: string) {
  const created = await createGame(handle.db, {
    username: DEMO_USER.username,
    name,
    world: CROW_BELL_WORLD,
  });
  await takeActorControl(handle.db, created.game.slug, "拾骨人伊莱");
  return created;
}

/**
 * 灰炉墓园的 e2e：两条路线都从真实建局、真实玩家动作、真实 stage/world 回合走完。
 *
 * 推理端用 ScriptedService 固定成“场景小 GM 已经看懂事件”的那一步；
 * 这里验证的是内容链路与引擎接线，不是 LLM 的临场判断。
 */
describe.skipIf(!testDatabaseUrl)("crow bell e2e", () => {
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

  it("picks up the clapper, opens the sealed well, enters it, and lets the well end the game", async () => {
    const created = await createCrowBellGame(handle, "灰炉墓园钟井 e2e");
    const slug = created.game.slug;

    // 断钟舌挂在墓园中庭的裂钟上；拾取是普通的 anchor pickup。
    const picked = await playerPickup(handle.db, slug, "拾骨人伊莱", {
      targetAnchor: "裂钟",
      itemName: "断钟舌",
    });
    expect(picked.ok).toBe(true);

    // 对空钟架使用断钟舌：use 只写场景事件，开门留给灰炉墓园的 stage 回合。
    const used = await playerUse(handle.db, slug, "拾骨人伊莱", {
      targetStageName: "灰炉墓园",
      itemName: "断钟舌",
      targetAnchor: "空钟架",
    });
    expect(used.ok).toBe(true);
    const afterUse = await getGameState(handle.db, slug);
    expect(afterUse.messages.some((message) => message.content.includes("空钟架"))).toBe(true);
    const memoriesAfterUse = await getGameMemories(handle.db, created.game.id);
    const graveyardMemory = memoriesAfterUse.find((memory) => memory.name === "灰炉墓园");
    expect(graveyardMemory?.messages.some((message) => message.content.includes("空钟架"))).toBe(
      true,
    );

    // 灰炉墓园的小 GM 看到钟舌归位，才把石壁后的通道打开。
    const opened = await runStageTurn(handle.db, slug, "灰炉墓园", {
      service: new ScriptedService([
        call("open_passage", { targetStageName: "钟井" }),
        call("submit_stage_plan", {}),
      ]),
    });
    expect(opened.ok).toBe(true);
    expect(opened.plan?.actions).toEqual([{ kind: "open_passage", targetStageName: "钟井" }]);

    const afterOpen = await getGameState(handle.db, slug);
    const graveyard = afterOpen.world.stages.find((stage) => stage.name === "灰炉墓园");
    const well = afterOpen.world.stages.find((stage) => stage.name === "钟井");
    expect(
      afterOpen.world.connections.find(
        (connection) =>
          connection.fromStageId === graveyard?.id && connection.toStageId === well?.id,
      )?.passage,
    ).toBe("open");

    const moved = await playerMove(handle.db, slug, "拾骨人伊莱", { targetStageRef: "钟井" });
    expect(moved.ok).toBe(true);

    // 收束报告由钟井自己发出：井底的东西只在这里见光。
    const notification =
      "空钟架后的石壁裂开，废井见了光；井底的裂钟、骨灰和一只发黑的木铃露了出来。";
    const reported = await runStageTurn(handle.db, slug, "钟井", {
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
          outcome: "钟井被打开",
          message: "裂钟被掀开，井底的骨灰与木铃终于见了光；墓园里的铃声停了。",
        }),
        call("submit_world_plan", {}),
      ]),
    });
    expect(ended.ok).toBe(true);
    expect(ended.state.game.status).toBe("completed");
    expect(ended.state.game.outcome).toBe("钟井被打开");
  });

  it("steals the tower key from the mad father, unlocks the tower, and lets the tower end the game", async () => {
    const created = await createCrowBellGame(handle, "灰炉墓园钟楼 e2e");
    const slug = created.game.slug;

    // 钥匙在卡兰背包里、不在穿戴槽；活着也能偷。
    const stolen = await playerSteal(handle.db, slug, "拾骨人伊莱", {
      targetActorRef: "钟父卡兰",
      itemName: "钟楼钥匙",
    });
    expect(stolen.ok).toBe(true);

    const used = await playerUse(handle.db, slug, "拾骨人伊莱", {
      targetStageName: "灰炉墓园",
      itemName: "钟楼钥匙",
      targetAnchor: "木门",
    });
    expect(used.ok).toBe(true);

    const opened = await runStageTurn(handle.db, slug, "灰炉墓园", {
      service: new ScriptedService([
        call("open_passage", { targetStageName: "钟楼" }),
        call("submit_stage_plan", {}),
      ]),
    });
    expect(opened.ok).toBe(true);
    expect(opened.plan?.actions).toEqual([{ kind: "open_passage", targetStageName: "钟楼" }]);

    const afterOpen = await getGameState(handle.db, slug);
    const graveyard = afterOpen.world.stages.find((stage) => stage.name === "灰炉墓园");
    const tower = afterOpen.world.stages.find((stage) => stage.name === "钟楼");
    expect(
      afterOpen.world.connections.find(
        (connection) =>
          connection.fromStageId === graveyard?.id && connection.toStageId === tower?.id,
      )?.passage,
    ).toBe("open");

    const moved = await playerMove(handle.db, slug, "拾骨人伊莱", { targetStageRef: "钟楼" });
    expect(moved.ok).toBe(true);

    const notification = "木门上的锁开了，有人走上了钟楼；墓园外的风从钟绳边灌进来。";
    const reported = await runStageTurn(handle.db, slug, "钟楼", {
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
          outcome: "钟楼的门开了",
          message: "钟楼的门开着，拾骨人走出了灰炉墓园；身后的铃声终于听不见了。",
        }),
        call("submit_world_plan", {}),
      ]),
    });
    expect(ended.ok).toBe(true);
    expect(ended.state.game.status).toBe("completed");
    expect(ended.state.game.outcome).toBe("钟楼的门开了");
  });
});
