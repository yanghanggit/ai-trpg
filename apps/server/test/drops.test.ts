import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_USER } from "../src/db/demo-fixture";
import { TEST_WORLD } from "./test-world";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getGameState,
  parseDrops,
  playerSteal,
  playerStrike,
  playerUse,
  runDropTurn,
  settleDeaths,
  takeActorControl,
} from "../src/game";
import { loadAgentMemory } from "../src/game/memory";
import { ChatCompletionResult, type ChatCompletionService } from "../src/llm";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

const CORPSE_APPEARANCE = "他仰面倒在石阶上，灰袍翻起一角，指缝里嵌着冷灰。";

/** 按本轮可用工具分别提交尸体外观或掉落材料的假服务。 */
class MaterialDropService implements ChatCompletionService {
  inputs: string[] = [];

  constructor(
    private readonly materials: unknown,
    private readonly appearance = CORPSE_APPEARANCE,
  ) {}

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.inputs.push(request.inputMessage);
    const toolNames = (request.tools ?? []).map((tool) => tool.function.name);
    const dropping = toolNames.includes("drop_materials");
    const toolCalls = [
      {
        id: "call-1",
        type: "function" as const,
        function: {
          name: dropping ? "drop_materials" : "submit_appearance",
          arguments: JSON.stringify(
            dropping ? { items: this.materials } : { appearance: this.appearance },
          ),
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

describe("drop materials parser", () => {
  it("只接受非空、不超长、不重复的材料，空数组是合法结果", () => {
    expect(parseDrops({ items: [] })).toEqual([]);
    expect(
      parseDrops({
        items: [{ name: "鼠王的厚毛皮", description: "灰褐色，厚得能拧出水。" }],
      }),
    ).toEqual([{ name: "鼠王的厚毛皮", description: "灰褐色，厚得能拧出水。", count: 1 }]);
    expect(
      parseDrops({ items: [{ name: "牙齿", description: "发黄。", count: 6 }] })[0]?.count,
    ).toBe(6);
  });

  it("拒绝超量、重名、空名、超长与非法数量", () => {
    const valid = { name: "骨片", description: "碎得只剩边角。" };
    expect(() => parseDrops({ items: [valid, valid, valid] })).toThrow(/最多/);
    expect(() => parseDrops({ items: [valid, { ...valid }] })).toThrow(/重复/);
    expect(() => parseDrops({ items: [{ ...valid, name: "  " }] })).toThrow(/材料名/);
    expect(() => parseDrops({ items: [{ ...valid, name: "长".repeat(21) }] })).toThrow(/材料名/);
    expect(() => parseDrops({ items: [{ ...valid, description: "长".repeat(121) }] })).toThrow(
      /描述/,
    );
    expect(() => parseDrops({ items: [{ ...valid, count: 0 }] })).toThrow(/数量/);
    expect(() => parseDrops({ items: [{ ...valid, count: 2.5 }] })).toThrow(/数量/);
    expect(() => parseDrops({ items: [{ ...valid, count: 11 }] })).toThrow(/数量/);
    expect(() => parseDrops({ items: "骨片" })).toThrow(/items/);
  });

  it("材料名与描述是公共标签，不得含引用或角色名", () => {
    expect(() => parseDrops({ items: [{ name: "@骨片", description: "碎得只剩边角。" }] })).toThrow(
      /材料名 不能包含/,
    );
    expect(() => parseDrops({ items: [{ name: "骨片", description: "#12 的碎骨。" }] })).toThrow(
      /材料描述 不能包含/,
    );
    expect(() =>
      parseDrops({ items: [{ name: "守烬人的骨片", description: "碎得只剩边角。" }] }, ["守烬人"]),
    ).toThrow(/角色名/);
  });
});

describe.skipIf(!testDatabaseUrl)("death drops", () => {
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

  it("掉落材料留在尸体上，靠 steal 取走，不能被使用", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "掉落测试局",
      world: TEST_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const service = new MaterialDropService([
      { name: "浸血的灰袍碎片", description: "边角焦黑，布料里混着石粉。", count: 2 },
    ]);
    // 修士 HP 10、一刀 3：第一刀不死，第二刀才触发死亡阶段。
    await playerStrike(handle.db, created.game.slug, "守烬人", { targetActorRef: "提灯修士" });
    const hit = await playerStrike(
      handle.db,
      created.game.slug,
      "守烬人",
      { targetActorRef: "提灯修士" },
      { appearanceService: service },
    );
    expect(hit.death?.settled).toEqual(["提灯修士"]);
    expect(hit.death?.dropped).toEqual([{ actorName: "提灯修士", items: ["浸血的灰袍碎片"] }]);
    expect(hit.death?.dropFailed).toEqual([]);
    // 掉落推理自带该局的战役设定：材料名与描述不会靠模型的世界外常识补全。
    expect(
      service.inputs.some(
        (input) => input.includes("尸体掉落") && input.includes(TEST_WORLD.campaignSetting),
      ),
    ).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const gate = state.world.stages.find((stage) => stage.name === "灰烬门廊");
    // 材料在尸体背包里，不在场景里：因此不存在 pickup 这条路。
    expect(gate?.items).toEqual([]);
    const corpse = gate?.actors.find((actor) => actor.name === "提灯修士");
    const material = corpse?.items.find((item) => item.name === "浸血的灰袍碎片");
    expect(material?.kind).toBe("material");
    expect(material?.kind === "material" ? material.source : null).toBe("提灯修士");
    expect(material?.count).toBe(2);
    expect(material?.stats.damage).toBe(0);
    expect(material?.effect).toEqual({ type: "none" });

    // 场景小 GM 从场景事件里知道尸体上多了什么。
    const memory = await loadAgentMemory(handle.db, created.game.id, "stage", gate?.id ?? "");
    expect(memory?.messages.some((message) => message.content.includes("# 尸体遗留"))).toBe(true);

    const stolen = await playerSteal(handle.db, created.game.slug, "守烬人", {
      targetActorRef: "提灯修士",
      itemName: "浸血的灰袍碎片",
    });
    expect(stolen.ok).toBe(true);
    const afterSteal = await getGameState(handle.db, created.game.slug);
    const keeper = afterSteal.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人");
    const carried = keeper?.items.find((item) => item.name === "浸血的灰袍碎片");
    expect(carried?.kind).toBe("material");
    // 换手不改来源：材料始终记着它源于哪具尸体。
    expect(carried?.kind === "material" ? carried.source : null).toBe("提灯修士");

    await expect(
      playerUse(handle.db, created.game.slug, "守烬人", {
        itemName: "浸血的灰袍碎片",
        targetStageName: "灰烬门廊",
      }),
    ).rejects.toThrow(/没有可以直接使用的效果/);
  });

  it("同名材料再掉一次只增加数量，不加新行", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "掉落合并测试局",
      world: TEST_WORLD,
    });
    const dropped = [{ name: "灰烬骨片", description: "碎得只剩边角。", count: 1 }];
    const first = await runDropTurn(handle.db, created.game.slug, "提灯修士", {
      service: new MaterialDropService(dropped),
    });
    expect(first.dropped).toEqual(["灰烬骨片"]);

    const second = await runDropTurn(handle.db, created.game.slug, "提灯修士", {
      service: new MaterialDropService(dropped),
    });
    expect(second.dropped).toEqual(["灰烬骨片"]);

    const monk = (await getGameState(handle.db, created.game.slug)).world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    const rows = monk?.items.filter((item) => item.name === "灰烬骨片") ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(2);
  });

  it("模型返回空数组时算成功，不写任何场景物品", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "无掉落测试局",
      world: TEST_WORLD,
    });
    const result = await runDropTurn(handle.db, created.game.slug, "提灯修士", {
      service: new MaterialDropService([]),
    });
    expect(result.ok).toBe(true);
    expect(result.dropped).toEqual([]);
    const monk = result.state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk?.items.filter((item) => item.kind === "material")).toEqual([]);
  });

  it("掉落物不合法时整批拒绝，死亡宣布不受影响", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "非法掉落测试局",
      world: TEST_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    const service = new MaterialDropService([
      { name: "骨片", description: "碎得只剩边角。" },
      { name: "骨片", description: "重复。" },
    ]);
    // 修士 HP 10、一刀 3：第一刀不死，第二刀才触发死亡阶段。
    await playerStrike(handle.db, created.game.slug, "守烬人", { targetActorRef: "提灯修士" });
    const hit = await playerStrike(
      handle.db,
      created.game.slug,
      "守烬人",
      { targetActorRef: "提灯修士" },
      { appearanceService: service },
    );
    expect(hit.death?.settled).toEqual(["提灯修士"]);
    expect(hit.death?.dropped).toEqual([]);
    expect(hit.death?.dropFailed).toEqual(["提灯修士"]);

    const monk = (await getGameState(handle.db, created.game.slug)).world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk?.items.filter((item) => item.kind === "material")).toEqual([]);
  });

  it("没有外观服务时不跑掉落：只有宣布这一步", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "离线死亡测试局",
      world: { ...TEST_WORLD, actors: TEST_WORLD.actors.map((actor) => ({ ...actor, hp: 0 })) },
    });
    const phase = await settleDeaths(handle.db, created.game.id);
    expect(phase.settled.length).toBeGreaterThan(0);
    expect(phase.dropped).toEqual([]);
    expect(phase.dropFailed).toEqual([]);
  });
});
