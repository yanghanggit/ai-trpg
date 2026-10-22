import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DARK_FANTASY_SEED, DEMO_USER } from "../seeds/dark-fantasy";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { loadSnapshot } from "../src/debug/snapshot";
import {
  createGame,
  getGameMemories,
  getGameState,
  type NpcPlan,
  runNpcTurn,
  snapshotGame,
} from "../src/game";
import { ChatCompletionResult, type ChatCompletionService, type ToolCall } from "../src/llm";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

class ScriptedNpcService implements ChatCompletionService {
  private readonly plans: NpcPlan[];

  constructor(plans: NpcPlan[]) {
    this.plans = [...plans];
  }

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    const plan = this.plans.shift();
    if (!plan) {
      throw new Error("脚本化 NPC 计划已耗尽");
    }
    const toolCall: ToolCall = {
      id: randomUUID(),
      type: "function",
      function: {
        name: "submit_action_plan",
        arguments: JSON.stringify(plan),
      },
    };
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls: [toolCall] },
      finishReason: "tool_calls",
      toolCalls: [toolCall],
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
      seed: DARK_FANTASY_SEED,
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
        mind: "先试探他。",
        actionType: "say",
        targetActorName: "提灯修士",
        message: "你听见钟声了吗？",
      },
      {
        mind: "不要让它继续响。",
        actionType: "say",
        targetActorName: "守烬人",
        message: "别回应它。",
      },
      { mind: "去中殿看看。", actionType: "move", targetStageName: "断钟中殿" },
      { mind: "跟上去。", actionType: "move", targetStageName: "断钟中殿" },
    ]);

    const first = await runNpcTurn(handle.db, created.game.slug, "守烬人", {
      service,
    });
    expect(first.ok).toBe(true);
    expect(first.plan?.actionType).toBe("say");

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
      "say",
      "move",
      "move",
    ]);
    expect(state.messages[1]?.targetActorId).toBeTruthy();
    expect(state.messages[2]?.targetActorId).toBeTruthy();
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
    expect(memories).toHaveLength(3);
    const keeper = memories.find((memory) => memory.name === "守烬人");
    const monk = memories.find((memory) => memory.name === "提灯修士");
    const scribe = memories.find((memory) => memory.name === "缄默抄经人");
    expect(scribe?.messages[0]?.type).toBe("system");
    expect(keeper?.messages[0]?.type).toBe("system");
    expect(monk?.messages[0]?.type).toBe("system");
    expect(keeper?.messages.some((message) => message.content.includes("别回应它"))).toBe(true);
    expect(monk?.messages.some((message) => message.content.includes("你听见钟声了吗"))).toBe(true);
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
      contentVersion: DARK_FANTASY_SEED.contentVersion,
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
  it("writes observer-specific say memory text for a third actor", async () => {
    const seed = {
      ...DARK_FANTASY_SEED,
      actors: [
        ...DARK_FANTASY_SEED.actors,
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
        },
      ],
    };
    const game = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "旁听测试局",
      seed,
    });
    const service = new ScriptedNpcService([
      {
        mind: "先让第三个人听见。",
        actionType: "say",
        targetActorName: "提灯修士",
        message: "灰里有人。",
      },
    ]);
    const result = await runNpcTurn(handle.db, game.game.slug, "守烬人", { service });
    expect(result.ok).toBe(true);

    const memories = await getGameMemories(handle.db, game.game.id);
    const observer = memories.find((memory) => memory.name === "旁听者");
    expect(
      observer?.messages.some((message) =>
        message.content.includes("守烬人对提灯修士说（场景：灰烬门廊）：灰里有人。"),
      ),
    ).toBe(true);
  });
});
