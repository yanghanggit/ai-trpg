import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  applyStagePlan,
  createGame,
  getGameMemories,
  getGameState,
  runStageTurn,
} from "../src/game";
import type { GameState } from "../src/game/types";
import type { World } from "../src/game/world-definition";
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

function submitStagePlan(): ToolCall {
  return call("submit_stage_plan");
}

/** 一轮里返回给定调用；同时记录本轮暴露的工具与输入。 */
class ScriptedService implements ChatCompletionService {
  tools: string[] = [];
  input = "";

  constructor(private readonly calls: ToolCall[]) {}

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.tools = request.tools?.map((tool) => tool.function.name) ?? [];
    this.input = request.inputMessage;
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls: this.calls },
      finishReason: "tool_calls",
      toolCalls: this.calls,
    });
  }
}

function stageByName(state: GameState, name: string) {
  const stage = state.world.stages.find((candidate) => candidate.name === name);
  if (!stage) {
    throw new Error(`缺少场景: ${name}`);
  }
  return stage;
}

const TORCH = {
  key: "torch",
  name: "测试火把",
  description: "测试用的场景武器。",
  kind: "weapon" as const,
  count: 1,
  stats: { damage: 7, block: 1 },
};

/** 门闩上挂着物品：用来验证「改名不动物品、带物品不能移除」。 */
const ANCHORED_ITEM_WORLD: World = {
  ...TEST_WORLD,
  stages: TEST_WORLD.stages.map((stage) =>
    stage.key === "gate"
      ? {
          ...stage,
          anchors: [
            { key: "latch", label: "门闩", description: "门上被灰烬塞住的门闩。", items: [TORCH] },
          ],
        }
      : stage,
  ),
};

/** 没有锚点动作的场景：三个工具都不该出现。 */
const NO_MANAGE_WORLD: World = {
  ...TEST_WORLD,
  stages: TEST_WORLD.stages.map((stage) =>
    stage.key === "gate" ? { ...stage, actions: ["submit_environment"] } : stage,
  ),
};

/** 只声明新增：其余两个工具不该出现——能力是平铺的，不按组开关。 */
const ADD_ONLY_WORLD: World = {
  ...TEST_WORLD,
  stages: TEST_WORLD.stages.map((stage) =>
    stage.key === "gate" ? { ...stage, actions: ["submit_environment", "add_anchor"] } : stage,
  ),
};

describe.skipIf(!testDatabaseUrl)("stage anchor tools", () => {
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

  const gateOf = async (slug: string) => {
    const state = await getGameState(handle.db, slug);
    return state.world.stages.find((stage) => stage.name === "灰烬门廊");
  };

  it("exposes only the anchor tools the stage declares", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "锚点工具能力测试局",
      world: TEST_WORLD,
    });
    const withAbility = new ScriptedService([submitStagePlan()]);
    await runStageTurn(handle.db, created.game.slug, "灰烬门廊", { service: withAbility });
    expect(withAbility.tools).toEqual(
      expect.arrayContaining(["add_anchor", "remove_anchor", "update_anchor"]),
    );

    const noAbilityGame = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "无锚点能力测试局",
      world: NO_MANAGE_WORLD,
    });
    const without = new ScriptedService([submitStagePlan()]);
    await runStageTurn(handle.db, noAbilityGame.game.slug, "灰烬门廊", { service: without });
    expect(without.tools).not.toContain("add_anchor");
    expect(without.tools).not.toContain("remove_anchor");
    expect(without.input).toContain("可交互锚点由内容层固定");

    const addOnlyGame = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "只声明新增锚点测试局",
      world: ADD_ONLY_WORLD,
    });
    const addOnly = new ScriptedService([submitStagePlan()]);
    await runStageTurn(handle.db, addOnlyGame.game.slug, "灰烬门廊", { service: addOnly });
    expect(addOnly.tools).toContain("add_anchor");
    expect(addOnly.tools).not.toContain("remove_anchor");
    expect(addOnly.tools).not.toContain("update_anchor");
  });

  it("adds an anchor, writes a public event and stage memory", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "新增锚点测试局",
      world: TEST_WORLD,
    });
    const result = await runStageTurn(handle.db, created.game.slug, "灰烬门廊", {
      service: new ScriptedService([
        call("add_anchor", { label: "壁龛", description: "门边凹进去的浅龛。" }),
        submitStagePlan(),
      ]),
    });

    expect(result.ok).toBe(true);
    expect(result.plan?.actions).toEqual([
      { kind: "add_anchor", label: "壁龛", description: "门边凹进去的浅龛。" },
    ]);
    const gate = await gateOf(created.game.slug);
    expect(gate?.anchors.map((anchor) => anchor.label)).toEqual(["门闩", "壁龛"]);
    const messages = (await getGameState(handle.db, created.game.slug)).messages;
    expect(messages.at(-1)).toMatchObject({ kind: "anchor_change" });
    const memory = (await getGameMemories(handle.db, created.game.id)).find(
      (item) => item.name === "灰烬门廊",
    );
    expect(memory?.messages.some((message) => message.content.includes("新增：壁龛"))).toBe(true);
  });

  it("renames an anchor without losing the items hanging on it", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "改写锚点测试局",
      world: ANCHORED_ITEM_WORLD,
    });
    const result = await runStageTurn(handle.db, created.game.slug, "灰烬门廊", {
      service: new ScriptedService([
        call("update_anchor", { targetAnchor: "门闩", label: "门栓", description: "换成木栓。" }),
        submitStagePlan(),
      ]),
    });

    expect(result.ok).toBe(true);
    const gate = await gateOf(created.game.slug);
    expect(gate?.anchors.map((anchor) => [anchor.key, anchor.label])).toEqual([["latch", "门栓"]]);
    expect(gate?.anchors[0]?.items.map((item) => item.name)).toEqual(["测试火把"]);
  });

  it("rejects anchor writes the stage did not declare", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "未声明锚点能力测试局",
      world: NO_MANAGE_WORLD,
    });
    const state = await getGameState(handle.db, created.game.slug);
    const gate = stageByName(state, "灰烬门廊");

    const ok = await applyStagePlan(
      handle.db,
      created.game.id,
      gate.id,
      { actions: [{ kind: "add_anchor", label: "壁龛" }] },
      true,
    );
    expect(ok).toBe(false);
    const memory = (await getGameMemories(handle.db, created.game.id)).find(
      (item) => item.name === "灰烬门廊",
    );
    expect(memory?.messages.at(-1)?.content).toContain("没有 add_anchor 能力");
  });

  it("rejects actor names in anchor text and more than one anchor write per turn", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "锚点守卫测试局",
      world: TEST_WORLD,
    });
    const leak = await runStageTurn(handle.db, created.game.slug, "灰烬门廊", {
      service: new ScriptedService([
        call("add_anchor", { label: "守烬人的门闩" }),
        submitStagePlan(),
      ]),
    });
    expect(leak.ok).toBe(false);
    let memory = (await getGameMemories(handle.db, created.game.id)).find(
      (item) => item.name === "灰烬门廊",
    );
    expect(memory?.messages.at(-1)?.content).toContain("不能包含角色名、编号引用");

    const state = await getGameState(handle.db, created.game.slug);
    const gate = stageByName(state, "灰烬门廊");
    const tooMany = await applyStagePlan(
      handle.db,
      created.game.id,
      gate.id,
      {
        actions: [
          { kind: "add_anchor", label: "壁龛" },
          { kind: "add_anchor", label: "暗格" },
        ],
      },
      true,
    );
    expect(tooMany).toBe(false);
    memory = (await getGameMemories(handle.db, created.game.id)).find(
      (item) => item.name === "灰烬门廊",
    );
    expect(memory?.messages.at(-1)?.content).toContain("本轮最多调整 1 个锚点");
  });

  it("removes an anchor together with the items hanging on it", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "移除带物品锚点测试局",
      world: ANCHORED_ITEM_WORLD,
    });
    const result = await runStageTurn(handle.db, created.game.slug, "灰烬门廊", {
      service: new ScriptedService([
        call("remove_anchor", { targetAnchor: "门闩" }),
        submitStagePlan(),
      ]),
    });

    expect(result.ok).toBe(true);
    const gate = await gateOf(created.game.slug);
    expect(gate?.anchors).toEqual([]);
    // 物品随锚点一起移除，事件里要写清带走了什么。
    const messages = (await getGameState(handle.db, created.game.slug)).messages;
    expect(messages.at(-1)?.content).toContain("带走 测试火把");
    const memory = (await getGameMemories(handle.db, created.game.id)).find(
      (item) => item.name === "灰烬门廊",
    );
    expect(memory?.messages.at(-1)?.content).toContain("带走 测试火把");
  });

  it("removes an empty anchor and rejects duplicate labels", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "移除空锚点测试局",
      world: TEST_WORLD,
    });
    const duplicate = await runStageTurn(handle.db, created.game.slug, "灰烬门廊", {
      service: new ScriptedService([call("add_anchor", { label: "门闩" }), submitStagePlan()]),
    });
    expect(duplicate.ok).toBe(false);

    const removed = await runStageTurn(handle.db, created.game.slug, "灰烬门廊", {
      service: new ScriptedService([
        call("remove_anchor", { targetAnchor: "门闩" }),
        submitStagePlan(),
      ]),
    });
    expect(removed.ok).toBe(true);
    expect((await gateOf(created.game.slug))?.anchors).toEqual([]);
  });
});
