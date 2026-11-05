import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getGameState,
  learnStageName,
  loadAgentMemory,
  playerMove,
  playerRecallRoute,
  runNpcTurn,
  takeActorControl,
} from "../src/game";
import type { World } from "../src/game/world-definition";
import { ChatCompletionResult, type ChatCompletionService } from "../src/llm";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

/** 无名者开局在棺材：除了棺材，别的场景名都要显式授予。 */
async function newGame(handle: DatabaseHandle, name: string) {
  const created = await createGame(handle.db, {
    username: DEMO_USER.username,
    name,
    world: BELL_MONASTERY_WORLD,
  });
  await takeActorControl(handle.db, created.game.slug, "无名者");
  return created.game.slug;
}

function toolCall(name: string, args: Record<string, unknown>) {
  return {
    id: randomUUID(),
    type: "function" as const,
    function: { name, arguments: JSON.stringify(args) },
  };
}

/** 只做一件事：回忆一条路线，然后提交。 */
class RecallRouteService implements ChatCompletionService {
  constructor(private readonly to: string) {}

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    const toolCalls = [toolCall("recall_route", { to: this.to }), toolCall("submit_plan", {})];
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: "tool_calls",
      toolCalls,
    });
  }
}

/**
 * 只关心图形状的小世界：前 `knownFrom` 个场景算已知，其余算没听过名字。
 * 默认全部已知，断言里就只剩路线本身；少给几个用来覆盖 `#序号` 的渲染。
 */
function graphWorld(
  version: string,
  stageNames: readonly string[],
  edges: readonly { from: number; to: number; sealed?: boolean }[],
  knownFrom = 0,
): World {
  const template = TEST_WORLD.stages[0];
  if (!template) {
    throw new Error("测试世界缺少场景模板");
  }
  const keys = stageNames.map((_, index) => `s${index}`);
  return {
    ...TEST_WORLD,
    contentVersion: version,
    stages: stageNames.map((name, index) => ({ ...template, key: `s${index}`, name })),
    connections: edges.map((edge) => {
      const from = keys[edge.from];
      const to = keys[edge.to];
      if (!from || !to) {
        throw new Error("测试边指向不存在的场景");
      }
      return { from, to, ...(edge.sealed ? { passage: "sealed" as const } : {}) };
    }),
    knownStages: keys.slice(0, knownFrom).map((key) => ({ actor: "ember-keeper", stage: key })),
    actors: TEST_WORLD.actors.map((actor) => ({ ...actor, stageKey: "s0" })),
  };
}

async function newGraphGame(handle: DatabaseHandle, world: World): Promise<string> {
  const created = await createGame(handle.db, {
    username: DEMO_USER.username,
    name: world.contentVersion,
    world,
  });
  await takeActorControl(handle.db, created.game.slug, "守烬人");
  return created.game.slug;
}

describe.skipIf(!testDatabaseUrl)("route recall", () => {
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

  it("routes through open edges between known stages", async () => {
    const slug = await newGame(handle, "回想路线测试局");
    await learnStageName(handle.db, slug, "无名者", "墓园");
    await learnStageName(handle.db, slug, "无名者", "地窖");

    const turn = await playerRecallRoute(handle.db, slug, "无名者", {
      fromStageRef: "墓园",
      toStageRef: "地窖",
    });
    expect(turn.ok).toBe(true);

    expect(turn.plan?.routes).toEqual([
      { fromStageId: expect.any(String), toStageId: expect.any(String) },
    ]);
  });

  it("writes the route into the actor's own memory", async () => {
    const slug = await newGame(handle, "路线写记忆测试局");

    await playerRecallRoute(handle.db, slug, "无名者", {
      fromStageRef: "棺材",
      toStageRef: "棺材",
    });

    const recall = await recallMemory(handle, slug, "无名者");
    expect(recall).toHaveLength(1);
    expect(recall[0]).toContain("你就在棺材，不用走。");
  });

  it("keeps the game version and the public message stream untouched", async () => {
    const slug = await newGame(handle, "路线不改版本测试局");
    await learnStageName(handle.db, slug, "无名者", "墓园");
    await playerMove(handle.db, slug, "无名者", { targetStageRef: "墓园" });
    const before = await getGameState(handle.db, slug);

    await playerRecallRoute(handle.db, slug, "无名者", {
      fromStageRef: "墓园",
      toStageRef: "墓园",
    });

    // 路线只写自己的记忆：状态没有变，公共事件流也没有新消息。
    const after = await getGameState(handle.db, slug);
    expect(after.game.version).toBe(before.game.version);
    expect(after.messages.length).toBe(before.messages.length);
  });

  it("refuses #序号 as an endpoint: handles are waypoints, not names", async () => {
    const slug = await newGame(handle, "路线编号端点测试局");
    const state = await getGameState(handle.db, slug);
    const crypt = state.world.stages.find((stage) => stage.name === "棺材");
    if (!crypt) {
      throw new Error("缺少棺材");
    }

    // 编号永远不是名字：哪怕它已经出现在记忆里的路线链上。
    await expect(
      playerRecallRoute(handle.db, slug, "无名者", { toStageRef: `#${crypt.seq}` }),
    ).rejects.toThrow(/必须用场景真名/);
  });

  it("refuses a stage the actor has never heard of", async () => {
    const slug = await newGame(handle, "路线未知场景测试局");

    await expect(
      playerRecallRoute(handle.db, slug, "无名者", { toStageRef: "焚尸房" }),
    ).rejects.toThrow(/你还没听说过这个场景/);
  });

  it("plans through the middle by its handle when the name is unknown", async () => {
    const slug = await newGame(handle, "路线未知中段测试局");
    // 棺材 → 墓园 → 焚尸房 是通的，但无名者没有墓园的知识。
    await learnStageName(handle.db, slug, "无名者", "焚尸房");

    const turn = await playerRecallRoute(handle.db, slug, "无名者", {
      fromStageRef: "棺材",
      toStageRef: "焚尸房",
    });
    expect(turn.ok).toBe(true);

    const recall = await recallMemory(handle, slug, "无名者");
    // 不认识的中间站用实体序号顶上；真名仍然不出现。
    expect(recall.at(-1)).toMatch(/从棺材到焚尸房：\n棺材 → #\d+ → 焚尸房（2 步）/);
    expect(recall.at(-1)).not.toContain("墓园");
  });

  it("reports a sealed door instead of inventing a path", async () => {
    const slug = await newGame(handle, "路线封门测试局");
    await learnStageName(handle.db, slug, "无名者", "铁闸门");
    await learnStageName(handle.db, slug, "无名者", "山道");

    await playerRecallRoute(handle.db, slug, "无名者", {
      fromStageRef: "铁闸门",
      toStageRef: "山道",
    });

    // 断处直接标在链上：不认识的站位给 #序号，封着的门写在两段之间。
    const recall = await recallMemory(handle, slug, "无名者");
    expect(recall.at(-1)).toContain("从铁闸门到山道：\n铁闸门 →[封着]→ 山道");
  });

  it("is a plan-level recall the model can trigger without spending its action", async () => {
    // NPC 回合要求 actor 未被接管，所以这里不用 newGame。
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "路线工具测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const slug = created.game.slug;
    await learnStageName(handle.db, slug, "无名者", "墓园");

    const turn = await runNpcTurn(handle.db, slug, "无名者", {
      service: new RecallRouteService("墓园"),
    });
    expect(turn.ok).toBe(true);
    expect(turn.plan?.actions).toEqual([]);
    expect(turn.plan?.routes).toHaveLength(1);

    const recall = await recallMemory(handle, slug, "无名者");
    expect(recall.at(-1)).toContain("从棺材到墓园：\n棺材 → 墓园（1 步）");
  });

  it("takes an open detour when the direct edge is sealed", async () => {
    // A→B 封着，但 A→C→B 通：报通的那条，而不是只报「断」。
    const slug = await newGraphGame(
      handle,
      graphWorld(
        "route-detour.v1",
        ["甲地", "乙地", "丙地"],
        [
          { from: 0, to: 1, sealed: true },
          { from: 0, to: 2 },
          { from: 2, to: 1 },
        ],
        3,
      ),
    );

    const turn = await playerRecallRoute(handle.db, slug, "守烬人", {
      fromStageRef: "甲地",
      toStageRef: "乙地",
    });
    expect(turn.ok).toBe(true);

    const recall = await recallMemory(handle, slug, "守烬人");
    expect(recall.at(-1)).toContain("从甲地到乙地：\n甲地 → 丙地 → 乙地（2 步）");
  });

  it("renders every sealed break when no route is open", async () => {
    const slug = await newGraphGame(
      handle,
      graphWorld(
        "route-breaks.v1",
        ["甲地", "乙地", "丙地", "丁地"],
        [
          { from: 0, to: 1, sealed: true },
          { from: 0, to: 2 },
          { from: 2, to: 1, sealed: true },
          { from: 0, to: 3 },
          { from: 3, to: 1, sealed: true },
        ],
        4,
      ),
    );

    await playerRecallRoute(handle.db, slug, "守烬人", {
      fromStageRef: "甲地",
      toStageRef: "乙地",
    });

    const recall = await recallMemory(handle, slug, "守烬人");
    const text = recall.at(-1) ?? "";
    // 标题只出现一次，下面一条断点一行。
    expect(text).toContain("从甲地到乙地：\n甲地 →[封着]→ 乙地");
    expect(text.split("从甲地到乙地：")).toHaveLength(2);
    expect(text).toContain("甲地 → 丙地 →[封着]→ 乙地");
    expect(text).toContain("甲地 → 丁地 →[封着]→ 乙地");
  });

  it("stops the chain at the first sealed door it cannot see past", async () => {
    // 两道门连着封：能走到第一扇，门后面的路说不出来。
    const slug = await newGraphGame(
      handle,
      graphWorld(
        "route-truncated.v1",
        ["甲地", "乙地", "丙地"],
        [
          { from: 0, to: 1, sealed: true },
          { from: 1, to: 2, sealed: true },
        ],
        3,
      ),
    );

    await playerRecallRoute(handle.db, slug, "守烬人", {
      fromStageRef: "甲地",
      toStageRef: "丙地",
    });

    const recall = await recallMemory(handle, slug, "守烬人");
    const text = recall.at(-1) ?? "";
    // 停在第一扇门后：`…` 表示再往后的路说不出来。
    expect(text).toContain("从甲地到丙地：\n甲地 →[封着]→ 乙地 …");
  });

  it("says there is no road when the graph has no link at all", async () => {
    const slug = await newGraphGame(
      handle,
      graphWorld("route-isolated.v1", ["甲地", "乙地", "丙地"], [{ from: 0, to: 1 }], 3),
    );

    await playerRecallRoute(handle.db, slug, "守烬人", {
      fromStageRef: "甲地",
      toStageRef: "丙地",
    });

    const recall = await recallMemory(handle, slug, "守烬人");
    expect(recall.at(-1)).toContain("从甲地到丙地：\n没有能走通的路");
  });

  it("keeps writing #序号 for stages whose names the actor never learned", async () => {
    const slug = await newGraphGame(
      handle,
      graphWorld(
        "route-anonymous.v1",
        ["甲地", "乙地", "丙地"],
        [
          { from: 0, to: 1, sealed: true },
          { from: 0, to: 2 },
          { from: 2, to: 1 },
        ],
        2,
      ),
    );

    await playerRecallRoute(handle.db, slug, "守烬人", {
      fromStageRef: "甲地",
      toStageRef: "乙地",
    });

    const recall = await recallMemory(handle, slug, "守烬人");
    const text = recall.at(-1) ?? "";
    expect(text).toMatch(/从甲地到乙地：\n甲地 → #\d+ → 乙地（2 步）/);
    expect(text).not.toContain("丙地");
  });
});

/** 路线回忆的结论只在 actor 记忆里，不在公共事件流里。 */
async function recallMemory(
  handle: DatabaseHandle,
  slug: string,
  actorName: string,
): Promise<string[]> {
  const state = await getGameState(handle.db, slug);
  const actor = state.world.stages
    .flatMap((stage) => stage.actors)
    .find((candidate) => candidate.name === actorName);
  if (!actor) {
    throw new Error(`缺少 actor: ${actorName}`);
  }
  const memory = await loadAgentMemory(handle.db, state.game.id, "actor", actor.id);
  return (memory?.messages ?? [])
    .filter((message) => kindOf(message.metadata) === "route_recall")
    .map((message) => message.content);
}

function kindOf(metadata: unknown): string | undefined {
  if (typeof metadata !== "object" || metadata === null) {
    return undefined;
  }
  const kind = (metadata as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : undefined;
}
