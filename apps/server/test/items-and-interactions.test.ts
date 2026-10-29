import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_USER } from "../src/db/demo-fixture";
import type { World } from "../src/game/types";
import { TEST_WORLD } from "./test-world";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getGameMemories,
  getGameState,
  playerBrawl,
  playerGive,
  playerMove,
  playerPickup,
  playerSteal,
  playerStrike,
  playerUnequip,
  playerUse,
  runNpcTurn,
  takeActorControl,
} from "../src/game";
import {
  ChatCompletionResult,
  type ChatCompletionService,
  ChatError,
  type ToolCall,
} from "../src/llm";

class AffixDamageService implements ChatCompletionService {
  calls = 0;
  input = "";
  recordEffect = true;

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.calls += 1;
    this.input = request.inputMessage;
    const toolCalls: ToolCall[] = [
      {
        id: randomUUID(),
        type: "function" as const,
        function: {
          name: "damage_target",
          arguments: JSON.stringify({
            targetActorHandle: "提灯修士",
            amount: 42,
            reason: "测试用词缀伤害",
          }),
        },
      },
    ];
    if (this.recordEffect) {
      toolCalls.push({
        id: randomUUID(),
        type: "function" as const,
        function: {
          name: "record_effect",
          arguments: JSON.stringify({
            targetActorHandle: "提灯修士",
            experience: TORCH_EXPERIENCE,
            witnessText: TORCH_WITNESS,
          }),
        },
      });
    }
    toolCalls.push({
      id: randomUUID(),
      type: "function" as const,
      function: { name: "submit_affix", arguments: "{}" },
    });
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: "tool_calls",
      toolCalls,
    });
  }
}

const TORCH_EXPERIENCE = "火焰卷上你的毛根，皮肉在油脂里噼啪作响，焦糊味钻进鼻腔。";
const TORCH_WITNESS = "提灯修士的毛皮被火燎得卷曲发黑，空气里浮着焦毛味。";

/** 只记录可见后果，不追加伤害：验证故事效果能独立于数值发生。 */
class AffixEffectService implements ChatCompletionService {
  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    return toolCallResult(request, [
      {
        name: "record_effect",
        args: {
          targetActorHandle: "提灯修士",
          experience: TORCH_EXPERIENCE,
          witnessText: TORCH_WITNESS,
        },
      },
      { name: "submit_affix", args: {} },
    ]);
  }
}

/** 一次吐出三条后果：验证上限只落两条。 */
class OverLimitEffectService implements ChatCompletionService {
  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    const record = (text: string) => ({
      name: "record_effect",
      args: { targetActorHandle: "提灯修士", experience: text, witnessText: text },
    });
    return toolCallResult(request, [
      record("火焰卷上你的一号毛根。"),
      record("火焰卷上你的二号毛根。"),
      record("火焰卷上你的三号毛根。"),
      { name: "submit_affix", args: {} },
    ]);
  }
}

/** 会读记忆的外观/掉落 service：把收到的上下文留下来供断言。 */
class CapturingDeathService implements ChatCompletionService {
  seen = "";

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.seen += `${request.messages.map((message) => message.content).join("\n")}\n`;
    const tool = request.tools[0]?.function.name;
    return toolCallResult(request, [
      tool === "drop_materials"
        ? { name: "drop_materials", args: { items: [] } }
        : { name: "submit_appearance", args: { appearance: "被火燎过的尸体，毛皮焦黑卷曲。" } },
    ]);
  }
}

function toolCallResult(
  request: Parameters<ChatCompletionService["complete"]>[0],
  calls: { name: string; args: Record<string, unknown> }[],
) {
  const toolCalls: ToolCall[] = calls.map((call) => ({
    id: randomUUID(),
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.args) },
  }));
  return new ChatCompletionResult({
    request,
    aiMessage: { type: "ai", content: "", toolCalls },
    finishReason: "tool_calls",
    toolCalls,
  });
}

/** 只记录本轮装配了哪些工具，然后交一份空转计划。 */
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

/** 每次请求都返回 provider 错误：模拟网络失败 / 超时。 */
class ErrorCompletionService implements ChatCompletionService {
  calls = 0;

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.calls += 1;
    return new ChatCompletionResult({
      request,
      error: new ChatError(request.label, "模拟网络失败", { kind: "connection" }),
    });
  }
}

/** 直接抛异常：模拟缺少 API key 之类的配置/意外错误。 */
class ThrowingService implements ChatCompletionService {
  async complete(): Promise<ChatCompletionResult> {
    throw new Error("模拟缺少 API key");
  }
}

const SEALED_STAGE_NAME = "场景.封印门";
const SEALED_KEY_NAME = "饰品.测试钥匙";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

const ITEM_WORLD = {
  ...TEST_WORLD,
  stages: TEST_WORLD.stages.map((stage) =>
    stage.key === "gate"
      ? {
          ...stage,
          items: [
            {
              key: "test-torch",
              name: "武器.测试火把",
              description: "测试用的场景武器。",
              kind: "weapon" as const,
              count: 1,
              stats: { damage: 7, block: 1 },
              effect: { type: "damage" },
            },
          ],
        }
      : stage,
  ),
};

const GATE_STAGE = TEST_WORLD.stages.find((stage) => stage.key === "gate");
const KEEPER_ACTOR = TEST_WORLD.actors.find((actor) => actor.name === "守烬人");
if (!GATE_STAGE || !KEEPER_ACTOR) {
  throw new Error("测试世界缺少灰烬门廊或守烬人");
}

const WEAPON_WORLD = {
  ...TEST_WORLD,
  actors: TEST_WORLD.actors.map((actor) =>
    actor.name === "提灯修士"
      ? {
          ...actor,
          equipment: { armor: "铅封提灯" },
          items: actor.items.map((item) =>
            item.name === "铅封提灯" ? { ...item, stats: { ...item.stats, block: 2 } } : item,
          ),
        }
      : actor,
  ),
};

const AFFIX_WORLD = {
  ...TEST_WORLD,
  actors: TEST_WORLD.actors.map((actor) =>
    actor.name === "守烬人"
      ? {
          ...actor,
          items: actor.items.map((item) =>
            item.name === "裂齿短刃"
              ? {
                  ...item,
                  affixes: [
                    {
                      name: "松脂渗毛",
                      content:
                        "火焰顺着毛根渗进去：对多毛类生物额外造成武器伤害的一百倍，毛越厚烧得越透",
                    },
                  ],
                }
              : item,
          ),
        }
      : actor,
  ),
};

/** 基础伤害就能打死目标：词缀判定仍会发生，但落账必须是 no-op。 */
const AFFIX_DEADLY_WORLD = {
  ...AFFIX_WORLD,
  actors: AFFIX_WORLD.actors.map((actor) =>
    actor.name === "提灯修士" ? { ...actor, hp: 5 } : actor,
  ),
};

const ARMORED_MONK_WORLD = {
  ...ITEM_WORLD,
  actors: ITEM_WORLD.actors.map((actor) =>
    actor.name === "提灯修士" ? { ...actor, equipment: { armor: "铅封提灯" } } : actor,
  ),
};

const CORPSE_WORLD = {
  ...ARMORED_MONK_WORLD,
  actors: ARMORED_MONK_WORLD.actors.map((actor) =>
    actor.name === "提灯修士" ? { ...actor, hp: 0, status: "dead" as const } : actor,
  ),
};

const SEALED_WORLD: World = {
  ...TEST_WORLD,
  stages: [
    GATE_STAGE,
    {
      key: "sealed-gate",
      name: SEALED_STAGE_NAME,
      profile: "测试用铁闸门。",
      actions: ["submit_environment"] as const,
      environment: "门板上刻着鼠牙。",
    },
  ],
  connections: [
    { from: "gate", to: "sealed-gate" },
    { from: "sealed-gate", to: "gate" },
  ],
  knownIdentities: [],
  actors: [
    {
      ...KEEPER_ACTOR,
      stageKey: "gate",
      items: [
        {
          key: "sealed-key",
          name: SEALED_KEY_NAME,
          description: "测试用闸门钥匙。",
          kind: "accessory" as const,
          effect: { type: "event" },
        },
      ],
    },
  ],
};

describe.skipIf(!testDatabaseUrl)("items and interactions", () => {
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

  it("steals a backpack item from a living actor privately and leaves an observer unaware", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "窃取测试局",
      world: ITEM_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const stolen = await playerSteal(handle.db, created.game.slug, "守烬人", {
      targetActorRef: "提灯修士",
      itemName: "铅封提灯",
    });
    expect(stolen.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.messages.at(-1)?.kind).toBe("steal");
    expect(state.messages.at(-1)?.visibility).toBe("private");
    const keeper = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人");
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(keeper?.items.map((item) => item.name)).toContain("铅封提灯");
    expect(monk?.items.map((item) => item.name)).not.toContain("铅封提灯");

    const memories = await getGameMemories(handle.db, created.game.id);
    const monkMemory = memories.find((memory) => memory.name === "提灯修士");
    const observerMemory = memories.find((memory) => memory.name === "缄默抄经人");
    expect(monkMemory?.messages.some((message) => message.content.includes("你被窃取"))).toBe(true);
    expect(observerMemory?.messages.some((message) => message.content.includes("取走了"))).toBe(
      false,
    );
  });

  it("refuses to take a worn item from a living actor", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "活人窃取测试局",
      world: ARMORED_MONK_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    await expect(
      playerSteal(handle.db, created.game.slug, "守烬人", {
        targetActorRef: "提灯修士",
        itemName: "铅封提灯",
      }),
    ).rejects.toThrow("拿不走已装备的物品");
  });

  it("takes a worn item from a corpse and clears the corpse's slot", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "尸体取物测试局",
      world: CORPSE_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const stolen = await playerSteal(handle.db, created.game.slug, "守烬人", {
      targetActorRef: "提灯修士",
      itemName: "铅封提灯",
    });
    expect(stolen.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const actors = state.world.stages.flatMap((stage) => stage.actors);
    expect(
      actors.find((actor) => actor.name === "守烬人")?.items.map((item) => item.name),
    ).toContain("铅封提灯");
    expect(actors.find((actor) => actor.name === "提灯修士")?.equipment.armor).toBeUndefined();
  });

  it("rejects steal for an actor whose actions do not include it", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "权限测试局",
      world: ITEM_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "提灯修士");

    await expect(
      playerSteal(handle.db, created.game.slug, "提灯修士", {
        targetActorRef: "守烬人",
        itemName: "裂齿短刃",
      }),
    ).rejects.toThrow("不能使用动作: steal");
  });

  it("拒绝使用正被穿戴的物品", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "使用穿戴中物品测试局",
      world: WEAPON_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    // 裂齿短刃在武器槽里：它归 strike 或被动装备，不能当道具使用。
    await expect(
      playerUse(handle.db, created.game.slug, "守烬人", {
        itemName: "裂齿短刃",
        targetActorRef: "提灯修士",
      }),
    ).rejects.toThrow("正装备在武器槽，先卸下再使用");
  });

  it("卸下武器后可以把它当道具使用", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "使用卸下武器测试局",
      world: WEAPON_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    await playerUnequip(handle.db, created.game.slug, "守烬人", { slot: "weapon" });

    const used = await playerUse(handle.db, created.game.slug, "守烬人", {
      itemName: "裂齿短刃",
      targetActorRef: "提灯修士",
    });
    expect(used.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    // 同一个伤害公式：6 + 3 - 3（防御）- 2（提灯 block）= 4。
    expect(monk?.hp).toBe(6);
    expect(state.messages.at(-1)?.kind).toBe("use");
  });

  it("routes affixed damage through LLM and applies the computed damage", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "词缀伤害测试局",
      world: AFFIX_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const service = new AffixDamageService();
    const attacked = await playerStrike(
      handle.db,
      created.game.slug,
      "守烬人",
      { targetActorRef: "提灯修士" },
      { service },
    );
    expect(attacked.ok).toBe(true);
    expect(service.calls).toBe(1);
    expect(service.input).toContain("[松脂渗毛]火焰顺着毛根渗进去");
    expect(service.input).toContain("对多毛类生物额外造成武器伤害的一百倍");
    expect(service.input).toContain("种族：人类");
    expect(service.input).toContain("外观：中等身量，右手虎口有一圈烫疤，指节被灯烟熏黄。");

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk?.hp).toBe(0);
    // 死亡广播会追加一条 kind=death 的消息，所以按攻击消息取最近两条。
    const recent = state.messages
      .filter((message) => message.kind === "strike")
      .slice(-2)
      .map((message) => message.content);
    expect(recent[0]).toContain("造成6点伤害");
    // 增量单独成句，不冒充实算端的伤害。
    expect(recent[1]).toContain("词缀追加42点伤害");

    // 出手者的长期记忆里也要看得到这条增量。
    const memories = await getGameMemories(handle.db, created.game.id);
    const keeper = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人");
    const keeperMemory = memories.find(
      (memory) => memory.ownerType === "actor" && memory.ownerId === keeper?.id,
    );
    expect(
      keeperMemory?.messages.some((message) => message.content.includes("词缀追加42点伤害")),
    ).toBe(true);
  });

  it("writes the affix's visible consequence into the target and the stage memory", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "词缀后果记忆测试局",
      world: AFFIX_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const attacked = await playerStrike(
      handle.db,
      created.game.slug,
      "守烬人",
      { targetActorRef: "提灯修士" },
      { service: new AffixEffectService() },
    );
    expect(attacked.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    const stage = state.world.stages.find((candidate) =>
      candidate.actors.some((actor) => actor.id === monk?.id),
    );
    const memories = await getGameMemories(handle.db, created.game.id);
    const monkMemory = memories.find(
      (memory) => memory.ownerType === "actor" && memory.ownerId === monk?.id,
    );
    const stageMemory = memories.find(
      (memory) => memory.ownerType === "stage" && memory.ownerId === stage?.id,
    );

    // 第二人称写进目标记忆，第三人称写进舞台记忆。
    expect(monkMemory?.messages.some((message) => message.content === TORCH_EXPERIENCE)).toBe(true);
    expect(stageMemory?.messages.some((message) => message.content.includes(TORCH_WITNESS))).toBe(
      true,
    );
    // 只有后果、没有追加伤害：计算端的 6 点照常成立。
    expect(monk?.hp).toBe(4);
  });

  it("caps recorded affix consequences at two per execution", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "词缀后果上限测试局",
      world: AFFIX_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const attacked = await playerStrike(
      handle.db,
      created.game.slug,
      "守烬人",
      { targetActorRef: "提灯修士" },
      { service: new OverLimitEffectService() },
    );
    expect(attacked.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    const memories = await getGameMemories(handle.db, created.game.id);
    const monkMemory = memories.find(
      (memory) => memory.ownerType === "actor" && memory.ownerId === monk?.id,
    );
    const recorded = monkMemory?.messages.filter((message) =>
      message.content.includes("火焰卷上你的"),
    );
    expect(recorded).toHaveLength(2);
  });

  it("lets the death appearance read the affix consequence from memory", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "词缀后果外观测试局",
      world: AFFIX_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const deathService = new CapturingDeathService();
    const attacked = await playerStrike(
      handle.db,
      created.game.slug,
      "守烬人",
      { targetActorRef: "提灯修士" },
      {
        service: new AffixDamageService(),
        appearanceService: deathService,
      },
    );
    expect(attacked.ok).toBe(true);

    // 外观阶段拿到的是目标的长期记忆，里面必须能看到词缀后果。
    expect(deathService.seen).toContain("火焰卷上你的毛根");
    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk?.appearance).toBe("被火燎过的尸体，毛皮焦黑卷曲。");
  });

  it("treats the affix as a no-op when the computed damage already killed the target", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "词缀致死测试局",
      world: AFFIX_DEADLY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const service = new AffixDamageService();
    const attacked = await playerStrike(
      handle.db,
      created.game.slug,
      "守烬人",
      { targetActorRef: "提灯修士" },
      { service },
    );
    expect(attacked.ok).toBe(true);
    // 判定照常发生（LLM 仍可能改打别人），只是目标已经倒下，落账跳过。
    expect(service.calls).toBe(1);

    const state = await getGameState(handle.db, created.game.slug);
    const strikeMessages = state.messages
      .filter((message) => message.kind === "strike")
      .map((message) => message.content);
    expect(strikeMessages).toHaveLength(1);
    expect(strikeMessages[0]).toContain("造成6点伤害");
    expect(strikeMessages.some((content) => content.includes("词缀追加"))).toBe(false);
  });

  it("keeps the computed damage when the affix LLM request fails", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "词缀请求失败测试局",
      world: AFFIX_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const service = new ErrorCompletionService();
    const attacked = await playerStrike(
      handle.db,
      created.game.slug,
      "守烬人",
      { targetActorRef: "提灯修士" },
      { service },
    );
    expect(attacked.ok).toBe(true);
    // 两轮都失败后放弃增量，不重试到回合外。
    expect(service.calls).toBe(2);

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    // 只结算计算端的 6 点，词缀的 42 点没有发生。
    expect(monk?.hp).toBe(4);
    const strikeMessages = state.messages
      .filter((message) => message.kind === "strike")
      .map((message) => message.content);
    expect(strikeMessages.at(-1)).toContain("造成6点伤害");
    expect(strikeMessages.some((content) => content.includes("造成42点伤害"))).toBe(false);
  });

  it("keeps the computed damage when the affix service throws", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "词缀抛异常测试局",
      world: AFFIX_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    // 词缀阶段抛异常不能冒泡成行动失败。
    const attacked = await playerStrike(
      handle.db,
      created.game.slug,
      "守烬人",
      { targetActorRef: "提灯修士" },
      { service: new ThrowingService() },
    );
    expect(attacked.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk?.hp).toBe(4);
  });

  it("keeps the computed damage when no LLM service is configured", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "词缀缺 service 测试局",
      world: AFFIX_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    // 未配置推理端：跳过增量，而不是拒绝整个行动。
    const attacked = await playerStrike(handle.db, created.game.slug, "守烬人", {
      targetActorRef: "提灯修士",
    });
    expect(attacked.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk?.hp).toBe(4);
  });

  it("adds equipped weapon damage and lets the target's equipped block reduce it", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "武器伤害测试局",
      world: WEAPON_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const attacked = await playerStrike(handle.db, created.game.slug, "守烬人", {
      targetActorRef: "提灯修士",
    });
    expect(attacked.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    // 6（守烬人自身 damage）+ 3（装备武器的 damage，裂齿短刃已装备）- 3（修士 block）- 2（铅封提灯 block）= 4
    expect(monk?.hp).toBe(6);
    expect(state.messages.at(-1)?.content).toContain("造成4点伤害");
  });

  it("brawls with body stats only and ignores the equipped weapon", async () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人" ? { ...actor, equipment: {} } : actor,
      ),
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "肉搏测试局",
      world,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    // 没有装备武器也能肉搏：6（自身 damage）- 3（修士 block）= 3。
    const brawled = await playerBrawl(handle.db, created.game.slug, "守烬人", {
      targetActorRef: "提灯修士",
    });
    expect(brawled.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk?.hp).toBe(7);
    expect(state.messages.at(-1)?.kind).toBe("brawl");
    // 公共消息是上帝视角：双方都用规范名，结局不混入观察者相对的指代。
    expect(state.messages.at(-1)?.content).toBe(
      "守烬人对提灯修士肉搏，造成3点伤害；提灯修士剩余 HP 7/10。",
    );
  });

  it("does not read weapon stats or affixes when brawling", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "肉搏不吃词缀测试局",
      world: AFFIX_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const service = new AffixDamageService();
    const brawled = await playerBrawl(
      handle.db,
      created.game.slug,
      "守烬人",
      { targetActorRef: "提灯修士" },
      { service },
    );
    expect(brawled.ok).toBe(true);
    // 词缀挂在武器上，肉搏没有物品可挂，LLM 一次都不该被调用。
    expect(service.calls).toBe(0);

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    // 6（自身 damage）- 3（修士 block）= 3；武器伤害与词缀都不参与。
    expect(monk?.hp).toBe(7);
  });

  it("rejects brawl for an actor whose actions do not include it", async () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人"
          ? { ...actor, actions: actor.actions.filter((kind) => kind !== "brawl") }
          : actor,
      ),
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "无肉搏能力测试局",
      world,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    await expect(
      playerBrawl(handle.db, created.game.slug, "守烬人", { targetActorRef: "提灯修士" }),
    ).rejects.toThrow("不能使用动作: brawl");
  });

  it("rejects strike when the weapon slot is empty", async () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人" ? { ...actor, equipment: {} } : actor,
      ),
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "无武器挥击测试局",
      world,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    // 没有空手分支：武器槽为空就是错误，背包里的裂齿短刃不会顶替。
    await expect(
      playerStrike(handle.db, created.game.slug, "守烬人", { targetActorRef: "提灯修士" }),
    ).rejects.toThrow("不能使用动作: strike");

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk?.hp).toBe(10);
  });

  it("rejects strike when the equipped weapon does not provide it", async () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人"
          ? {
              ...actor,
              items: actor.items.map((item) => ({ ...item, actions: [] })),
            }
          : actor,
      ),
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "无挥击武器测试局",
      world,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    // 装备着武器，但武器没声明 strike：同样拒绝，不静默降级。
    await expect(
      playerStrike(handle.db, created.game.slug, "守烬人", { targetActorRef: "提灯修士" }),
    ).rejects.toThrow("不能使用动作: strike");
  });

  it("only exposes strike when the weapon provides it", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "挥击工具装配测试局",
      world: TEST_WORLD,
    });
    const capture = new ToolCaptureService();
    await runNpcTurn(handle.db, created.game.slug, "守烬人", { service: capture });
    expect(capture.tools).toContain("strike");

    const unarmed = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "无武器工具装配测试局",
      world: {
        ...TEST_WORLD,
        actors: TEST_WORLD.actors.map((actor) =>
          actor.name === "守烬人" ? { ...actor, equipment: {} } : actor,
        ),
      },
    });
    const bareCapture = new ToolCaptureService();
    await runNpcTurn(handle.db, unarmed.game.slug, "守烬人", { service: bareCapture });
    expect(bareCapture.tools).not.toContain("strike");
    // 固有动作不受影响，只有武器提供的动作消失。
    expect(bareCapture.tools).toContain("say");
  });

  it("gives an owned item to a living actor in the same stage", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "给予测试局",
      world: ITEM_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const given = await playerGive(handle.db, created.game.slug, "守烬人", {
      targetActorRef: "提灯修士",
      itemName: "裂齿短刃",
    });
    expect(given.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk?.items.map((item) => item.name)).toContain("裂齿短刃");
    expect(state.messages.at(-1)?.kind).toBe("give");

    const memories = await getGameMemories(handle.db, created.game.id);
    const monkMemory = memories.find((memory) => memory.name === "提灯修士");
    expect(monkMemory?.messages.some((message) => message.content.includes("你收到物品"))).toBe(
      true,
    );
  });

  it("picks up a stage item into the actor inventory", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "拾取测试局",
      world: ITEM_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const picked = await playerPickup(handle.db, created.game.slug, "守烬人", {
      itemName: "武器.测试火把",
    });
    expect(picked.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const gate = state.world.stages.find((stage) => stage.name === "灰烬门廊");
    const keeper = gate?.actors.find((actor) => actor.name === "守烬人");
    expect(gate?.items).toEqual([]);
    const torch = keeper?.items.find((item) => item.name === "武器.测试火把");
    expect(torch).toMatchObject({
      key: "test-torch",
      count: 1,
      stats: { damage: 7, block: 1 },
    });
  });

  it("records where an item was used on a stage without completing the game", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场景使用描述测试局",
      world: SEALED_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    await playerMove(handle.db, created.game.slug, "守烬人", {
      targetStageRef: SEALED_STAGE_NAME,
    });

    const used = await playerUse(handle.db, created.game.slug, "守烬人", {
      targetStageName: SEALED_STAGE_NAME,
      itemName: SEALED_KEY_NAME,
      targetDetail: "锁孔",
    });
    expect(used.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.game.status).toBe("active");
    expect(state.messages.at(-1)?.content).toContain("的锁孔");
    expect(state.messages.some((message) => message.kind === "game_completed")).toBe(false);

    const memories = await getGameMemories(handle.db, created.game.id);
    const stageMemory = memories.find((memory) => memory.name === SEALED_STAGE_NAME);
    expect(stageMemory?.messages.some((message) => message.content.includes("的锁孔"))).toBe(true);
  });
});
