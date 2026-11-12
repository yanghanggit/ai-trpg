import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_USER } from "../src/db/demo-fixture";
import {
  type ActorPlan,
  createGame,
  getGameMemories,
  getGameState,
  runActorTurn,
  settleActorPlan,
} from "../src/game";
import { formatForm } from "../src/game/agents/appearance/form";
import type { World } from "../src/game/world-definition";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";
import { TEST_WORLD } from "./test-world";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

const KEEPER = TEST_WORLD.actors.find((actor) => actor.name === "守烬人");
const MONK = TEST_WORLD.actors.find((actor) => actor.name === "提灯修士");
const SCRIBE = TEST_WORLD.actors.find((actor) => actor.name === "缄默抄经人");
if (!KEEPER || !MONK || !SCRIBE) {
  throw new Error("测试世界缺少守烬人 / 提灯修士 / 缄默抄经人");
}

/**
 * 横扫的测试世界：把三个角色放进同一个舞台，并让守烬人的短刃同时提供
 * `strike` 与 `cleave`，`maxTargets: 2`。
 *
 * 共享的 `TEST_WORLD` 保持单一挥击不变——生产内容里目前也没有任何武器声明
 * `cleave`，这个动作还没有接线到玩法上。
 */
const CLEAVE_WORLD: World = {
  ...TEST_WORLD,
  contentKey: "test-world-cleave",
  worldName: "灰烬测试局（横扫）",
  signatureNames: [
    ...(TEST_WORLD.signatureNames ?? []),
    { observer: "ember-keeper", subject: "lamp-bearer", name: "执灯人" },
  ],
  actors: [
    {
      ...KEEPER,
      inventory: KEEPER.inventory.map((item) =>
        item.key === "cracked-blade"
          ? {
              ...item,
              maxTargets: 2,
              actions: ["strike", "cleave"] as const,
              // 横扫自带一套词缀；与 `affixes.strike` 各自独立。
              affixes: {
                ...item.affixes,
                cleave: [
                  {
                    name: "横扫",
                    content: "刀锋横过，造成 {{attack}} 点伤害",
                    ops: [{ kind: "damage" as const, amount: { ref: "attack" as const } }],
                  },
                ],
              },
            }
          : item,
      ),
    },
    MONK,
    { ...SCRIBE, stageKey: "gate" },
    {
      stageKey: "gate",
      key: "lamp-bearer",
      name: "执灯人",
      profile: "一个替守夜人举灯的少年。",
      signature: {
        form: formatForm("人类", "瘦小，左耳缺了一角。"),
        appearance: "袖口烧出许多小洞。",
      },
      hp: 6,
      stats: { maxHp: 6, strength: 2, wisdom: 2, agility: 5, damage: 0, block: 0 },
      actions: ["say", "wait"],
      inventory: [],
    },
  ],
};

/** 横扫的推理端：只给缄默抄经人追加 3 点，验证目标是从名单里挑的。 */
class CleaveAffixService implements ChatCompletionService {
  static calls = 0;
  static input = "";

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    CleaveAffixService.calls += 1;
    CleaveAffixService.input = request.inputMessage;
    const toolCalls: ToolCall[] = [
      {
        id: randomUUID(),
        type: "function" as const,
        function: {
          name: "damage_target",
          arguments: JSON.stringify({
            affixName: "扫断膝盖",
            targetActorHandle: "缄默抄经人",
            amount: 3,
            reason: "站不稳摔了一下",
          }),
        },
      },
      {
        id: randomUUID(),
        type: "function" as const,
        function: { name: "submit_affix", arguments: "{}" },
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

describe.skipIf(!testDatabaseUrl)("cleave", () => {
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

  const cleavePlan = (...targetActorHandles: string[]): ActorPlan => ({
    actions: [{ kind: "cleave", targetActorHandles }],
  });

  const startGame = async (world: World, name: string) => {
    const created = await createGame(handle.db, { username: DEMO_USER.username, name, world });
    const keeper = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人");
    return { created, keeperId: keeper?.id as string };
  };

  const stateOf = (slug: string) => getGameState(handle.db, slug);
  const hpOf = (state: Awaited<ReturnType<typeof stateOf>>, name: string) =>
    state.world.stages.flatMap((stage) => stage.actors).find((actor) => actor.name === name)?.hp;

  it("hands every target to the reasoning phase, each with its own static result", async () => {
    const world: World = {
      ...CLEAVE_WORLD,
      contentKey: "test-world-cleave-agent",
      worldName: "灰烬测试局（横扫推理词缀）",
      actors: CLEAVE_WORLD.actors.map((actor) =>
        actor.key === "ember-keeper"
          ? {
              ...actor,
              inventory: actor.inventory.map((item) =>
                item.key === "cracked-blade"
                  ? {
                      ...item,
                      affixes: {
                        ...item.affixes,
                        cleave: [
                          ...(item.affixes?.cleave ?? []),
                          {
                            name: "扫断膝盖",
                            mode: "agent" as const,
                            content: "被扫中的人只要腿上有伤，这一下就站不稳。",
                          },
                        ],
                      },
                    }
                  : item,
              ),
            }
          : actor,
      ),
    };
    const { created, keeperId } = await startGame(world, "横扫推理词缀测试局");

    const result = await settleActorPlan(
      handle.db,
      created.game.id,
      keeperId,
      cleavePlan("提灯修士", "缄默抄经人"),
      true,
      { service: new CleaveAffixService() },
    );
    expect(result.ok).toBe(true);

    const state = await stateOf(created.game.slug);
    // 名单里的每个人都带自己的静态实际结果，推理端按角色追加。
    expect(CleaveAffixService.input).toContain("- 提灯修士｜");
    expect(CleaveAffixService.input).toContain("- 缄默抄经人｜");
    expect(CleaveAffixService.input).toMatch(/- 缄默抄经人｜.*静态实际造成伤害：\d+/);
    // 追加只落在被点名的那个人身上，且是独立的一次写入。
    expect(CleaveAffixService.calls).toBe(1);
    const scribe = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "缄默抄经人");
    const appended = state.messages.filter((message) =>
      message.content.includes("词缀追加3点伤害"),
    );
    expect(appended).toHaveLength(1);
    expect(appended[0]?.targetActorId).toBe(scribe?.id);
    expect(appended[0]?.kind).toBe("cleave");
  });

  it("hits every listed target once and settles each one separately", async () => {
    const { created, keeperId } = await startGame(CLEAVE_WORLD, "横扫多目标测试局");
    const before = await stateOf(created.game.slug);

    const result = await settleActorPlan(
      handle.db,
      created.game.id,
      keeperId,
      cleavePlan("提灯修士", "缄默抄经人"),
      true,
    );
    expect(result.ok).toBe(true);

    const state = await stateOf(created.game.slug);
    // 一个动作、两个目标：各自一条公共事件；kind 跟着动作走，文案是「顺劈」。
    const events = state.messages.filter((message) => message.kind === "cleave");
    expect(events).toHaveLength(2);
    expect(events.every((message) => message.content.includes("顺劈"))).toBe(true);
    expect(new Set(events.map((message) => message.targetActorId)).size).toBe(2);
    // 每个目标各自减一次 block，不是把总伤害摊在一个目标上。
    expect(hpOf(state, "提灯修士")).toBeLessThan(hpOf(before, "提灯修士") ?? 0);
    expect(hpOf(state, "缄默抄经人")).toBeLessThan(hpOf(before, "缄默抄经人") ?? 0);
    // 一次横扫是一次行动：版本只推一格，不是每个目标各推一次。
    expect(state.game.version).toBe(before.game.version + 1);

    // 记忆里也只有一个标题：两个目标的句子并排在同一条行动事实里。
    const memories = await getGameMemories(handle.db, created.game.id);
    const feedback =
      memories
        .find((memory) => memory.name === "守烬人")
        ?.messages.map((message) => message.content)
        .find((content) => content.startsWith("# 行动结果")) ?? "";
    expect(feedback.match(/# 行动结果/g)).toHaveLength(1);
    expect(feedback.split("\n").filter((line) => line.includes("顺劈"))).toHaveLength(2);
  });

  it("adds strength to every target's own hit, 1v1 each", async () => {
    const strongWorld: World = {
      ...CLEAVE_WORLD,
      actors: CLEAVE_WORLD.actors.map((actor) =>
        actor.name === "守烬人" ? { ...actor, stats: { ...actor.stats, strength: 9 } } : actor,
      ),
    };
    const { created, keeperId } = await startGame(strongWorld, "横扫力量加成测试局");

    const result = await settleActorPlan(
      handle.db,
      created.game.id,
      keeperId,
      cleavePlan("提灯修士", "缄默抄经人"),
      true,
    );
    expect(result.ok).toBe(true);

    const state = await stateOf(created.game.slug);
    // 每个目标按自己的 1v1 结算：力量 9（本体 6 + 这次加成 3）+ 武器终值 3 = 12，各减自己的装备格挡。
    expect(hpOf(state, "提灯修士")).toBe(1);
    expect(hpOf(state, "缄默抄经人")).toBe(1);
  });

  it("rejects more targets than the weapon allows", async () => {
    const { created, keeperId } = await startGame(CLEAVE_WORLD, "横扫目标数上限测试局");

    const result = await settleActorPlan(
      handle.db,
      created.game.id,
      keeperId,
      cleavePlan("提灯修士", "缄默抄经人", "执灯人"),
      true,
    );
    expect(result.ok).toBe(false);
    expect(result.rejection).toContain("一次最多横扫 2 个目标，实际给了 3 个");

    // 整份计划被拒：一条消息都不落地，版本号也不动。
    const state = await stateOf(created.game.slug);
    expect(state.messages).toEqual([]);
    expect(state.game.version).toBe(0);
  });

  it("rejects a target list that repeats the same actor", async () => {
    const { created, keeperId } = await startGame(CLEAVE_WORLD, "横扫重复目标测试局");

    const result = await settleActorPlan(
      handle.db,
      created.game.id,
      keeperId,
      cleavePlan("提灯修士", "提灯修士"),
      true,
    );
    expect(result.ok).toBe(false);
    expect(result.rejection).toContain("cleave 的目标不能重复");
  });

  it("refuses to cleave with a weapon that does not provide it", async () => {
    const { created, keeperId } = await startGame(TEST_WORLD, "横扫未授权测试局");

    // 原样的裂齿短刃只提供 strike：cleave 不在可用动作里，解析前就被拒。
    const result = await settleActorPlan(
      handle.db,
      created.game.id,
      keeperId,
      cleavePlan("提灯修士"),
      true,
    );
    expect(result.ok).toBe(false);
    expect(result.rejection).toContain("不能使用动作: cleave");
  });

  it("offers the cleave tool with the weapon's target cap, and only when armed with it", async () => {
    const armed = await startGame(CLEAVE_WORLD, "横扫工具装配测试局");
    const armedService = new ToolCaptureService();
    await runActorTurn(handle.db, armed.created.game.slug, "守烬人", { service: armedService });
    const cleaveTool = armedService.tools.find((tool) => tool.function.name === "cleave");
    expect(cleaveTool).toBeDefined();
    if (!cleaveTool) {
      throw new Error("持有 cleave 武器的角色应当拿到 cleave 工具");
    }
    // 形状里的 maxItems 来自武器：模型看得到上限，结算端还会再验一次。
    expect(cleaveTool.function.parameters.properties).toMatchObject({
      targets: { type: "array", minItems: 1, maxItems: 2 },
    });

    const unarmed = await startGame(TEST_WORLD, "横扫工具缺失测试局");
    const unarmedService = new ToolCaptureService();
    await runActorTurn(handle.db, unarmed.created.game.slug, "守烬人", { service: unarmedService });
    expect(unarmedService.tools.map((tool) => tool.function.name)).not.toContain("cleave");
    expect(unarmedService.tools.map((tool) => tool.function.name)).toContain("strike");
  });
});

/** 只记录本次请求暴露了哪些工具，然后提交一个 wait。 */
class ToolCaptureService implements ChatCompletionService {
  tools: readonly import("../src/llm").ToolDefinition[] = [];

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.tools = request.tools ?? [];
    const toolCalls: ToolCall[] = [
      { id: randomUUID(), type: "function", function: { name: "wait", arguments: "{}" } },
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
