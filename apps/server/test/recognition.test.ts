import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { stages } from "../src/db/schema";
import {
  type ActorPlan,
  createGame,
  getGameState,
  playerMove,
  playerRecognizeIdentity,
  playerSay,
  runActorTurn,
  settleActorPlan,
  takeActorControl,
} from "../src/game";
import { parseAnnounce } from "../src/game/actions/announce";
import { parseSay } from "../src/game/actions/say";
import { parseWhisper } from "../src/game/actions/whisper";
import { parseRecognizeIdentity } from "../src/game/agents/actor-turn";
import { formatForm } from "../src/game/agents/appearance/form";
import { addressLookupFor, handleOf, isHandleRef, refOf } from "../src/game/kernel/addressing";
import { resolveVisibleActor } from "../src/game/lookup";
import { recordAppearance } from "../src/game/persistence/appearances";
import { allocateEntitySeq } from "../src/game/persistence/entity-seq";
import { insertSignature, switchCurrentSignature } from "../src/game/persistence/signatures";
import { ChatCompletionResult, type ChatCompletionService } from "../src/llm";
import { buildActorTurnInput } from "./actor-turn-input";
import { allowAllDialogue } from "./test-dialogue-judge";
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
class RecognizeService implements ChatCompletionService {
  calls = 0;
  constructor(
    private readonly handle: string,
    private readonly name = "无名者",
  ) {}

  async complete(request: Parameters<ChatCompletionService["complete"]>[0]) {
    this.calls += 1;
    const toolCalls = [
      toolCall("recognize_identity", { handle: this.handle, name: this.name }),
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

  it("loads seed signature names per observer", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "开局识别测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const state = await getGameState(handle.db, created.game.slug);
    expect(state.signatureNames).toHaveLength(5);
    expect(state.signatureNames.every((row) => row.source === "content")).toBe(true);

    const actors = state.world.stages.flatMap((stage) => stage.actors);
    const badLuck = actors.find((actor) => actor.name === "小鼠“坏运气”");
    const ratKing = actors.find((actor) => actor.name === "鼠王");
    // 幼崽的这条开局绑定显式把鼠王记作「鼠王」；「父王」只是台词里的关系称谓。
    expect(
      state.signatureNames.find(
        (row) => row.observerActorId === badLuck?.id && row.signatureId === ratKing?.signature.id,
      ),
    ).toMatchObject({ name: "鼠王", source: "content" });
  });

  it("uses a seed name as the observer's current name", async () => {
    const world = {
      ...TEST_WORLD,
      signatureNames: [{ observer: "ember-keeper", subject: "lantern-monk", name: "提灯人" }],
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "种子称呼测试局",
      world,
    });
    const state = await getGameState(handle.db, created.game.slug);
    const actors = state.world.stages.flatMap((stage) => stage.actors);
    const keeper = actors.find((actor) => actor.name === "守烬人");
    const monk = actors.find((actor) => actor.name === "提灯修士");
    const stage = state.world.stages.find((candidate) =>
      candidate.actors.some((actor) => actor.id === keeper?.id),
    );
    if (!keeper || !monk || !stage) {
      throw new Error("缺少测试角色");
    }

    expect(
      state.signatureNames.find(
        (row) => row.observerActorId === keeper.id && row.signatureId === monk.signature.id,
      ),
    ).toMatchObject({ name: "提灯人", source: "content" });
    const address = addressLookupFor(state, keeper, stage);
    expect(address(monk.id).token).toBe("提灯人");
    await expect(
      resolveVisibleActor(handle.db, {
        gameId: state.game.id,
        observerId: keeper.id,
        stageId: stage.id,
        ref: "提灯人",
      }),
    ).resolves.toMatchObject({ id: monk.id });
    await expect(
      resolveVisibleActor(handle.db, {
        gameId: state.game.id,
        observerId: keeper.id,
        stageId: stage.id,
        ref: "提灯修士",
      }),
    ).rejects.toThrow(/找不到这个引用/);
  });

  it("keeps every emitted reference resolvable in both directions", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "双向寻址测试局",
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "无名者");
    await playerMove(handle.db, created.game.slug, "无名者", {
      targetStageRef: "墓园",
    });

    const { state, actor } = await actorByName(created.game.slug, handle, "奥德里克");
    const stage = state.world.stages.find((candidate) =>
      candidate.actors.some((other) => other.id === actor.id),
    );
    if (!stage) {
      throw new Error("缺少墓园");
    }
    const address = addressLookupFor(state, actor, stage);
    const others = stage.actors.filter((other) => other.id !== actor.id);
    expect(others.some((other) => !isHandleRef(address(other.id).token))).toBe(true);
    expect(others.some((other) => isHandleRef(address(other.id).token))).toBe(true);

    // 有名字写名字，没名字写 #编号；两种 token 都必须能解析回同一个 actor。
    for (const target of others) {
      const emitted = address(target.id);
      const resolved = await resolveVisibleActor(handle.db, {
        gameId: state.game.id,
        observerId: actor.id,
        stageId: stage.id,
        ref: emitted.token,
      });
      expect(resolved.id).toBe(target.id);
    }
  });

  it("only lets actor-facing lookup use a signature or the observer's current name", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "签名与真名入口测试局",
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "无名者");
    await playerMove(handle.db, created.game.slug, "无名者", {
      targetStageRef: "墓园",
    });

    const { state, actor } = await actorByName(created.game.slug, handle, "奥德里克");
    const stage = state.world.stages.find((candidate) =>
      candidate.actors.some((other) => other.id === actor.id),
    );
    if (!stage) {
      throw new Error("缺少墓园");
    }
    const address = addressLookupFor(state, actor, stage);
    const others = stage.actors.filter((other) => other.id !== actor.id);
    const known = others.find((other) => !isHandleRef(address(other.id).token));
    const unknown = others.find((other) => isHandleRef(address(other.id).token));
    if (!known || !unknown) {
      throw new Error("墓园缺少已知 / 未知目标");
    }

    const resolve = (ref: string) =>
      resolveVisibleActor(handle.db, {
        gameId: state.game.id,
        observerId: actor.id,
        stageId: stage.id,
        ref,
      });

    // 签名入口：#编号对认得与不认得的目标都成立。
    await expect(resolve(handleOf(known.signature.seq))).resolves.toMatchObject({ id: known.id });
    await expect(resolve(handleOf(unknown.signature.seq))).resolves.toMatchObject({
      id: unknown.id,
    });

    // 名字入口：只认观察者当前的称呼；真名与 id 都不进入 actor-facing 层。
    await expect(resolve(address(known.id).token)).resolves.toMatchObject({ id: known.id });
    await expect(resolve(known.name)).rejects.toThrow(/找不到这个引用/);
    await expect(resolve(unknown.name)).rejects.toThrow(/找不到这个引用/);
    await expect(resolve(known.id)).rejects.toThrow(/找不到这个引用/);
  });

  it("keeps the observer's word as a label when two subjects share it", async () => {
    const world = {
      ...BELL_MONASTERY_WORLD,
      signatureNames: [
        { observer: "odric", subject: "cinder", name: "伙伴" },
        { observer: "odric", subject: "bad-luck", name: "伙伴" },
      ],
    };
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "同名认知测试局",
      world,
    });
    const state = await getGameState(handle.db, created.game.slug);
    const actors = state.world.stages.flatMap((stage) => stage.actors);
    const keeper = actors.find((actor) => actor.name === "奥德里克");
    const monk = actors.find((actor) => actor.name === "小狗“煤渣”");
    const scribe = actors.find((actor) => actor.name === "小鼠“坏运气”");
    const stage = state.world.stages.find((candidate) =>
      candidate.actors.some((actor) => actor.id === keeper?.id),
    );
    if (!keeper || !monk || !scribe || !stage) {
      throw new Error("缺少同名夹具");
    }

    // 名字仍是观察者的认知，但两个同形地址无法指认，于是都退回编号。
    const address = addressLookupFor(state, keeper, stage);
    expect(address(monk.id).token).toBe(handleOf(monk.signature.seq));
    expect(address(scribe.id).token).toBe(handleOf(scribe.signature.seq));
    // 展示里保留他给的称呼：认知不丢，只是不再是可提交的地址。
    expect(refOf(address(monk.id))).toContain("你的称呼：伙伴");

    const resolve = (ref: string) =>
      resolveVisibleActor(handle.db, {
        gameId: state.game.id,
        observerId: keeper.id,
        stageId: stage.id,
        ref,
      });
    // 解析期是最后防线：同名要说清能改用哪几个编号。
    await expect(resolve("伙伴")).rejects.toThrow(/对应多个对象/);
    await expect(resolve("伙伴")).rejects.toThrow(
      new RegExp(`${handleOf(monk.signature.seq)}.*${handleOf(scribe.signature.seq)}`),
    );
    await expect(resolve(handleOf(monk.signature.seq))).resolves.toMatchObject({ id: monk.id });
  });

  it("keeps unknown names out of observations, tool enums and prompts", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "名字隔离测试局",
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "无名者");
    await playerMove(handle.db, created.game.slug, "无名者", {
      targetStageRef: "墓园",
    });

    const { state, actor } = await actorByName(created.game.slug, handle, "奥德里克");
    const stage = state.world.stages.find((candidate) =>
      candidate.actors.some((other) => other.id === actor.id),
    );
    if (!stage) {
      throw new Error("缺少墓园");
    }
    const observation = buildActorTurnInput(state, { actor, stage });

    // 已知的照常出现；没互相介绍过的只以外观出现。
    expect(observation).toContain("煤渣");
    expect(observation).toContain("坏运气");
    expect(observation).not.toContain("无名者");
    expect(observation).toContain("半幅发黄的裹尸布");
    // 指代是名字或 #编号，不是真名。
    const unknown = state.world.stages
      .flatMap((candidate) => candidate.actors)
      .find((candidate) => candidate.name === "无名者");
    if (!unknown) {
      throw new Error("缺少无名者");
    }
    expect(observation).toContain(handleOf(unknown.signature.seq));
    // 名单里还有编号时，提示词提醒可以记名字。
    expect(observation).toContain("用 recognize_identity 把它记成");
  });

  it("renders the turn input environment through the observer's address", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "回合输入环境渲染测试局",
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "无名者");
    await playerMove(handle.db, created.game.slug, "无名者", {
      targetStageRef: "墓园",
    });

    const before = await getGameState(handle.db, created.game.slug);
    const stage = before.world.stages.find((candidate) => candidate.name === "墓园");
    const nameless = stage?.actors.find((actor) => actor.name === "无名者");
    const odric = stage?.actors.find((actor) => actor.name === "奥德里克");
    if (!stage || !nameless || !odric) {
      throw new Error("墓园缺少夹具");
    }
    const namelessHandle = handleOf(nameless.signature.seq);

    // 绕过写入守卫直写：模拟建局或历史数据里的裸名字与句柄。
    await handle.db
      .update(stages)
      .set({ environment: `无名者把灯放在${namelessHandle}旁。` })
      .where(eq(stages.id, stage.id));

    const state = await getGameState(handle.db, created.game.slug);
    const current = state.world.stages.find((candidate) => candidate.id === stage.id);
    const observer = current?.actors.find((actor) => actor.id === odric.id);
    if (!current || !observer) {
      throw new Error("墓园缺少夹具");
    }

    // 回合输入与 look_stage 共用同一套观察者渲染：裸名字与句柄都变成 #编号 + 外观。
    const input = buildActorTurnInput(state, { actor: observer, stage: current });
    expect(input).toContain(`${namelessHandle}把灯放在${namelessHandle}旁。`);
    expect(input).toContain(`${namelessHandle} 外观：`);
    expect(input).not.toContain("无名者");
  });

  it("lets an actor record a name in its plan without any action", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "记名字测试局",
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "无名者");
    await playerMove(handle.db, created.game.slug, "无名者", {
      targetStageRef: "墓园",
    });
    const { actor } = await actorByName(created.game.slug, handle, "无名者");

    const service = new RecognizeService(handleOf(actor.signature.seq), "裹尸布人");
    const turn = await runActorTurn(handle.db, created.game.slug, "奥德里克", { service });
    expect(turn.ok).toBe(true);
    expect(turn.loopSuccess).toBe(true);

    const after = await getGameState(handle.db, created.game.slug);
    const odric = after.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "奥德里克");
    const nameless = after.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "无名者");
    const name = after.signatureNames.find(
      (row) => row.observerActorId === odric?.id && row.signatureId === nameless?.signature.id,
    );
    expect(name).toMatchObject({ name: "裹尸布人", source: "self" });

    // 记下之后，下一次观察里就会出现这个名字。
    const odricNow = after.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "奥德里克");
    const stage = after.world.stages.find((candidate) =>
      candidate.actors.some((other) => other.id === odricNow?.id),
    );
    if (!odricNow || !stage) {
      throw new Error("缺少墓园");
    }
    const promptAfter = buildActorTurnInput(after, { actor: odricNow, stage });
    expect(promptAfter).toContain("裹尸布人");
    expect(promptAfter).not.toContain("无名者");
    // 没有未命名编号之后，起名提醒不再出现。
    expect(promptAfter).not.toContain("用 recognize_identity 把它记成");
  });

  it("rejects a new name for a signature outside the current stage", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "场外起名测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const state = await getGameState(handle.db, created.game.slug);
    const odric = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "奥德里克");
    const ratKing = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "鼠王");
    if (!odric || !ratKing) {
      throw new Error("缺少测试角色");
    }

    // 鼠王在地窖，奥德里克在墓园：没见过就没有起名依据。
    const plan: ActorPlan = {
      actions: [],
      identities: [{ handle: handleOf(ratKing.signature.seq), name: "鼠王" }],
    };
    const result = await settleActorPlan(handle.db, created.game.id, odric.id, plan, true);
    expect(result.ok).toBe(false);
    expect(result.rejection).toMatch(/只能给当前场景内的角色起名/);

    const after = await getGameState(handle.db, created.game.slug);
    expect(
      after.signatureNames.some(
        (row) => row.observerActorId === odric.id && row.signatureId === ratKing.signature.id,
      ),
    ).toBe(false);
  });

  it("resolves a new name against the stage at the start of the turn", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "移动中起名测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const state = await getGameState(handle.db, created.game.slug);
    const actors = state.world.stages.flatMap((stage) => stage.actors);
    const cinder = actors.find((candidate) => candidate.name === "小狗“煤渣”");
    const badLuck = actors.find((candidate) => candidate.name === "小鼠“坏运气”");
    if (!cinder || !badLuck) {
      throw new Error("缺少测试角色");
    }

    // 煤渣在墓园看见坏运气，然后本回合走开；名字仍应来自出发时的场景。
    const plan: ActorPlan = {
      actions: [{ kind: "move", targetStageName: "地窖" }],
      identities: [{ handle: handleOf(badLuck.signature.seq), name: "小东西" }],
    };
    const result = await settleActorPlan(handle.db, created.game.id, cinder.id, plan, true);
    expect(result.ok).toBe(true);

    const after = await getGameState(handle.db, created.game.slug);
    expect(
      after.signatureNames.find(
        (row) => row.observerActorId === cinder.id && row.signatureId === badLuck.signature.id,
      ),
    ).toMatchObject({ name: "小东西", source: "self" });
  });

  it("accepts any current name from the player and overwrites it on update", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "玩家命名测试局",
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "无名者");
    await playerMove(handle.db, created.game.slug, "无名者", {
      targetStageRef: "墓园",
    });

    const first = await playerRecognizeIdentity(handle.db, created.game.slug, "无名者", {
      targetActorRef: "奥德里克",
      name: "守墓人",
    });
    expect(first.ok).toBe(true);

    const second = await playerRecognizeIdentity(handle.db, created.game.slug, "无名者", {
      targetActorRef: "奥德里克",
      name: "灰衣人",
    });
    expect(second.ok).toBe(true);

    const after = await getGameState(handle.db, created.game.slug);
    const nameless = after.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "无名者");
    const odric = after.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "奥德里克");
    expect(
      after.signatureNames.find(
        (row) => row.observerActorId === nameless?.id && row.signatureId === odric?.signature.id,
      ),
    ).toMatchObject({ name: "灰衣人", source: "self" });

    // 当前名字就是唯一的 actor-facing 名字；真名不会自动成立。
    const stage = after.world.stages.find((candidate) =>
      candidate.actors.some((actor) => actor.id === nameless?.id),
    );
    if (!nameless || !odric || !stage) {
      throw new Error("缺少墓园夹具");
    }
    const address = addressLookupFor(after, nameless, stage);
    expect(address(odric.id).token).toBe("灰衣人");
    await expect(
      resolveVisibleActor(handle.db, {
        gameId: after.game.id,
        observerId: nameless.id,
        stageId: stage.id,
        ref: "灰衣人",
      }),
    ).resolves.toMatchObject({ id: odric.id });
    await expect(
      resolveVisibleActor(handle.db, {
        gameId: after.game.id,
        observerId: nameless.id,
        stageId: stage.id,
        ref: "奥德里克",
      }),
    ).rejects.toThrow(/找不到这个引用/);
  });

  it("bumps the version for a name-only plan without adding a public message", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "认知版本测试局",
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "无名者");
    await playerMove(handle.db, created.game.slug, "无名者", {
      targetStageRef: "墓园",
    });

    const before = await getGameState(handle.db, created.game.slug);
    const turn = await playerRecognizeIdentity(handle.db, created.game.slug, "无名者", {
      targetActorRef: "奥德里克",
      name: "灰衣人",
    });
    expect(turn.ok).toBe(true);

    // 名字表在状态里，所以这是一次写：版本必须动，公共事件流不动。
    const after = await getGameState(handle.db, created.game.slug);
    expect(after.game.version).toBe(before.game.version + 1);
    expect(Date.parse(after.game.updatedAt)).toBeGreaterThan(Date.parse(before.game.updatedAt));
    expect(after.messages.length).toBe(before.messages.length);
  });

  it("counts one version bump when a plan carries both an action and a name", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "认知与动作同轮测试局",
      world: BELL_MONASTERY_WORLD,
    });
    await takeActorControl(handle.db, created.game.slug, "无名者");
    await playerMove(handle.db, created.game.slug, "无名者", {
      targetStageRef: "墓园",
    });

    const { state, actor: nameless } = await actorByName(created.game.slug, handle, "无名者");
    const odric = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "奥德里克");
    if (!odric) {
      throw new Error("缺少奥德里克");
    }

    const plan: ActorPlan = {
      actions: [{ kind: "wait" }],
      identities: [{ handle: handleOf(odric.signature.seq), name: "灰衣人" }],
    };
    const turn = await settleActorPlan(handle.db, state.game.id, nameless.id, plan, true);
    expect(turn.ok).toBe(true);

    // 动作自己已经 bump 过了，认知更新不重复计一次。
    const after = await getGameState(handle.db, created.game.slug);
    expect(after.game.version).toBe(state.game.version + 1);
    expect(
      after.signatureNames.find(
        (row) => row.observerActorId === nameless.id && row.signatureId === odric.signature.id,
      ),
    ).toMatchObject({ name: "灰衣人", source: "self" });
  });

  it("stops using a name after a signature change, and restores on switch back", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "签名切换识别测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const { actor: odric } = await actorByName(created.game.slug, handle, "奥德里克");

    let maskedId = "";
    await handle.db.transaction(async (tx) => {
      maskedId = randomUUID();
      await insertSignature(tx, {
        id: maskedId,
        seq: await allocateEntitySeq(tx, created.game.id),
        actorId: odric.id,
        form: formatForm("人类", "蒙着面，只露出眼睛"),
        endedAt: new Date(),
      });
      await switchCurrentSignature(tx, odric.id, maskedId, new Date());
      await recordAppearance(tx, {
        gameId: created.game.id,
        actorId: odric.id,
        text: "一个蒙面人，斗篷把身形盖得严严实实。",
        input: {
          source: "seed",
          contentKey: "test",
          contentVersion: "test",
          actorKey: "odric",
          form: formatForm("人类", "蒙着面，只露出眼睛"),
          fallback: false,
        },
        now: new Date(),
      });
    });

    const masked = await getGameState(handle.db, created.game.slug);
    const cinder = masked.world.stages
      .flatMap((stage) => stage.actors)
      .find((candidate) => candidate.name === "小狗“煤渣”");
    const stage = masked.world.stages.find((candidate) =>
      candidate.actors.some((other) => other.id === cinder?.id),
    );
    if (!cinder || !stage) {
      throw new Error("缺少煤渣");
    }
    const maskedView = buildActorTurnInput(masked, { actor: cinder, stage });
    expect(maskedView).not.toContain("奥德里克");
    expect(maskedView).toContain("一个蒙面人");

    await handle.db.transaction(async (tx) => {
      await switchCurrentSignature(tx, odric.id, odric.signature.id, new Date());
    });
    const restored = await getGameState(handle.db, created.game.slug);
    const cinderBack = restored.world.stages
      .flatMap((candidate) => candidate.actors)
      .find((candidate) => candidate.name === "小狗“煤渣”");
    const stageBack = restored.world.stages.find((candidate) =>
      candidate.actors.some((other) => other.id === cinderBack?.id),
    );
    if (!cinderBack || !stageBack) {
      throw new Error("缺少煤渣");
    }
    expect(buildActorTurnInput(restored, { actor: cinderBack, stage: stageBack })).toContain(
      "奥德里克",
    );
  });

  it("lets god-view callers target by canonical name or handle", async () => {
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

    // 两种寻址方式成立：真名与签名引用；id 不再是 actor 检索入口。
    for (const ref of [monk.name, handleOf(monk.signature.seq)]) {
      const said = await playerSay(
        handle.db,
        created.game.slug,
        "守烬人",
        {
          targetActorRef: ref,
          message: "测试寻址。",
        },
        { judge: allowAllDialogue },
      );
      expect(said.ok).toBe(true);
    }
    // 幂等：三条消息都进了公共事件流，客户端可以按 id 反查实体。
    const after = await getGameState(handle.db, created.game.slug);
    const targets = after.messages.filter((message) => message.kind === "say");
    expect(targets).toHaveLength(2);
    expect(targets.every((message) => message.targetActorId === monk.id)).toBe(true);
  });

  it("lets speech use names but still rejects handle placeholders", () => {
    expect(() =>
      parseSay({ mind: "试探", targetActorHandle: "守烬人", message: "你是守烬人？" }),
    ).not.toThrow();
    expect(() =>
      parseWhisper({ mind: "试探", targetActorHandle: "守烬人", message: "灰烬门廊见。" }),
    ).not.toThrow();
    expect(() => parseAnnounce({ mind: "宣布", message: "裂齿短刃在我手里。" })).not.toThrow();
    // 称呼是角色会说的话；编号是系统占位，说出口就污染世界面。
    expect(() =>
      parseSay({ mind: "试探", targetActorHandle: "守烬人", message: "编号是 #3。" }),
    ).toThrow(/编号引用/);
  });

  it("records as many signature names as the plan carries, and keeps the last one per handle", async () => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "多名认知测试局",
      world: BELL_MONASTERY_WORLD,
    });
    const state = await getGameState(handle.db, created.game.slug);
    const actors = state.world.stages.flatMap((stage) => stage.actors);
    const odric = actors.find((candidate) => candidate.name === "奥德里克");
    const cinder = actors.find((candidate) => candidate.name === "小狗“煤渣”");
    const badLuck = actors.find((candidate) => candidate.name === "小鼠“坏运气”");
    if (!odric || !cinder || !badLuck) {
      throw new Error("缺少开局角色");
    }

    // 一份计划里给同场景两个角色起名，且奥德里克出现两次：后一次覆盖前一次。
    const plan: ActorPlan = {
      actions: [],
      identities: [
        { handle: handleOf(odric.signature.seq), name: "守墓人" },
        { handle: handleOf(badLuck.signature.seq), name: "小东西" },
        { handle: handleOf(odric.signature.seq), name: "灰衣人" },
      ],
    };
    const result = await settleActorPlan(handle.db, created.game.id, cinder.id, plan, true);
    expect(result.ok).toBe(true);

    const after = await getGameState(handle.db, created.game.slug);
    const names = after.signatureNames.filter((row) => row.observerActorId === cinder.id);
    expect(names).toHaveLength(2);
    expect(names.every((row) => row.source === "self")).toBe(true);
    expect(names.find((row) => row.signatureId === odric.signature.id)).toMatchObject({
      name: "灰衣人",
    });

    // 只有名字更新的计划不产生公共事件。
    expect(after.messages).toEqual([]);
  });

  it("parses identity bindings by anonymous handle and rejects marker-shaped names", () => {
    expect(() => parseRecognizeIdentity({ handle: "#3", name: "编号 #3" })).toThrow(/不能包含 #/);
    expect(() => parseRecognizeIdentity({ handle: "#3", name: "" })).toThrow(/name/);
    expect(() => parseRecognizeIdentity({ handle: "3", name: "守钟人" })).toThrow(/匿名编号/);
    expect(parseRecognizeIdentity({ handle: "#3", name: "守钟人" })).toEqual({
      handle: "#3",
      name: "守钟人",
    });
  });
});
