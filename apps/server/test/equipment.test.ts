import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";
import { DEMO_USER } from "../src/db/demo-fixture";
import { TEST_WORLD } from "./test-world";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getGameMemories,
  getGameState,
  playerEquip,
  playerMove,
  playerUnequip,
  runNpcTurn,
  takeActorControl,
} from "../src/game";
import { buildActorTurnInput } from "../src/game/npc";
import { describeStageForActor } from "../src/game/plan";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!testDatabaseUrl)("equip and unequip actions", () => {
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

  const createKeeperGame = async (name: string) => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name,
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "奥德里克");
    return created;
  };

  it("换装只改穿戴索引，不自动重写外观快照", async () => {
    const created = await createKeeperGame("换装不推外观测试局");
    const before = await getGameState(handle.db, created.game.slug);
    const appearanceBefore = before.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "奥德里克")?.appearance;

    // 先把斗篷卸下，再穿回去，两次都是纯动作。
    const removed = await playerUnequip(handle.db, created.game.slug, "奥德里克", {
      slot: "armor",
    });
    expect(removed.ok).toBe(true);
    expect(removed.plan?.actions[0]).toEqual({ kind: "unequip", slot: "armor" });

    const worn = await playerEquip(handle.db, created.game.slug, "奥德里克", {
      itemName: "补丁斗篷",
      slot: "armor",
    });
    expect(worn.ok).toBe(true);
    expect(worn.plan?.actions[0]).toEqual({
      kind: "equip",
      itemName: "补丁斗篷",
      slot: "armor",
    });

    const state = await getGameState(handle.db, created.game.slug);
    const keeper = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "奥德里克");
    expect(keeper?.equipment.armor).toBe("补丁斗篷");
    // 没提供 appearanceService：动作不会顺手改外观，需要 agent:game appearance 单独推动。
    expect(keeper?.appearance).toBe(appearanceBefore);
    expect(state.messages.map((message) => message.kind)).toEqual(["unequip", "equip"]);

    // 写进 actor 记忆的反馈已经脱敏：物品名就是名字本身（公共消息仍是上帝视角）。
    const memories = await getGameMemories(handle.db, created.game.id);
    const feedback =
      memories
        .find((memory) => memory.name === "奥德里克")
        ?.messages.filter((message) => message.content.startsWith("# 行动结果"))
        .map((message) => message.content)
        .join("\n") ?? "";
    expect(feedback).toContain("你穿上了补丁斗篷");
    expect(feedback).toContain("你卸下了补丁斗篷");
    expect(feedback).not.toContain("@");
  });

  it("物品仍在背包里，只是不再计入穿戴", async () => {
    const created = await createKeeperGame("卸下后仍在背包测试局");
    const removed = await playerUnequip(handle.db, created.game.slug, "奥德里克", {
      slot: "weapon",
    });
    expect(removed.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const keeper = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "奥德里克");
    expect(keeper?.equipment.weapon).toBeUndefined();
    expect(keeper?.items.map((item) => item.name)).toContain("掘墓人的铁锹");
  });

  it("槽位大类不匹配时拒绝", async () => {
    const created = await createKeeperGame("槽位大类测试局");
    await expect(
      playerEquip(handle.db, created.game.slug, "奥德里克", {
        itemName: "闸门钥匙",
        slot: "armor",
      }),
    ).rejects.toThrow("不能放进护甲槽");
  });

  it("空槽位不能卸下", async () => {
    const created = await createKeeperGame("空槽位测试局");
    await expect(
      playerUnequip(handle.db, created.game.slug, "奥德里克", { slot: "accessory" }),
    ).rejects.toThrow("槽没有装备");
  });

  it("同槽再穿一件是替换：旧装备退回背包，外观不动", async () => {
    const spare = {
      key: "spare-blade",
      name: "备用短刀",
      description: "刀背磨得发亮。",
      kind: "weapon" as const,
      count: 1,
      stats: { damage: 2, block: 0 },
      effect: { type: "damage" as const },
    };
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人" ? { ...actor, items: [...actor.items, spare] } : actor,
      ),
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "同槽替换测试局",
      world,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    const appearanceBefore = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人")?.appearance;

    // 背包里已有裂齿短刃，换成备用短刀。
    await playerEquip(handle.db, created.game.slug, "守烬人", {
      itemName: "备用短刀",
      slot: "weapon",
    });
    let state = await getGameState(handle.db, created.game.slug);
    const afterFirst = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人");
    expect(afterFirst?.equipment.weapon).toBe("备用短刀");

    // 再穿回裂齿短刃：不报错、不需要先卸下，槽位直接替换。
    await playerEquip(handle.db, created.game.slug, "守烬人", {
      itemName: "裂齿短刃",
      slot: "weapon",
    });
    state = await getGameState(handle.db, created.game.slug);
    const keeper = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人");
    expect(keeper?.equipment.weapon).toBe("裂齿短刃");
    // 被替换下来的装备仍在背包里，没有丢也没有重复穿戴。
    expect(keeper?.items.map((item) => item.name).sort()).toEqual(["备用短刀", "裂齿短刃"]);
    expect(Object.values(keeper?.equipment ?? {}).filter((name) => name === "备用短刀")).toEqual(
      [],
    );
    // 换装只改索引：外观快照保持原样，不触发任何推理。
    expect(keeper?.appearance).toBe(appearanceBefore);
    expect(state.messages.map((message) => message.kind)).toEqual(["equip", "equip"]);
  });

  it("同场景名单列出已穿戴装备，回合输入直接可读", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "名单穿戴测试局",
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "奥德里克");
    const state = await getGameState(handle.db, created.game.slug);
    const cinder = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "煤渣");
    const stage = state.world.stages.find((candidate) =>
      candidate.actors.some((actor) => actor.id === cinder?.id),
    );
    if (!cinder || !stage) {
      throw new Error("缺少墓园夹具");
    }

    const input = buildActorTurnInput(state, { actor: cinder, stage });
    expect(input).toContain("武器：掘墓人的铁锹");
    expect(input).toContain("护甲：补丁斗篷");
    expect(describeStageForActor(state, "墓园", { actor: cinder, stage })).toContain(
      "武器：掘墓人的铁锹",
    );
  });

  it("主角亮出武器后，同场景角色的名单与记忆都能看到", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "亮武器测试局",
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "无名者");
    await playerMove(handle.db, created.game.slug, "无名者", { targetStageRef: "墓园" });
    await playerEquip(handle.db, created.game.slug, "无名者", {
      itemName: "撬弯的棺钉",
      slot: "weapon",
    });

    const state = await getGameState(handle.db, created.game.slug);
    const cinder = state.world.stages
      .flatMap((candidate) => candidate.actors)
      .find((actor) => actor.name === "煤渣");
    const stage = state.world.stages.find((candidate) =>
      candidate.actors.some((actor) => actor.id === cinder?.id),
    );
    if (!cinder || !stage) {
      throw new Error("缺少墓园夹具");
    }

    const input = buildActorTurnInput(state, { actor: cinder, stage });
    expect(input).toContain("武器：撬弯的棺钉");
    // 换装事件也已落进旁观者记忆，名字仍是编号。
    const memories = await getGameMemories(handle.db, created.game.id);
    const seen =
      memories
        .find((memory) => memory.name === "煤渣")
        ?.messages.map((message) => message.content)
        .join("\n") ?? "";
    expect(seen).toContain("穿上了撬弯的棺钉（武器）");
    expect(seen).not.toContain("无名者");
  });

  it("提供 appearanceService 时，换装在事务外补一次外观推理", async () => {
    const created = await createKeeperGame("换装推外观测试局");
    const service = new AppearanceSubmitService("只穿旧衬衣，腰间别着铁锹。");
    const removed = await playerUnequip(
      handle.db,
      created.game.slug,
      "奥德里克",
      { slot: "armor" },
      { appearanceService: service },
    );
    expect(removed.ok).toBe(true);
    // 玩家路径没有规划 loop，只有这一次外观 loop。
    expect(service.calls).toBe(1);
    expect(service.input).toContain("[人类]");
    expect(service.input).not.toContain("补丁斗篷");

    const state = await getGameState(handle.db, created.game.slug);
    const keeper = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "奥德里克");
    expect(keeper?.appearance).toBe("只穿旧衬衣，腰间别着铁锹。");
    expect(keeper?.equipment.armor).toBeUndefined();

    // 新外观已广播给同场景知道名字的煤渣。
    const memories = await getGameMemories(handle.db, created.game.id);
    const seen =
      memories
        .find((memory) => memory.name === "煤渣")
        ?.messages.map((message) => message.content)
        .join("\n") ?? "";
    expect(seen).toContain("只穿旧衬衣，腰间别着铁锹。");
  });

  it("NPC 换装是规划与外观两个 loop", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "NPC换装双循环测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const planner = new UnequipPlanService();
    const appearance = new AppearanceSubmitService("空着手，旧斗篷还披在肩上。");
    const turn = await runNpcTurn(handle.db, created.game.slug, "奥德里克", {
      service: planner,
      appearanceService: appearance,
    });
    expect(turn.ok).toBe(true);
    expect(planner.calls).toBe(1);
    expect(appearance.calls).toBe(1);

    const state = await getGameState(handle.db, created.game.slug);
    const keeper = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "奥德里克");
    expect(keeper?.equipment.weapon).toBeUndefined();
    expect(keeper?.appearance).toBe("空着手，旧斗篷还披在肩上。");
  });
});

/** 只提交一个外观的假服务；calls 用来数外观 loop。 */
class AppearanceSubmitService implements ChatCompletionService {
  calls = 0;
  input = "";

  constructor(private readonly appearance: string) {}

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.calls += 1;
    this.input = request.inputMessage;
    const toolCalls: ToolCall[] = [
      {
        id: randomUUID(),
        type: "function",
        function: {
          name: "submit_appearance",
          arguments: JSON.stringify({ appearance: this.appearance }),
        },
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

/** 只提交一个卸装计划的假服务；calls 用来数规划 loop。 */
class UnequipPlanService implements ChatCompletionService {
  calls = 0;

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.calls += 1;
    const toolCalls: ToolCall[] = [
      {
        id: randomUUID(),
        type: "function",
        function: { name: "unequip", arguments: JSON.stringify({ slot: "weapon" }) },
      },
      { id: randomUUID(), type: "function", function: { name: "submit_plan", arguments: "{}" } },
    ];
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: "tool_calls",
      toolCalls,
    });
  }
}
