import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getGameMemories,
  getGameState,
  playerCall,
  takeActorControl,
} from "../src/game";
import type { World } from "../src/game/types";
import { allowAllDialogue } from "./test-dialogue-judge";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

function callWorld(targetKnowsSource = true): World {
  return {
    ...TEST_WORLD,
    contentVersion: "test-call.v1",
    ...(targetKnowsSource
      ? {}
      : {
          signatureNames: (TEST_WORLD.signatureNames ?? []).filter(
            (edge) => !(edge.observer === "silent-scribe" && edge.subject === "ember-keeper"),
          ),
        }),
    actors: TEST_WORLD.actors.map((actor) =>
      actor.key === "ember-keeper" || actor.key === "silent-scribe"
        ? { ...actor, actions: [...actor.actions, "call" as const] }
        : actor,
    ),
  };
}

describe.skipIf(!testDatabaseUrl)("cross-stage call", () => {
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

  const createControlledGame = async (name: string, world: World) => {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name,
      world,
    });
    await takeActorControl(handle.db, created.game.slug, "守烬人");
    return created;
  };

  it("requires a true name, delivers only to an actor in another stage, and records the call", async () => {
    const created = await createControlledGame("跨场景传音测试局", callWorld());
    const result = await playerCall(
      handle.db,
      created.game.slug,
      "守烬人",
      { targetActorName: "缄默抄经人", message: "钟声还在响吗？" },
      { judge: allowAllDialogue },
    );
    expect(result.ok).toBe(true);

    const state = await getGameState(handle.db, created.game.slug);
    const target = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "缄默抄经人");
    const targetStage = state.world.stages.find((stage) => stage.key === "nave");
    expect(target).toBeDefined();
    expect(targetStage).toBeDefined();
    expect(state.game.version).toBe(1);
    expect(state.messages.at(-1)).toMatchObject({
      kind: "call",
      sourceActorId: null,
      visibility: "private",
      stageId: targetStage?.id,
      targetActorId: target?.id,
    });
    expect(state.messages.at(-1)?.content).not.toContain("守烬人");

    const memories = await getGameMemories(handle.db, created.game.id);
    const keeper = memories.find((memory) => memory.name === "守烬人");
    const scribe = memories.find((memory) => memory.name === "缄默抄经人");
    const monk = memories.find((memory) => memory.name === "提灯修士");
    expect(
      scribe?.messages.some((message) => message.content.includes("一个声音隔空对你说话")),
    ).toBe(true);
    expect(scribe?.messages.some((message) => message.content.includes("钟声还在响吗？"))).toBe(
      true,
    );
    expect(scribe?.messages.some((message) => message.content.includes("守烬人"))).toBe(false);
    const feedback = keeper?.messages.find((message) =>
      message.content.includes("你把话传到了对方那里"),
    );
    expect(feedback?.content).not.toBeUndefined();
    expect(feedback?.content).not.toContain("断钟中殿");
    expect(monk?.messages.some((message) => message.content.includes("隔空对你说话"))).toBe(false);
  });

  it("does not expose the initiator in target memory when the message does not name them", async () => {
    const created = await createControlledGame("跨场景传音匿名来源测试局", callWorld(false));
    await playerCall(
      handle.db,
      created.game.slug,
      "守烬人",
      { targetActorName: "缄默抄经人", message: "听得见吗？" },
      { judge: allowAllDialogue },
    );
    const memories = await getGameMemories(handle.db, created.game.id);
    const scribe = memories.find((memory) => memory.name === "缄默抄经人");
    const callObservation = scribe?.messages.find((message) =>
      message.content.includes("隔空对你说话"),
    );
    expect(callObservation?.content).toContain("一个声音");
    expect(callObservation?.content).not.toContain("守烬人");
    expect(callObservation?.metadata).not.toHaveProperty("sourceActorId");
  });

  it("requires the target to have call ability too", async () => {
    const base = callWorld();
    const world: World = {
      ...base,
      actors: base.actors.map((actor) =>
        actor.key === "silent-scribe"
          ? { ...actor, actions: actor.actions.filter((kind) => kind !== "call") }
          : actor,
      ),
    };
    const created = await createControlledGame("跨场景传音目标权限测试局", world);
    await expect(
      playerCall(
        handle.db,
        created.game.slug,
        "守烬人",
        { targetActorName: "缄默抄经人", message: "你听得见吗？" },
        { judge: allowAllDialogue },
      ),
    ).rejects.toThrow(/目标没有传音能力/);
  });

  it("keeps the spoken self-name in the source feedback instead of turning it into a reference", async () => {
    const created = await createControlledGame("跨场景传音台词保留测试局", callWorld());
    await playerCall(
      handle.db,
      created.game.slug,
      "守烬人",
      { targetActorName: "缄默抄经人", message: "我是守烬人。听得到吗？" },
      { judge: allowAllDialogue },
    );
    const memories = await getGameMemories(handle.db, created.game.id);
    const keeper = memories.find((memory) => memory.name === "守烬人");
    const feedback = keeper?.messages.find((message) =>
      message.content.includes("你把话传到了对方那里"),
    );
    expect(feedback?.content).toContain("我是守烬人。听得到吗？");
    expect(feedback?.content).not.toContain("我是@守烬人");
    expect(feedback?.content).not.toContain("断钟中殿");
  });

  it("rejects @ references and same-stage targets", async () => {
    const created = await createControlledGame("跨场景传音拒绝测试局", callWorld());
    await expect(
      playerCall(
        handle.db,
        created.game.slug,
        "守烬人",
        { targetActorName: "@缄默抄经人", message: "给我一个名字。" },
        { judge: allowAllDialogue },
      ),
    ).rejects.toThrow(/必须使用真名/);

    await expect(
      playerCall(
        handle.db,
        created.game.slug,
        "守烬人",
        { targetActorName: "提灯修士", message: "就在眼前。" },
        { judge: allowAllDialogue },
      ),
    ).rejects.toThrow(/只能对不在当前场景/);

    const state = await getGameState(handle.db, created.game.slug);
    expect(state.game.version).toBe(0);
    expect(state.messages).toEqual([]);
  });

  it("requires the call action", async () => {
    const created = await createControlledGame("跨场景传音权限测试局", TEST_WORLD);
    await expect(
      playerCall(
        handle.db,
        created.game.slug,
        "守烬人",
        { targetActorName: "缄默抄经人", message: "不应到达。" },
        { judge: allowAllDialogue },
      ),
    ).rejects.toThrow(/不能使用动作: call/);
  });
});
