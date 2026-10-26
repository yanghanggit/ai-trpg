import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_USER } from "../src/db/demo-fixture";
import { TEST_WORLD } from "./test-world";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { actors } from "../src/db/schema";
import {
  createGame,
  getGameState,
  playerAttack,
  playerGive,
  playerSteal,
  playerWait,
  refreshAppearances,
  releaseActorControl,
  runNpcTurn,
  settleDeaths,
  takeActorControl,
} from "../src/game";
import { loadAgentMemory } from "../src/game/memory";
import { claimDeath } from "../src/game/persistence/deaths";
import { describeStats } from "../src/game/plan";
import { ChatCompletionResult, type ChatCompletionService } from "../src/llm";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

/** 提交一个 wait 的 NPC 服务；用于确认死亡 actor 根本进不了 loop。 */
class WaitService implements ChatCompletionService {
  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    const toolCalls = [
      { id: "call-1", type: "function" as const, function: { name: "wait", arguments: "{}" } },
      {
        id: "call-2",
        type: "function" as const,
        function: { name: "submit_plan", arguments: "{}" },
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

/** 内容里直接把 hp 写成 0：这就是尸体的唯一表达方式。 */
const DEAD_CONTENT_WORLD = {
  ...TEST_WORLD,
  actors: TEST_WORLD.actors.map((actor) =>
    actor.name === "提灯修士" ? { ...actor, hp: 0, equipment: { armor: "铅封提灯" } } : actor,
  ),
};

describe.skipIf(!testDatabaseUrl)("actor status", () => {
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

  it("内容写 hp: 0 就是尸体，属性仍照常保留", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "内容尸体测试局",
      world: DEAD_CONTENT_WORLD,
    });

    const monk = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk?.hp).toBe(0);

    if (!monk) {
      throw new Error("缺少提灯修士");
    }
    expect(describeStats(monk)).toContain("HP：0/10");
    expect(describeStats(monk)).toContain("状态：已死亡");
  });

  it("尸体仍然可以被搜刮，但不会进入 NPC loop", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "尸体搜刮测试局",
      world: DEAD_CONTENT_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const stolen = await playerSteal(handle.db, created.game.slug, "守烬人", {
      targetActorName: "提灯修士",
      itemName: "铅封提灯",
    });
    expect(stolen.ok).toBe(true);

    await expect(
      runNpcTurn(handle.db, created.game.slug, "提灯修士", { service: new WaitService() }),
    ).rejects.toThrow("已死亡");
  });

  it("hp 归零后即使 status 还写着 alive 也被当成死亡", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "hp 唯一真相测试局",
      world: TEST_WORLD,
    });
    const monk = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    if (!monk) {
      throw new Error("缺少提灯修士");
    }
    // 只改 hp，不动 status，模拟外部写入或未来 heal 逻辑遗漏。
    await handle.db.update(actors).set({ hp: 0 }).where(eq(actors.id, monk.id));

    await expect(
      runNpcTurn(handle.db, created.game.slug, "提灯修士", { service: new WaitService() }),
    ).rejects.toThrow("已死亡");

    // 尸体仍可被攻击，只是伤害结算空转；行动主体才必须活着。
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    const swing = await playerAttack(handle.db, created.game.slug, "守烬人", {
      targetActorName: "提灯修士",
    });
    expect(swing.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const updated = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    if (!updated) {
      throw new Error("缺少提灯修士");
    }
    expect(describeStats(updated)).toContain("状态：已死亡");
  });
});

/** 只提交尸体外观的假服务。 */
class DeathAppearanceService implements ChatCompletionService {
  calls = 0;
  input = "";

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.calls += 1;
    // 只有第一轮带 inputMessage，后续轮次沿用同一份 messages。
    if (this.input === "") {
      this.input = request.inputMessage;
    }
    const toolCalls = [
      {
        id: "appearance-1",
        type: "function" as const,
        function: {
          name: "submit_appearance",
          arguments: JSON.stringify({
            appearance: "他倒在石阶上，斗篷翻到一侧，手还按着地面的灰。",
          }),
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

describe.skipIf(!testDatabaseUrl)("death phase", () => {
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

  it("hp 归零后由死者自己跑一次死亡阶段，攻击方不判定死亡", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "死亡阶段测试局",
      world: TEST_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const service = new DeathAppearanceService();
    const attacked = await playerAttack(
      handle.db,
      created.game.slug,
      "守烬人",
      { targetActorName: "提灯修士" },
      { appearanceService: service },
    );
    expect(attacked.ok).toBe(true);
    // 修士没有死（还剩下 HP），所以不该有死亡阶段。
    expect(service.calls).toBe(0);

    const before = await getGameState(handle.db, created.game.slug);
    const monkBefore = before.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monkBefore?.hp).toBe(4);

    // 再打一次把 HP 打到 0：这次由死者自己触发一次外观收尾。
    const killed = await playerAttack(
      handle.db,
      created.game.slug,
      "守烬人",
      { targetActorName: "提灯修士" },
      { appearanceService: service },
    );
    expect(killed.ok).toBe(true);
    expect(service.calls).toBe(1);
    expect(service.input).toContain("当前生命 0");

    const after = await getGameState(handle.db, created.game.slug);
    const monkAfter = after.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monkAfter?.hp).toBe(0);
    expect(monkAfter?.appearance).toContain("倒");

    // 收尾只跑一次：第二次扫描不再重复调用。
    const again = await settleDeaths(handle.db, created.game.id, { service });
    expect(again.settled).toEqual([]);
    expect(service.calls).toBe(1);
  });

  it("复活式写入把 hp 抬回正数后，收尾标记会被清空，下次死亡重新收尾", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "复活标记测试局",
      world: TEST_WORLD,
    });
    const monk = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    if (!monk) {
      throw new Error("缺少提灯修士");
    }

    await handle.db.update(actors).set({ hp: 0 }).where(eq(actors.id, monk.id));
    const service = new DeathAppearanceService();
    const first = await settleDeaths(handle.db, created.game.id, { service });
    expect(first.settled).toEqual(["提灯修士"]);

    // 模拟复活：hp 回到正数。
    await handle.db.update(actors).set({ hp: 5 }).where(eq(actors.id, monk.id));
    const cleared = await settleDeaths(handle.db, created.game.id, { service });
    expect(cleared.settled).toEqual([]);
    const revived = await getGameState(handle.db, created.game.slug);
    expect(
      revived.world.stages
        .flatMap((stage) => stage.actors)
        .find((actor) => actor.name === "提灯修士")?.hp,
    ).toBe(5);

    // 再次死亡 → 重新收尾。
    await handle.db.update(actors).set({ hp: 0 }).where(eq(actors.id, monk.id));
    const second = await settleDeaths(handle.db, created.game.id, { service });
    expect(second.settled).toEqual(["提灯修士"]);
    expect(service.calls).toBe(2);
  });

  it("认领是 compare-and-set：同一次死亡只有一个调用者有权宣布", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "认领竞争测试局",
      world: TEST_WORLD,
    });
    const monk = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    if (!monk) {
      throw new Error("缺少提灯修士");
    }
    const now = new Date();
    await handle.db.update(actors).set({ hp: 0 }).where(eq(actors.id, monk.id));

    expect(await claimDeath(handle.db, monk.id, now)).toBe(true);
    expect(await claimDeath(handle.db, monk.id, now)).toBe(false);

    // 条件里带 hp：尸体被抬回正数后，认领不成立，不会被误宣布。
    await handle.db.update(actors).set({ hp: 3 }).where(eq(actors.id, monk.id));
    expect(await claimDeath(handle.db, monk.id, now)).toBe(false);
  });

  it("同一局并发调用死亡阶段只宣布一次", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "并发死亡阶段测试局",
      world: TEST_WORLD,
    });
    const monk = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    if (!monk) {
      throw new Error("缺少提灯修士");
    }
    await handle.db.update(actors).set({ hp: 0 }).where(eq(actors.id, monk.id));

    const [first, second] = await Promise.all([
      settleDeaths(handle.db, created.game.id),
      settleDeaths(handle.db, created.game.id),
    ]);
    // 进程内同局合流：两个调用共享同一次扫描，不会各自宣布一遍。
    expect(first.settled).toEqual(["提灯修士"]);
    expect(second.settled).toEqual(first.settled);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.messages.filter((message) => message.kind === "death")).toHaveLength(1);
  });

  it("默认玩家死亡只通知 world，是否收尾留给 world 回合", async () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "提灯修士" ? { ...actor, isDefaultPlayer: true, hp: 0 } : actor,
      ),
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "默认玩家离线死亡测试局",
      world,
    });

    // 没有攻击、没有外观服务：只有 hp 归零这个事实。
    const phase = await settleDeaths(handle.db, created.game.id);
    expect(phase.settled).toEqual(["提灯修士"]);
    expect(phase.failed).toEqual([]);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.game.status).toBe("active");
    expect(state.game.outcome).toBeNull();
    expect(state.messages.filter((message) => message.kind === "game_completed")).toHaveLength(0);

    const memory = await loadAgentMemory(handle.db, created.game.id, "world", created.world.id);
    expect(memory?.messages.some((message) => message.content.includes("# 主角死亡"))).toBe(true);
  });

  it("外观失败不阻塞主角死亡的通知，失败结果交给调用方", async () => {
    const world = {
      ...TEST_WORLD,
      actors: TEST_WORLD.actors.map((actor) =>
        actor.name === "提灯修士"
          ? {
              ...actor,
              isDefaultPlayer: true,
              hp: 1,
              stats: { ...actor.stats, maxHp: 1, block: 0 },
            }
          : actor,
      ),
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "默认玩家死亡外观失败测试局",
      world,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const result = await playerAttack(
      handle.db,
      created.game.slug,
      "守烬人",
      { targetActorName: "提灯修士" },
      { appearanceService: new FailingAppearanceService() },
    );
    expect(result.ok).toBe(true);
    expect(result.death?.settled).toEqual(["提灯修士"]);
    expect(result.death?.failed).toEqual([]);
    expect(result.death?.appearanceFailed).toEqual(["提灯修士"]);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.game.status).toBe("active");
    expect(state.game.outcome).toBeNull();
  });
});

describe.skipIf(!testDatabaseUrl)("appearance maintenance", () => {
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

  it("批量入口跳过已收尾的尸体，只重推活人", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "批量外观测试局",
      world: TEST_WORLD,
    });
    const monk = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    if (!monk) {
      throw new Error("缺少提灯修士");
    }

    // 先把修士打死并完成收尾。
    await handle.db.update(actors).set({ hp: 0 }).where(eq(actors.id, monk.id));
    const service = new DeathAppearanceService();
    expect((await settleDeaths(handle.db, created.game.id, { service })).settled).toEqual([
      "提灯修士",
    ]);
    expect(service.calls).toBe(1);
    const corpseAppearance = (await getGameState(handle.db, created.game.slug)).world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士")?.appearance;

    // 批量维护：尸体已收尾 → 跳过；其余活人各推一次。
    const result = await refreshAppearances(handle.db, created.game.id, { service });
    expect(result.skipped).toEqual(["提灯修士"]);
    expect(result.settled).toEqual([]);
    expect(result.refreshed).toEqual(["守烬人", "缄默抄经人"]);
    // 1（死亡收尾）+ 2（活人）= 3，没有第三次给尸体。
    expect(service.calls).toBe(3);

    const after = (await getGameState(handle.db, created.game.slug)).world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士")?.appearance;
    expect(after).toBe(corpseAppearance);
  });
});

/** 永远失败的外观服务：模拟 LLM 超时 / 报错。 */
class FailingAppearanceService implements ChatCompletionService {
  calls = 0;

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.calls += 1;
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "" },
      finishReason: "error",
      toolCalls: [],
    });
  }
}

describe.skipIf(!testDatabaseUrl)("death phase does not block death", () => {
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

  it("外观推理失败时，死亡照样宣布并广播，只是没有尸体快照", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "收尾失败测试局",
      world: TEST_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");

    const failing = new FailingAppearanceService();
    const kill = () =>
      playerAttack(
        handle.db,
        created.game.slug,
        "守烬人",
        { targetActorName: "提灯修士" },
        { appearanceService: failing },
      );
    await kill();
    const killing = await kill();
    // 外观失败不影响行动本身：攻击照样成功，hp 照样归零。
    expect(killing.ok).toBe(true);

    const after = await getGameState(handle.db, created.game.slug);
    const monk = after.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk?.hp).toBe(0);
    // 外观没推成 → 保持死亡前的样子，但这不影响死亡本身的宣布。
    expect(monk?.appearance).not.toContain("倒");
    expect(failing.calls).toBeGreaterThan(0);

    // 死亡广播是公共事件，不依赖 LLM。
    const deathMessage = after.messages.find((message) => message.kind === "death");
    expect(deathMessage?.content).toBe("提灯修士倒下了，不再有任何生命迹象。");

    // 死亡已经宣布过：标记已写，再来一次不会重复广播，也不会重试外观。
    const again = await settleDeaths(handle.db, created.game.id, {
      service: new DeathAppearanceService(),
    });
    expect(again.settled).toEqual([]);
    expect(again.appearanceFailed).toEqual([]);
    const after2 = await getGameState(handle.db, created.game.slug);
    expect(after2.messages.filter((message) => message.kind === "death")).toHaveLength(1);
  });

  it("没有 LLM 也能宣布死亡：广播与标记都不依赖推理", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "无 LLM 宣布死亡测试局",
      world: TEST_WORLD,
    });
    const monk = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    if (!monk) {
      throw new Error("缺少提灯修士");
    }
    await handle.db.update(actors).set({ hp: 0 }).where(eq(actors.id, monk.id));

    // 完全不传 service：死亡判定与广播必须照常发生，只有外观快照被跳过。
    const phase = await settleDeaths(handle.db, created.game.id);
    expect(phase.settled).toEqual(["提灯修士"]);
    expect(phase.appearanceFailed).toEqual([]);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.messages.filter((message) => message.kind === "death")).toHaveLength(1);
    expect(
      state.world.stages.flatMap((stage) => stage.actors).find((actor) => actor.name === "提灯修士")
        ?.appearance,
    ).toBe(monk.appearance);
  });

  it("宣布死亡会写场景、旁观者与死者自己的记忆", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "死亡广播记忆测试局",
      world: TEST_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    const service = new DeathAppearanceService();
    const strike = () =>
      playerAttack(
        handle.db,
        created.game.slug,
        "守烬人",
        { targetActorName: "提灯修士" },
        { appearanceService: service },
      );
    await strike();
    await strike();

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    const keeper = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人");
    const stageId = state.world.stages.find((stage) =>
      stage.actors.some((actor) => actor.name === "提灯修士"),
    )?.id;
    if (!monk || !keeper || !stageId) {
      throw new Error("缺少测试数据");
    }

    const readMemory = async (kind: "stage" | "actor", id: string) => {
      const memory = await loadAgentMemory(handle.db, created.game.id, kind, id);
      return memory?.messages.map((message) => message.content).join("\n") ?? "";
    };
    // 场景记忆与旁观者记忆都收到死亡事件。
    expect(await readMemory("stage", stageId)).toContain("提灯修士的生命归零");
    expect(await readMemory("actor", keeper.id)).toContain("倒下了，不再有任何生命迹象");
    // 死者自己也留一条，供未来的复活类扩展使用。
    expect(await readMemory("actor", monk.id)).toContain("你已经死亡");
  });
});

/** 记录本轮 input 与完整工具定义的假服务；用于检查目标枚举。 */
class TargetCaptureService implements ChatCompletionService {
  input = "";
  tools: { function: { name: string; parameters: unknown } }[] = [];

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    // 只有第一轮带 inputMessage，后续轮次沿用同一份 messages。
    if (this.input === "") {
      this.input = request.inputMessage;
    }
    this.tools = (request.tools ?? []) as unknown as {
      function: { name: string; parameters: unknown };
    }[];
    const toolCalls = [
      {
        id: "capture-1",
        type: "function" as const,
        function: { name: "submit_plan", arguments: "{}" },
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

describe.skipIf(!testDatabaseUrl)("corpses can be operated on", () => {
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

  /** 造一具尸体：守烬人两刀打死提灯修士。 */
  const killMonk = async (name: string, service?: ChatCompletionService) => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name,
      world: TEST_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    const strike = () =>
      playerAttack(
        handle.db,
        created.game.slug,
        "守烬人",
        { targetActorName: "提灯修士" },
        service ? { appearanceService: service } : {},
      );
    await strike();
    await strike();
    return created;
  };

  const findMonk = async (slug: string) => {
    const state = await getGameState(handle.db, slug);
    return state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
  };

  it("尸体可以被攻击：结算空转，不改 hp，也不重复宣布死亡", async () => {
    const created = await killMonk("攻击尸体测试局");
    const before = await findMonk(created.game.slug);
    expect(before?.hp).toBe(0);

    const again = await playerAttack(handle.db, created.game.slug, "守烬人", {
      targetActorName: "提灯修士",
    });
    expect(again.ok).toBe(true);

    const after = await getGameState(handle.db, created.game.slug);
    const monk = after.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk?.hp).toBe(0);
    expect(monk?.appearance).toBe(before?.appearance);
    expect(after.messages.filter((message) => message.kind === "death")).toHaveLength(1);
  });

  it("物品可以交给尸体（为复活类玩法留口）", async () => {
    const created = await killMonk("给予尸体测试局");
    const given = await playerGive(handle.db, created.game.slug, "守烬人", {
      targetActorName: "提灯修士",
      itemName: "裂齿短刃",
    });
    expect(given.ok).toBe(true);

    const monk = await findMonk(created.game.slug);
    expect(monk?.hp).toBe(0);
    expect(monk?.items.map((item) => item.name)).toContain("裂齿短刃");
  });

  it("NPC 的工具目标与观察文本都包含尸体（只有一套规则）", async () => {
    const created = await killMonk("尸体也是合法目标测试局");
    const capture = new TargetCaptureService();
    // 守烬人已经被玩家接管，改用同场景的旁观者视角检查工具枚举。
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    await releaseActorControl(handle.db, created.game.slug, "守烬人");
    await runNpcTurn(handle.db, created.game.slug, "守烬人", { service: capture });

    // attack / give / use 的参数枚举都包含尸体名，没有第二套存活过滤。
    for (const toolName of ["attack", "give", "use"]) {
      const tool = capture.tools.find((tool) => tool.function.name === toolName);
      const enumValues = (tool?.function.parameters as { properties?: Record<string, unknown> })
        ?.properties;
      const targetName = enumValues?.targetActorName as { enum?: string[] } | undefined;
      expect(targetName?.enum).toContain("提灯修士");
    }
    // 观察文本只有一个「可作用对象」，且包含尸体。
    expect(capture.input).toContain("## 可作用对象");
    expect(capture.input).not.toContain("## 可交谈对象");
    expect(capture.input).toContain("提灯修士");
  });

  it("旁观者与出手者都只知道伤害，对方的剩余生命只有受害者自己知道", async () => {
    // 门廊里加一个旁观者：攻击者与目标之外，必须有第三方才谈得上「旁观者视角」。
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
          stats: { maxHp: 8, strength: 1, wisdom: 1, agility: 2, damage: 1, block: 1 },
          items: [],
          actions: ["say", "whisper", "move", "wait"] as const,
        },
      ],
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "旁观者信息隔离测试局",
      world,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    await playerAttack(handle.db, created.game.slug, "守烬人", {
      targetActorName: "提灯修士",
    });

    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    const scribe = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "旁听者");
    const keeper = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "守烬人");
    if (!monk || !scribe || !keeper) {
      throw new Error("缺少测试数据");
    }
    const read = async (id: string) => {
      const memory = await loadAgentMemory(handle.db, created.game.id, "actor", id);
      return memory?.messages.map((message) => message.content).join("\n") ?? "";
    };

    // 受害者自己：知道自己掉了多少血。
    const victim = await read(monk.id);
    expect(victim).toContain("造成6点伤害");
    expect(victim).toContain("你剩余 HP 4/10");

    // 同场景旁观者：知道这一下打得多重、对方有没有倒下，但不知道对方还剩多少生命。
    const observer = await read(scribe.id);
    expect(observer).toContain("守烬人对提灯修士使用攻击");
    expect(observer).toContain("造成6点伤害");
    expect(observer).not.toContain("剩余 HP");
    expect(observer).not.toContain("倒下");

    // 发起者：知道这一下打得多重，但同样看不到对方的剩余生命。
    const attacker = await read(keeper.id);
    expect(attacker).toContain("造成6点伤害");
    expect(attacker).not.toContain("剩余 HP");
  });

  it("尸体不能自主行动", async () => {
    const created = await killMonk("尸体不能行动测试局");
    // 玩家入口：没接管也不行，接管了也不行——行动入口统一拒绝。
    await expect(
      playerGive(handle.db, created.game.slug, "提灯修士", {
        targetActorName: "守烬人",
        itemName: "铅封提灯",
      }),
    ).rejects.toThrow("未被玩家接管");

    await takeActorControl(handle.db, created.game.slug, "提灯修士");
    await expect(playerWait(handle.db, created.game.slug, "提灯修士")).rejects.toThrow("已死亡");
  });
});
