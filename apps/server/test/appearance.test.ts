import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";
import { DEMO_USER } from "../src/db/demo-fixture";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { actorSignatureNames, appearances } from "../src/db/schema";
import {
  createGame,
  getGameMemories,
  getGameState,
  parseAppearance,
  playerEquip,
  playerUnequip,
  takeActorControl,
} from "../src/game";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

describe("appearance input", () => {
  it("rejects handles and known actor names", () => {
    expect(() => parseAppearance({ appearance: "裹尸布上沾着石灰。" })).not.toThrow();
    expect(() => parseAppearance({ appearance: "#12 站在门口。" })).toThrow("编号引用");
    // 场景与道具的名字是公共标签，写进外观的描述本身不算泄漏。
    expect(() => parseAppearance({ appearance: "煤渣倒在门口。" })).not.toThrow();
    expect(() => parseAppearance({ appearance: "煤渣倒在门口。" }, ["煤渣"])).toThrow(
      "不能包含角色名",
    );
  });
});

/** 只提交一个外观，并记录本次看到的外观观察。 */
class AppearanceService implements ChatCompletionService {
  observation = "";
  systemPrompt = "";
  calls = 0;

  constructor(private readonly appearance: string) {}

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.calls += 1;
    this.observation = request.inputMessage;
    this.systemPrompt = request.messages[0]?.content ?? "";
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

describe.skipIf(!testDatabaseUrl)("appearance fusion", () => {
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

  it("recomputes appearance from form, worn equipment and memory after changing equipment", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "外观融合测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const keeper = created.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "奥德里克");
    expect(keeper?.appearance.text).toContain("斗篷");

    await takeActorControl(handle.db, created.game.slug, "奥德里克");

    // 换装走真实入口：玩家行动 → 落账穿戴 → 事务外补一次外观推理。
    const service = new AppearanceService("只穿旧衬衣，手背沾着新土。");
    await expect(
      playerEquip(
        handle.db,
        created.game.slug,
        "奥德里克",
        { slot: "weapon", itemName: "补丁斗篷" },
        { appearanceService: service },
      ),
    ).rejects.toThrow("不能放进武器槽");
    const result = await playerUnequip(
      handle.db,
      created.game.slug,
      "奥德里克",
      { slot: "armor" },
      { appearanceService: service },
    );

    expect(result.ok).toBe(true);
    expect(service.calls).toBe(1);
    expect(service.observation).toContain("人类:");
    // 战役设定在 actor 的宪法里，任务输入不重复下发。
    expect(service.systemPrompt).toContain("这是一个架空的黑暗奇幻世界");
    expect(service.observation).not.toContain("这是一个架空的黑暗奇幻世界");
    expect(service.observation).not.toContain("补丁斗篷");

    const state = await getGameState(handle.db, created.game.slug);
    const updated = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "奥德里克");
    expect(updated?.appearance.text).toBe("只穿旧衬衣，手背沾着新土。");
    expect(updated?.equipment.armor).toBeUndefined();
    if (!updated) {
      throw new Error("缺少奥德里克");
    }

    const rows = await handle.db
      .select()
      .from(appearances)
      .where(eq(appearances.signatureId, updated.signature.id))
      .orderBy(asc(appearances.createdAt));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.source).toBe("seed");
    expect(rows[0]?.supersededAt).not.toBeNull();
    const equipmentRow = rows[1];
    expect(equipmentRow?.source).toBe("runtime");
    expect(equipmentRow?.supersededAt).toBeNull();
    const input = equipmentRow?.input;
    if (input?.source !== "runtime") {
      throw new Error("缺少运行时外观输入快照");
    }
    expect(input.context.form).toContain("人类:");
    expect(input.context.task).toBe("update");
    expect(input.context.worn.some(({ name }) => name === "补丁斗篷")).toBe(false);
    expect(input.prompt.inputMessage).toContain("外观更新");
    expect(input.prompt.messages.length).toBeGreaterThan(0);
    expect(input.prompt.tools[0]?.function.name).toBe("submit_appearance");
    expect(input.model).toBeNull();

    const memories = await getGameMemories(handle.db, created.game.id);
    const keeperMemory = memories.find((memory) => memory.name === "奥德里克");
    const systemPrompt = keeperMemory?.messages.find((message) => message.type === "system");
    expect(systemPrompt?.content).toContain("人类:");
    expect(systemPrompt?.content).not.toContain("只穿旧衬衣");
  });

  it("keeps one armor slot and one accessory slot", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "槽位收敛测试局",
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "无名者");
    const service = new AppearanceService("裹着发黄的布，颈上的断链垂在锁骨前。");
    const wear = (slot: "armor" | "accessory", itemName: string) =>
      playerEquip(
        handle.db,
        created.game.slug,
        "无名者",
        { slot, itemName },
        { appearanceService: service },
      );

    // 护甲槽只接受 equipment 大类。
    await expect(wear("armor", "颈上的断链")).rejects.toThrow("不能放进护甲槽");

    expect((await wear("accessory", "颈上的断链")).ok).toBe(true);
    // 饰品可以穿戴，但不参与外观推理：输入里没有这个槽位，也没有它的物品。
    expect(service.observation).not.toContain("饰品");
    expect(service.observation).not.toContain("颈上的断链");

    const state = await getGameState(handle.db, created.game.slug);
    const actor = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "无名者");
    expect(actor?.equipment).toEqual({
      armor: "发黄的裹尸布",
      accessory: "颈上的断链",
    });
  });

  it("broadcasts the new appearance with observer-relative references", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "外观广播测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const state = await getGameState(handle.db, created.game.slug);
    const odric = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "奥德里克");
    const cinder = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "小狗“煤渣”");
    if (!odric || !cinder) {
      throw new Error("缺少测试角色");
    }

    // 煤渣没被介绍过奥德里克：广播只能出现编号与新外观，不能漏出真名。
    await handle.db
      .delete(actorSignatureNames)
      .where(
        and(
          eq(actorSignatureNames.gameId, created.game.id),
          eq(actorSignatureNames.observerActorId, cinder.id),
          eq(actorSignatureNames.signatureId, odric.signature.id),
        ),
      );

    await takeActorControl(handle.db, created.game.slug, "奥德里克");
    const service = new AppearanceService("斗篷下摆结着新泥，手背全是湿土。");
    await playerUnequip(
      handle.db,
      created.game.slug,
      "奥德里克",
      { slot: "armor" },
      { appearanceService: service },
    );

    const memories = await getGameMemories(handle.db, created.game.id);
    const latest = memories.find((memory) => memory.name === "小狗“煤渣”")?.messages.at(-1);
    expect(latest?.content).toContain("斗篷下摆结着新泥，手背全是湿土。");
    expect(latest?.content).toContain(`#${odric.signature.seq}的可见外观变了`);
    expect(latest?.content).not.toContain("奥德里克");

    // 外观变化也是自己的记忆事件：用「你」，不带名字。
    const selfLatest = memories.find((memory) => memory.name === "奥德里克")?.messages.at(-1);
    expect(selfLatest?.content).toContain("你的可见外观变了");
    expect(selfLatest?.content).toContain("斗篷下摆结着新泥，手背全是湿土。");
  });
});
