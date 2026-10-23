import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DARK_FANTASY_WORLD, DEMO_USER } from "../seeds/dark-fantasy";
import { USE_ITEM_SKILL } from "../src/game/skills";
import { TEST_WORLD } from "./test-world";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { loadSnapshot } from "../src/debug/snapshot";
import {
  type ActorPlan,
  createGame,
  getGameMemories,
  getGameState,
  type InteractIntent,
  runNpcTurn,
  snapshotGame,
} from "../src/game";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

function attackIntent(targetActorName: string): InteractIntent {
  return {
    kind: "interact",
    skill: USE_ITEM_SKILL,
    itemNames: [],
    purpose: { kind: "damage", targetActorName },
  };
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
    const toolCalls: ToolCall[] = plan.intents.map((intent) => {
      const name =
        intent.kind === "communication"
          ? "communicate"
          : intent.kind === "movement"
            ? "move"
            : "interact";
      return {
        id: randomUUID(),
        type: "function",
        function: {
          name,
          arguments: JSON.stringify(
            intent.kind === "communication"
              ? {
                  mind: intent.mind,
                  mode: intent.mode,
                  ...(intent.targetActorName !== undefined
                    ? { targetActorName: intent.targetActorName }
                    : {}),
                  message: intent.message,
                }
              : intent.kind === "movement"
                ? {
                    mode: intent.mode,
                    ...(intent.targetStageName !== undefined
                      ? { targetStageName: intent.targetStageName }
                      : {}),
                  }
                : {
                    skill: intent.skill.key,
                    purpose: intent.purpose.kind,
                    ...(intent.purpose.kind === "damage"
                      ? { targetActorName: intent.purpose.targetActorName }
                      : {}),
                    itemNames: intent.itemNames,
                  },
          ),
        },
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
        intents: [
          {
            kind: "communication",
            mind: "先试探他。",
            mode: "say",
            targetActorName: "提灯修士",
            message: "你听见钟声了吗？",
          },
        ],
      },
      {
        intents: [
          {
            kind: "communication",
            mind: "不要让它继续响。",
            mode: "whisper",
            targetActorName: "守烬人",
            message: "别回应它。",
          },
        ],
      },
      { intents: [{ kind: "movement", mode: "move", targetStageName: "断钟中殿" }] },
      { intents: [{ kind: "movement", mode: "move", targetStageName: "断钟中殿" }] },
    ]);

    const first = await runNpcTurn(handle.db, created.game.slug, "守烬人", {
      service,
    });
    expect(first.ok).toBe(true);
    expect(first.plan?.intents[0]).toMatchObject({ kind: "communication", mode: "say" });

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
    expect(memories).toHaveLength(5);
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
  it("emits a public event for wait", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "等待事件测试局",
      world: TEST_WORLD,
    });
    const service = new ScriptedNpcService([{ intents: [{ kind: "movement", mode: "wait" }] }]);

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
    const service = new ScriptedNpcService([{ intents: [attackIntent("提灯修士")] }]);

    const result = await runNpcTurn(handle.db, created.game.slug, "守烬人", { service });
    expect(result.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.game.version).toBe(1);
    expect(state.messages.map((message) => message.kind)).toEqual(["narration", "attack"]);
    expect(state.messages[1]?.content).toContain("守烬人对提灯修士使用攻击，造成3点伤害");
    expect(state.messages[1]?.targetActorId).toBeTruthy();
    expect(state.messages[1]?.visibility).toBe("stage");

    const monkState = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monkState?.hp).toBe(7);

    const memories = await getGameMemories(handle.db, created.game.id);
    const keeper = memories.find((memory) => memory.name === "守烬人");
    const monk = memories.find((memory) => memory.name === "提灯修士");
    expect(
      keeper?.messages.some((message) =>
        message.content.includes("你使用攻击对提灯修士，造成3点伤害"),
      ),
    ).toBe(true);
    expect(
      monk?.messages.some((message) =>
        message.content.includes("守烬人对你使用攻击，造成3点伤害；你剩余 HP 7/10。"),
      ),
    ).toBe(true);
  });

  it("materializes scene items and starts the narration in the crypt", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "故事结构测试局",
      world: DARK_FANTASY_WORLD,
    });
    const pyre = created.world.stages.find((stage) => stage.name === "场景.焚毛炉房");
    const crypt = created.world.stages.find((stage) => stage.name === "场景.浅眠墓穴");
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
        actor.name === "提灯修士" ? { ...actor, hp: 1, maxHp: 1, defense: 0 } : actor,
      ),
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "死亡测试局",
      world,
    });
    const service = new ScriptedNpcService([{ intents: [attackIntent("提灯修士")] }]);

    const result = await runNpcTurn(handle.db, created.game.slug, "守烬人", { service });
    expect(result.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.messages[1]?.content).toContain("提灯修士倒下了");
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    expect(monk).toMatchObject({ hp: 0, death: true });

    await expect(
      runNpcTurn(handle.db, created.game.slug, "提灯修士", {
        service: new ScriptedNpcService([]),
      }),
    ).rejects.toThrow("已死亡");
  });

  it("applies one communication and one movement intent in tool-call order", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "组合行动测试局",
      world: TEST_WORLD,
    });

    const service = new ScriptedNpcService([
      {
        intents: [
          { kind: "movement", mode: "move", targetStageName: "断钟中殿" },
          {
            kind: "communication",
            mind: "到了中殿再问抄经人。",
            mode: "say",
            targetActorName: "缄默抄经人",
            message: "你看见钟摆了吗？",
          },
        ],
      },
    ]);

    const result = await runNpcTurn(handle.db, created.game.slug, "守烬人", { service });
    expect(result.ok).toBe(true);
    expect(result.plan?.intents).toHaveLength(2);

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
          hp: 8,
          maxHp: 8,
          attack: 1,
          defense: 1,
          speed: 2,
          items: [],
          skills: [USE_ITEM_SKILL],
          statusEffects: [],
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
        intents: [
          {
            kind: "communication",
            mind: "先让所有人听见。",
            mode: "announce",
            message: "灰里有人。",
          },
        ],
      },
      {
        intents: [
          {
            kind: "communication",
            mind: "这句给目标，但旁人也会听见。",
            mode: "say",
            targetActorName: "提灯修士",
            message: "只对你说。",
          },
        ],
      },
      {
        intents: [
          {
            kind: "communication",
            mind: "这句只给他听。",
            mode: "whisper",
            targetActorName: "提灯修士",
            message: "别回头。",
          },
        ],
      },
      {
        intents: [attackIntent("提灯修士")],
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
