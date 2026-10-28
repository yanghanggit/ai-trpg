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
  playerMove,
  playerRememberIdentity,
  playerSay,
  runNpcTurn,
  takeActorControl,
} from "../src/game";
import { parseAnnounce } from "../src/game/actions/announce";
import { parseSay } from "../src/game/actions/say";
import { parseWhisper } from "../src/game/actions/whisper";
import { handleOf } from "../src/game/addressing";
import { buildActorObservation } from "../src/game/npc";
import { allocateEntitySeq } from "../src/game/persistence/entity-seq";
import {
  insertPresentation,
  switchCurrentPresentation,
} from "../src/game/persistence/presentations";
import { parseRememberIdentity } from "../src/game/plan";
import { ChatCompletionResult, type ChatCompletionService } from "../src/llm";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

function toolCall(name: string, args: Record<string, unknown>) {
  return {
    id: randomUUID(),
    type: "function" as const,
    function: { name, arguments: JSON.stringify(args) },
  };
}

/** 只做一件事：把某个指代记成名字，然后提交。 */
class RememberService implements ChatCompletionService {
  calls = 0;
  constructor(
    private readonly handle: string,
    private readonly name = "无名者",
  ) {}

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.calls += 1;
    const toolCalls = [
      toolCall("remember_identity", { handle: this.handle, name: this.name }),
      toolCall("submit_plan", {}),
    ];
    return new ChatCompletionResult({
      request,
      aiMessage: { type: "ai", content: "", toolCalls },
      finishReason: "tool_calls",
      toolCalls,
    });
  }
}

async function actorByName(slug: string, handle: DatabaseHandle, name: string) {
  const state = await getGameState(handle.db, slug);
  const actor = state.world.stages.flatMap((stage) => stage.actors).find((a) => a.name === name);
  if (!actor) {
    throw new Error(`缺少 actor: ${name}`);
  }
  return { state, actor };
}

describe.skipIf(!testDatabaseUrl)("names and addresses", () => {
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

  it("loads seed knowledge as beliefs per observer", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "开局知识测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const state = await getGameState(handle.db, created.game.slug);
    expect(state.knowledge).toHaveLength(5);
    expect(state.knowledge.every((row) => row.source === "content")).toBe(true);
    expect(state.knowledge.map((row) => row.name).sort()).toEqual(
      ["坏运气", "坏运气", "奥德里克", "父王", "煤渣"].sort(),
    );
  });

  it("keeps unknown names out of observations, tool enums and prompts", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "名字隔离测试局",
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "角色.无名者");
    await playerMove(handle.db, created.game.slug, "角色.无名者", {
      targetStageRef: "场景.墓园",
    });

    const { state, actor } = await actorByName(created.game.slug, handle, "角色.奥德里克");
    const stage = state.world.stages.find((candidate) =>
      candidate.actors.some((other) => other.id === actor.id),
    );
    if (!stage) {
      throw new Error("缺少墓园");
    }
    const observation = buildActorObservation(state, { actor, stage });

    // 已知的照常出现；没互相介绍过的只以外观出现。
    expect(observation).toContain("煤渣");
    expect(observation).toContain("坏运气");
    expect(observation).not.toContain("无名者");
    expect(observation).toContain("半幅发黄的裹尸布");
    // 指代是 @数字，不是名字。
    const unknown = state.world.stages
      .flatMap((candidate) => candidate.actors)
      .find((candidate) => candidate.name === "角色.无名者");
    if (!unknown) {
      throw new Error("缺少无名者");
    }
    expect(observation).toContain(handleOf(unknown.presentation.seq));
  });

  it("lets an actor record a name in its plan without any action", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "记名字测试局",
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "角色.无名者");
    await playerMove(handle.db, created.game.slug, "角色.无名者", {
      targetStageRef: "场景.墓园",
    });
    const { actor } = await actorByName(created.game.slug, handle, "角色.无名者");

    const service = new RememberService(handleOf(actor.presentation.seq));
    const turn = await runNpcTurn(handle.db, created.game.slug, "角色.奥德里克", { service });
    expect(turn.ok).toBe(true);
    expect(turn.loopSuccess).toBe(true);

    const after = await getGameState(handle.db, created.game.slug);
    const odric = after.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "角色.奥德里克");
    const nameless = after.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "角色.无名者");
    const belief = after.knowledge.find(
      (row) =>
        row.observerActorId === odric?.id && row.presentationId === nameless?.presentation.id,
    );
    expect(belief?.name).toBe("无名者");
    expect(belief?.source).toBe("self");

    // 记下之后，下一次观察里就会出现这个名字。
    const odricNow = after.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "角色.奥德里克");
    const stage = after.world.stages.find((candidate) =>
      candidate.actors.some((other) => other.id === odricNow?.id),
    );
    if (!odricNow || !stage) {
      throw new Error("缺少墓园");
    }
    expect(buildActorObservation(after, { actor: odricNow, stage })).toContain("无名者");
  });

  it("warns without blocking when the target is unseen or the name collides", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "认知告警测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const state = await getGameState(handle.db, created.game.slug);
    const ratKing = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "角色.鼠王");
    if (!ratKing) {
      throw new Error("缺少鼠王");
    }

    // 鼠王在地窖，奥德里克在墓园：没看见就记名字；而且这个称呼撞上煤渣的本名。
    const service = new RememberService(handleOf(ratKing.presentation.seq), "煤渣");
    const turn = await runNpcTurn(handle.db, created.game.slug, "角色.奥德里克", { service });
    expect(turn.ok).toBe(true);
    const warnings = turn.identityWarnings ?? [];
    expect(warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["unseen_handle", "name_collision"]),
    );
    // 告警不阻断：信念照常写入。
    const after = await getGameState(handle.db, created.game.slug);
    const odric = after.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "角色.奥德里克");
    expect(
      after.knowledge.find(
        (row) =>
          row.observerActorId === odric?.id && row.presentationId === ratKing.presentation.id,
      )?.name,
    ).toBe("煤渣");
  });

  it("lets a player record a name for the actor they control", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "玩家记名字测试局",
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "角色.无名者");
    await playerMove(handle.db, created.game.slug, "角色.无名者", {
      targetStageRef: "场景.墓园",
    });

    const turn = await playerRememberIdentity(handle.db, created.game.slug, "角色.无名者", {
      targetActorRef: "角色.奥德里克",
      name: "守墓人",
    });
    expect(turn.ok).toBe(true);

    const after = await getGameState(handle.db, created.game.slug);
    const nameless = after.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "角色.无名者");
    const odric = after.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "角色.奥德里克");
    expect(
      after.knowledge.find(
        (row) =>
          row.observerActorId === nameless?.id && row.presentationId === odric?.presentation.id,
      ),
    ).toMatchObject({ name: "守墓人", source: "self" });
  });

  it("stops recognizing a known person after a presentation change, and restores on switch back", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "形象切换识别测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const { actor: odric } = await actorByName(created.game.slug, handle, "角色.奥德里克");

    let maskedId = "";
    await handle.db.transaction(async (tx) => {
      maskedId = randomUUID();
      await insertPresentation(tx, {
        id: maskedId,
        seq: await allocateEntitySeq(tx, created.game.id),
        actorId: odric.id,
        anchor: "蒙着面，只露出眼睛",
        appearance: "一个蒙面人，斗篷把身形盖得严严实实。",
        isDefault: false,
        endedAt: new Date(),
      });
      await switchCurrentPresentation(tx, odric.id, maskedId, new Date());
    });

    const masked = await getGameState(handle.db, created.game.slug);
    const cinder = masked.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "角色.煤渣");
    const stage = masked.world.stages.find((candidate) =>
      candidate.actors.some((other) => other.id === cinder?.id),
    );
    if (!cinder || !stage) {
      throw new Error("缺少煤渣");
    }
    const maskedView = buildActorObservation(masked, { actor: cinder, stage });
    expect(maskedView).not.toContain("奥德里克");
    expect(maskedView).toContain("一个蒙面人");

    await handle.db.transaction(async (tx) => {
      await switchCurrentPresentation(tx, odric.id, odric.presentation.id, new Date());
    });
    const restored = await getGameState(handle.db, created.game.slug);
    const cinderBack = restored.world.stages
      .flatMap((candidate) => candidate.actors)
      .find((candidate) => candidate.name === "角色.煤渣");
    const stageBack = restored.world.stages.find((candidate) =>
      candidate.actors.some((other) => other.id === cinderBack?.id),
    );
    if (!cinderBack || !stageBack) {
      throw new Error("缺少煤渣");
    }
    expect(buildActorObservation(restored, { actor: cinderBack, stage: stageBack })).toContain(
      "奥德里克",
    );
  });

  it("lets god-view callers target by id, canonical name or handle", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "上帝视角寻址测试局",
      world: TEST_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    const state = await getGameState(handle.db, created.game.slug);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    if (!monk) {
      throw new Error("缺少提灯修士");
    }

    // 三种寻址方式都成立：稳定 id、规范名、系统指代。
    for (const ref of [monk.id, monk.name, handleOf(monk.presentation.seq)]) {
      const said = await playerSay(handle.db, created.game.slug, "守烬人", {
        targetActorRef: ref,
        message: "测试寻址。",
      });
      expect(said.ok).toBe(true);
    }
    // 幂等：三条消息都进了公共事件流，客户端可以按 id 反查实体。
    const after = await getGameState(handle.db, created.game.slug);
    const targets = after.messages.filter((message) => message.kind === "say");
    expect(targets).toHaveLength(3);
    expect(targets.every((message) => message.targetActorId === monk.id)).toBe(true);
  });

  it("rejects canonical entity names in speech", () => {
    expect(() =>
      parseSay({ mind: "试探", targetActorHandle: "@3", message: "你是角色.守烬人？" }),
    ).toThrow(/规范名/);
    expect(() =>
      parseWhisper({ mind: "试探", targetActorHandle: "@3", message: "场景.灰烬门廊见。" }),
    ).toThrow(/规范名/);
    expect(() => parseAnnounce({ mind: "宣布", message: "武器.裂齿短刃在我手里。" })).toThrow(
      /规范名/,
    );
  });

  it("keeps speech free of system handles and rejects handle-shaped names", () => {
    expect(() =>
      parseSay({ mind: "试探", targetActorHandle: "@3", message: "@3，你是谁？" }),
    ).toThrow(/系统指代/);
    expect(() =>
      parseWhisper({ mind: "试探", targetActorHandle: "@3", message: "编号是 @3。" }),
    ).toThrow(/系统指代/);
    expect(() => parseRememberIdentity({ handle: "@3", name: "编号 @3" })).toThrow(/系统指代/);
    expect(() => parseRememberIdentity({ handle: "@3", name: "" })).toThrow(/name/);
    expect(parseRememberIdentity({ handle: "@3", name: "守钟人" })).toEqual({
      handle: "@3",
      name: "守钟人",
    });
  });
});
