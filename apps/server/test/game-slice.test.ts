import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DARK_FANTASY_WORLD } from "../seeds/dark-fantasy";
import { DEMO_USER } from "../src/db/demo-fixture";
import { TEST_WORLD } from "./test-world";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { loadSnapshot } from "../src/debug/snapshot";
import {
  type ActorAction,
  type ActorPlan,
  applyActorPlan,
  createGame,
  getGameMemories,
  getGameState,
  runNpcTurn,
  snapshotGame,
} from "../src/game";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

/** 攻击动作：十二个平级动作之一。 */
function attackAction(targetActorName: string): ActorAction {
  return { kind: "attack", targetActorName };
}

/** 只记录本次请求暴露了哪些工具，然后提交一个 wait。 */
class ToolCaptureService implements ChatCompletionService {
  tools: string[] = [];

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.tools = request.tools?.map((tool) => tool.function.name) ?? [];
    const toolCalls: ToolCall[] = [
      {
        id: randomUUID(),
        type: "function",
        function: { name: "wait", arguments: "{}" },
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

class ScriptedNpcService implements ChatCompletionService {
  private readonly plans: ActorPlan[];

  constructor(plans: ActorPlan[]) {
    this.plans = [...plans];
  }

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    const plan = this.plans.shift();
    if (!plan) {
      throw new Error("脚本化 NPC 计划已耗尽");
    }
    // 动作形状与工具参数一致：把 kind 当工具名，其余字段直接作为参数。
    const toolCalls: ToolCall[] = plan.actions.map((action) => {
      const { kind, ...args } = action;
      return {
        id: randomUUID(),
        type: "function",
        function: { name: kind, arguments: JSON.stringify(args) },
      };
    });
    toolCalls.push({
      id: randomUUID(),
      type: "function",
      function: { name: "submit_plan", arguments: "{}" },
    });
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: "tool_calls",
      toolCalls,
    });
  }
}

describe.skipIf(!testDatabaseUrl)("memory-driven NPC slice", () => {
  let handle: DatabaseHandle;
  let snapshotRoot: string;

  beforeAll(async () => {
    handle = openDatabase("TEST_DATABASE_URL");
    await runMigrations(handle.db);
    await resetDomainData(handle.db);
    await seedDemoData(handle.db);
    snapshotRoot = await mkdtemp(join(tmpdir(), "ai-trpg-npc-slice-"));
  });

  afterAll(async () => {
    await handle.pool.end();
    await rm(snapshotRoot, { recursive: true, force: true });
  });

  it("runs two NPCs from isolated memory, lets them speak and move", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "灰烬测试局",
      world: TEST_WORLD,
    });

    expect(created.world.stages).toHaveLength(2);
    expect(created.world.connections).toHaveLength(2);
    expect(created.world.stages.flatMap((stage) => stage.actors)).toHaveLength(3);
    expect(created.world.stages[0]?.actors.map((actor) => actor.name)).toEqual([
      "守烬人",
      "提灯修士",
    ]);
    expect(created.world.stages[1]?.actors.map((actor) => actor.name)).toEqual(["缄默抄经人"]);

    const service = new ScriptedNpcService([
      {
        actions: [
          {
            kind: "say",
            mind: "先试探他。",
            targetActorName: "提灯修士",
            message: "你听见钟声了吗？",
          },
        ],
      },
      {
        actions: [
          {
            kind: "whisper",
            mind: "不要让它继续响。",
            targetActorName: "守烬人",
            message: "别回应它。",
          },
        ],
      },
      { actions: [{ kind: "move", targetStageName: "断钟中殿" }] },
      { actions: [{ kind: "move", targetStageName: "断钟中殿" }] },
    ]);

    const first = await runNpcTurn(handle.db, created.game.slug, "守烬人", {
      service,
    });
    expect(first.ok).toBe(true);
    expect(first.plan?.actions[0]).toMatchObject({ kind: "say" });

    const second = await runNpcTurn(handle.db, created.game.slug, "提灯修士", {
      service,
    });
    expect(second.ok).toBe(true);

    const third = await runNpcTurn(handle.db, created.game.slug, "守烬人", {
      service,
    });
    expect(third.ok).toBe(true);

    const fourth = await runNpcTurn(handle.db, created.game.slug, "提灯修士", {
      service,
    });
    expect(fourth.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.game.version).toBe(4);
    expect(state.messages.map((message) => message.kind)).toEqual([
      "narration",
      "say",
      "whisper",
      "move",
      "move",
    ]);
    expect(state.messages[1]?.targetActorId).toBeTruthy();
    expect(state.messages[1]?.sourceActorId).toBeTruthy();
    expect(state.messages[1]?.visibility).toBe("stage");
    expect(state.messages[2]?.targetActorId).toBeTruthy();
    expect(state.messages[2]?.visibility).toBe("private");
    expect(state.messages[3]?.targetActorId).toBeNull();
    const actorStages = state.world.stages.flatMap((stage) =>
      stage.actors.map((actor) => [actor.name, stage.name] as const),
    );
    expect(actorStages).toHaveLength(3);
    expect(actorStages).toEqual(
      expect.arrayContaining([
        ["缄默抄经人", "断钟中殿"],
        ["守烬人", "断钟中殿"],
        ["提灯修士", "断钟中殿"],
      ]),
    );

    const memories = await getGameMemories(handle.db, created.game.id);
    expect(memories).toHaveLength(6);
    expect(memories.some((memory) => memory.ownerType === "world")).toBe(true);
    const keeper = memories.find((memory) => memory.name === "守烬人");
    const monk = memories.find((memory) => memory.name === "提灯修士");
    const scribe = memories.find((memory) => memory.name === "缄默抄经人");
    expect(scribe?.messages[0]?.type).toBe("system");
    expect(keeper?.messages[0]?.type).toBe("system");
    expect(monk?.messages[0]?.type).toBe("system");
    expect(
      keeper?.messages.some((message) =>
        message.content.includes("提灯修士对你耳语（场景：灰烬门廊）：别回应它。"),
      ),
    ).toBe(true);
    expect(
      monk?.messages.some((message) =>
        message.content.includes("守烬人对你说（场景：灰烬门廊）：你听见钟声了吗？"),
      ),
    ).toBe(true);
    expect(keeper?.messages.some((message) => message.type === "tool")).toBe(true);
    expect(
      keeper?.messages.some((message) =>
        message.content.includes("提灯修士从灰烬门廊进入了断钟中殿"),
      ),
    ).toBe(true);

    const result = await snapshotGame(handle.db, created.game.slug, {
      root: snapshotRoot,
      action: "npc",
    });
    expect(result.snapshot.manifest).toMatchObject({
      source: "db",
      dbVersion: 4,
      contentVersion: TEST_WORLD.contentVersion,
    });
    expect(result.snapshot.manifest.parts).toEqual(
      expect.arrayContaining([
        "game.json",
        "messages.json",
        "memories/守烬人.json",
        "memories/守烬人.meta.json",
        "memories/提灯修士.json",
        "memories/提灯修士.meta.json",
        "memories/缄默抄经人.json",
        "memories/缄默抄经人.meta.json",
      ]),
    );

    const loaded = await loadSnapshot(result.snapshot.path);
    expect(loaded.parts["memories/守烬人.json"]).toBeDefined();
    expect(loaded.session).toHaveLength(5);
  });
  it("injects openingBriefing as the actor's first human memory message", async () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人"
          ? {
              ...actor,
              openingBriefing: "守住灰烬门廊，不要让陌生人靠近断钟。",
            }
          : actor,
      ),
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "开局简报测试局",
      world,
    });

    const memories = await getGameMemories(handle.db, created.game.id);
    const keeper = memories.find((memory) => memory.name === "守烬人");
    const monk = memories.find((memory) => memory.name === "提灯修士");
    expect(keeper?.messages.map((message) => message.type)).toEqual(["system", "human"]);
    expect(keeper?.messages[1]?.content).toContain("# 本局开局简报");
    expect(keeper?.messages[1]?.content).toContain("守住灰烬门廊，不要让陌生人靠近断钟。");
    expect(keeper?.messages[1]?.metadata).toMatchObject({ kind: "actor_opening_briefing" });
    expect(monk?.messages.map((message) => message.type)).toEqual(["system"]);
  });

  it("only exposes actions the actor is allowed to use", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "能力过滤测试局",
      world: DARK_FANTASY_WORLD,
    });

    const keeperService = new ToolCaptureService();
    await runNpcTurn(handle.db, created.game.slug, "角色.奥德里克", { service: keeperService });
    expect(keeperService.tools).toContain("say");
    expect(keeperService.tools).toContain("attack");
    expect(keeperService.tools).not.toContain("steal");
    expect(keeperService.tools).toContain("get_self");
    expect(keeperService.tools).toContain("observe_actor");
    expect(keeperService.tools).not.toContain("get_actor");
    expect(keeperService.tools).not.toContain("get_stats");
    expect(keeperService.tools).not.toContain("get_items");
    expect(keeperService.tools).toContain("query");
    // 会操作道具的人类能自己穿脱装备；动物不能。
    expect(keeperService.tools).toContain("equip");
    expect(keeperService.tools).toContain("unequip");

    // 公共知识库检索对所有 actor 开放，不按角色开关。
    const corpseService = new ToolCaptureService();
    await runNpcTurn(handle.db, created.game.slug, "角色.无名者", { service: corpseService });
    expect(corpseService.tools).toContain("steal");
    expect(corpseService.tools).toContain("query");

    const dogService = new ToolCaptureService();
    await runNpcTurn(handle.db, created.game.slug, "角色.煤渣", { service: dogService });
    expect(dogService.tools).toContain("query");
    expect(dogService.tools).not.toContain("equip");
    expect(dogService.tools).not.toContain("unequip");

    const mouseService = new ToolCaptureService();
    await runNpcTurn(handle.db, created.game.slug, "角色.坏运气", { service: mouseService });
    expect(mouseService.tools).not.toContain("attack");
    expect(mouseService.tools).not.toContain("pickup");
    expect(mouseService.tools).not.toContain("give");
    expect(mouseService.tools).not.toContain("use");
    expect(mouseService.tools).not.toContain("steal");
    expect(mouseService.tools).toContain("query");
  });

  it("rejects a plan with more actions than the per-turn cap", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "行动条数上限测试局",
      world: TEST_WORLD,
    });
    const keeper = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人");
    expect(keeper).toBeDefined();

    const result = await applyActorPlan(
      handle.db,
      created.game.id,
      keeper?.id as string,
      {
        actions: [{ kind: "wait" }, { kind: "wait" }, { kind: "wait" }],
      },
      [],
      true,
    );
    expect(result.ok).toBe(false);
    expect(result.rejection).toContain("本轮最多 2 个行动");

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.game.version).toBe(0);
    expect(state.messages).toHaveLength(1);

    const memories = await getGameMemories(handle.db, created.game.id);
    const keeperMemory = memories.find((memory) => memory.name === "守烬人");
    expect(
      keeperMemory?.messages.some((message) => message.content.includes("本轮最多 2 个行动")),
    ).toBe(true);
  });

  it("emits a public event for wait", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "等待事件测试局",
      world: TEST_WORLD,
    });
    const service = new ScriptedNpcService([{ actions: [{ kind: "wait" }] }]);

    const result = await runNpcTurn(handle.db, created.game.slug, "守烬人", { service });
    expect(result.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.game.version).toBe(1);
    expect(state.messages.map((message) => message.kind)).toEqual(["narration", "wait"]);
    expect(state.messages[1]?.content).toContain("守烬人留在原地");
    expect(state.messages[1]?.visibility).toBe("stage");

    const memories = await getGameMemories(handle.db, created.game.id);
    const monk = memories.find((memory) => memory.name === "提灯修士");
    expect(
      monk?.messages.some((message) => message.content.includes("守烬人留在原地，继续观察四周。")),
    ).toBe(true);
  });

  it("applies attack using attack and defense, and writes combat feedback", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "攻击测试局",
      world: TEST_WORLD,
    });
    const service = new ScriptedNpcService([{ actions: [attackAction("提灯修士")] }]);

    const result = await runNpcTurn(handle.db, created.game.slug, "守烬人", { service });
    expect(result.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.game.version).toBe(1);
    expect(state.messages.map((message) => message.kind)).toEqual(["narration", "attack"]);
    // 守烬人装备了裂齿短刃：6（attack）+ 3（damage）- 3（防御）= 6 点伤害。
    expect(state.messages[1]?.content).toContain(
      "守烬人对提灯修士使用攻击（使用裂齿短刃），造成6点伤害",
    );
    expect(state.messages[1]?.targetActorId).toBeTruthy();
    expect(state.messages[1]?.sourceActorId).toBeTruthy();
    expect(state.messages[1]?.visibility).toBe("stage");

    const monkState = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monkState?.hp).toBe(4);

    const memories = await getGameMemories(handle.db, created.game.id);
    const keeper = memories.find((memory) => memory.name === "守烬人");
    const monk = memories.find((memory) => memory.name === "提灯修士");
    expect(
      keeper?.messages.some((message) =>
        message.content.includes("你使用攻击（使用裂齿短刃）对提灯修士，造成6点伤害"),
      ),
    ).toBe(true);
    expect(
      monk?.messages.some((message) =>
        message.content.includes(
          "守烬人对你使用攻击（使用裂齿短刃），造成6点伤害；你剩余 HP 4/10。",
        ),
      ),
    ).toBe(true);
  });

  it("materializes scene items and starts the narration in the crypt", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "故事结构测试局",
      world: DARK_FANTASY_WORLD,
    });
    const pyre = created.world.stages.find((stage) => stage.name === "场景.焚尸房");
    const crypt = created.world.stages.find((stage) => stage.name === "场景.乱葬坑");
    expect(pyre?.actors).toEqual([]);
    expect(pyre?.items.map((item) => [item.name, item.kind])).toEqual([
      ["武器.焚鼠火把", "weapon"],
    ]);
    expect(created.messages[0]?.stageId).toBe(crypt?.id);
  });

  it("marks a killed actor as dead and refuses to run its NPC loop", async () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "提灯修士"
          ? { ...actor, hp: 1, stats: { ...actor.stats, maxHp: 1, defense: 0 } }
          : actor,
      ),
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "死亡测试局",
      world,
    });
    const service = new ScriptedNpcService([{ actions: [attackAction("提灯修士")] }]);

    const result = await runNpcTurn(handle.db, created.game.slug, "守烬人", { service });
    expect(result.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.messages[1]?.content).toContain("提灯修士倒下了");
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk?.hp).toBe(0);

    await expect(
      runNpcTurn(handle.db, created.game.slug, "提灯修士", {
        service: new ScriptedNpcService([]),
      }),
    ).rejects.toThrow("已死亡");
  });

  it("ends the game when the default player actor dies", async () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "提灯修士"
          ? {
              ...actor,
              isDefaultPlayer: true,
              hp: 1,
              stats: { ...actor.stats, maxHp: 1, defense: 0 },
            }
          : actor,
      ),
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "默认玩家死亡测试局",
      world,
    });
    const defaultPlayer = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(defaultPlayer?.isDefaultPlayer).toBe(true);

    const service = new ScriptedNpcService([{ actions: [attackAction("提灯修士")] }]);
    const result = await runNpcTurn(handle.db, created.game.slug, "守烬人", { service });
    expect(result.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.game.status).toBe("completed");
    expect(
      state.messages.some(
        (message) => message.kind === "game_completed" && message.content.includes("故事就此结束"),
      ),
    ).toBe(true);
  });

  it("applies one talk and one move action in tool-call order", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "组合行动测试局",
      world: TEST_WORLD,
    });

    const service = new ScriptedNpcService([
      {
        actions: [
          { kind: "move", targetStageName: "断钟中殿" },
          {
            kind: "say",
            mind: "到了中殿再问抄经人。",
            targetActorName: "缄默抄经人",
            message: "你看见钟摆了吗？",
          },
        ],
      },
    ]);

    const result = await runNpcTurn(handle.db, created.game.slug, "守烬人", { service });
    expect(result.ok).toBe(true);
    expect(result.plan?.actions).toHaveLength(2);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.game.version).toBe(2);
    expect(state.messages.map((message) => message.kind)).toEqual(["narration", "move", "say"]);
    expect(state.messages[1]?.stageId).toBe(
      state.world.stages.find((stage) => stage.name === "断钟中殿")?.id,
    );
    expect(state.messages[2]?.targetActorId).toBeTruthy();
    expect(state.messages[2]?.stageId).toBe(
      state.world.stages.find((stage) => stage.name === "断钟中殿")?.id,
    );

    const keeperLocation = state.world.stages
      .flatMap((stage) => stage.actors.map((actor) => [actor.name, stage.name] as const))
      .find(([name]) => name === "守烬人");
    expect(keeperLocation?.[1]).toBe("断钟中殿");
  });

  it("writes observer-specific communication and attack memory for a third actor", async () => {
    const world = {
      ...TEST_WORLD,
      actors: [
        ...TEST_WORLD.actors,
        {
          stageKey: "gate",
          name: "旁听者",
          profile: "一个缩在门廊阴影里的无关者。",
          appearance: "只看得见一双贴在石墙后的眼睛。",
          baseBody: { race: "人类", description: "瘦小，总把自己藏在阴影里。" },
          hp: 8,
          stats: { maxHp: 8, attack: 1, defense: 1, speed: 2, damage: 0, block: 0 },
          items: [],
          actions: ["say", "whisper", "move", "wait"] as const,
        },
      ],
    };
    const game = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "旁听测试局",
      world,
    });
    const service = new ScriptedNpcService([
      {
        actions: [
          {
            kind: "announce",
            mind: "先让所有人听见。",
            message: "灰里有人。",
          },
        ],
      },
      {
        actions: [
          {
            kind: "say",
            mind: "这句给目标，但旁人也会听见。",
            targetActorName: "提灯修士",
            message: "只对你说。",
          },
        ],
      },
      {
        actions: [
          {
            kind: "whisper",
            mind: "这句只给他听。",
            targetActorName: "提灯修士",
            message: "别回头。",
          },
        ],
      },
      {
        actions: [attackAction("提灯修士")],
      },
    ]);
    const announced = await runNpcTurn(handle.db, game.game.slug, "守烬人", { service });
    expect(announced.ok).toBe(true);
    const targeted = await runNpcTurn(handle.db, game.game.slug, "守烬人", { service });
    expect(targeted.ok).toBe(true);
    const whispered = await runNpcTurn(handle.db, game.game.slug, "守烬人", { service });
    expect(whispered.ok).toBe(true);
    const attacked = await runNpcTurn(handle.db, game.game.slug, "守烬人", { service });
    expect(attacked.ok).toBe(true);

    const memories = await getGameMemories(handle.db, game.game.id);
    const observer = memories.find((memory) => memory.name === "旁听者");
    const monk = memories.find((memory) => memory.name === "提灯修士");
    const scribe = memories.find((memory) => memory.name === "缄默抄经人");
    expect(
      observer?.messages.some((message) =>
        message.content.includes("守烬人公开说（场景：灰烬门廊）：灰里有人。"),
      ),
    ).toBe(true);
    expect(
      observer?.messages.some((message) =>
        message.content.includes("守烬人对提灯修士说（场景：灰烬门廊）：只对你说。"),
      ),
    ).toBe(true);
    expect(observer?.messages.some((message) => message.content.includes("别回头"))).toBe(false);
    expect(
      monk?.messages.some((message) =>
        message.content.includes("守烬人对你说（场景：灰烬门廊）：只对你说。"),
      ),
    ).toBe(true);
    expect(
      monk?.messages.some((message) =>
        message.content.includes("守烬人对你耳语（场景：灰烬门廊）：别回头。"),
      ),
    ).toBe(true);
    expect(
      observer?.messages.some((message) => message.content.includes("守烬人对提灯修士使用攻击")),
    ).toBe(true);
    expect(
      scribe?.messages.some((message) => message.content.includes("守烬人对提灯修士使用攻击")),
    ).toBe(false);
  });
});
