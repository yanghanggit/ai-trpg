import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BELL_MONASTERY_WORLD, CROW_GRAVE_WORLD } from "../seeds/dark-fantasy";
import { DEMO_USER } from "../src/db/demo-fixture";
import { allowedActionKinds } from "../src/game/actions";
import {
  type ActionGrant,
  carriedActionCap,
  carriedActions,
  equippedItemActions,
  toItemState,
} from "../src/game/items";
import { actorInnateActions } from "../src/game/world-definition";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";
import { TEST_WORLD } from "./test-world";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { createGame, runNpcTurn } from "../src/game";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

const blade = (overrides: Partial<Parameters<typeof toItemState>[0]> = {}) =>
  toItemState({
    id: "item-blade",
    seq: 1,
    key: "cracked-blade",
    name: "裂齿短刃",
    description: "刃口崩了三处。",
    kind: "weapon",
    count: 1,
    stats: { maxHp: 0, strength: 0, wisdom: 0, agility: 0, damage: 3, block: 0 },
    actions: ["strike", "cleave"],
    maxTargets: 2,
    ...overrides,
  });

describe("action sources", () => {
  it("merges skill actions into the innate list once", () => {
    const actor = {
      actions: ["say", "wait"] as const,
      proficiencies: [
        { key: "a", name: "甲", description: "一。", actions: ["inspect", "steal"] as const },
        { key: "b", name: "乙", description: "二。", actions: ["steal", "give"] as const },
      ],
    };
    // 内容校验会拒绝重复来源；物化这一步只保证幂等，不靠调用方去重。
    expect(actorInnateActions(actor)).toEqual(["say", "wait", "inspect", "steal", "give"]);
    expect(actorInnateActions({ actions: ["say"] })).toEqual(["say"]);
  });

  it("reports where each carried action comes from", () => {
    const actor = { equipment: { weapon: "裂齿短刃" }, items: [blade()] };
    const grants: ActionGrant[] = carriedActions(actor);
    expect(grants).toEqual([
      { kind: "strike", slot: "weapon", itemId: "item-blade", itemName: "裂齿短刃" },
      { kind: "cleave", slot: "weapon", itemId: "item-blade", itemName: "裂齿短刃" },
    ]);
    expect(equippedItemActions(actor)).toEqual(["strike", "cleave"]);
    // 上限属于那把武器，不属于动作本身。
    expect(carriedActionCap(actor, "cleave")).toBe(2);
    expect(carriedActionCap(actor, "strike")).toBe(2);
    // 没有携带者时回落到 1（此时也不会授权）。
    expect(carriedActionCap({ equipment: {}, items: [] }, "cleave")).toBe(1);
  });

  it("only grants what the carrier table allows", () => {
    // 绕过内容校验直接构造：非武器行就算写了动作，携带者表也不会放出授权。
    const apron = toItemState({
      id: "item-apron",
      seq: 2,
      name: "尸布围裙",
      description: "浸过石灰的粗布围裙。",
      kind: "equipment",
      count: 1,
      stats: { maxHp: 0, strength: 0, wisdom: 0, agility: 0, damage: 0, block: 1 },
      actions: ["strike"],
    });
    const actor = { equipment: { armor: "尸布围裙" }, items: [apron] };
    expect(carriedActions(actor)).toEqual([]);
    expect(equippedItemActions(actor)).toEqual([]);
  });

  it("merges innate and carried actions in a fixed order", () => {
    const actor = { equipment: { weapon: "裂齿短刃" }, items: [blade()] };
    const allowed = allowedActionKinds(
      ["say", "move", "wait", "brawl"],
      equippedItemActions(actor),
    );
    // 顺序由 ACTION_KINDS 决定：strike / cleave 排在 wait 与 brawl 之间。
    expect(allowed).toEqual(["say", "move", "wait", "strike", "cleave", "brawl"]);
    expect(allowedActionKinds(["say", "brawl"])).toEqual(["say", "brawl"]);
  });
});

/** 只记录本轮任务提示词，然后提交一个 wait。 */
class PromptCaptureService implements ChatCompletionService {
  tools: readonly import("../src/llm").ToolDefinition[] = [];
  input = "";

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.tools = request.tools ?? [];
    this.input = request.inputMessage;
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

describe.skipIf(!testDatabaseUrl)("unarmed attack options", () => {
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

  const promptFor = async (world: typeof TEST_WORLD, actorRef: string, name: string) => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name,
      world,
    });
    const service = new PromptCaptureService();
    await runNpcTurn(handle.db, created.game.slug, actorRef, { service });
    return service;
  };

  it("tells an armed actor nothing about being unarmed", async () => {
    const service = await promptFor(TEST_WORLD, "守烬人", "持械提示测试局");
    expect(service.tools.map((tool) => tool.function.name)).toContain("strike");
    expect(service.input).not.toContain("近战只能用 brawl");
  });

  it("points an unarmed actor at brawl without granting it", async () => {
    const unarmed = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "守烬人" ? { ...actor, equipment: {} } : actor,
      ),
    };
    const service = await promptFor(unarmed, "守烬人", "空手提示测试局");
    // 能力面：提示词说明只能用 brawl，工具列表则如实收走武器动作。
    expect(service.input).toContain("当前没有能出手的武器：近战只能用 brawl");
    expect(service.tools.map((tool) => tool.function.name)).not.toContain("strike");
    expect(service.tools.map((tool) => tool.function.name)).not.toContain("cleave");
    expect(service.tools.map((tool) => tool.function.name)).toContain("brawl");
  });

  it("states that an actor with neither weapon nor brawl cannot attack", async () => {
    const service = await promptFor(BELL_MONASTERY_WORLD, "小鼠“坏运气”", "无攻击手段提示测试局");
    // 引擎不会因为空手就授予 brawl：没有这一条固有动作就真的没有攻击方式。
    expect(service.input).toContain("本轮无法发起攻击");
    expect(service.tools.map((tool) => tool.function.name)).not.toContain("brawl");
  });

  it("shows the cleave cap of the carrier that grants it", async () => {
    const service = await promptFor(CROW_GRAVE_WORLD, "收尸人卡尔", "横扫提示测试局");
    const cleave = service.tools.find((tool) => tool.function.name === "cleave");
    expect(cleave).toBeDefined();
    expect(cleave?.function.parameters.properties).toMatchObject({
      targets: { maxItems: 2 },
    });
  });
});
