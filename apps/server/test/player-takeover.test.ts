import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_USER } from "../src/db/demo-fixture";
import { allowAllDialogue } from "./test-dialogue-judge";
import { TEST_WORLD } from "./test-world";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getGameMemories,
  getGameState,
  isPlayerControlled,
  playerAnnounce,
  playerMove,
  playerSay,
  playerStrike,
  playerWhisper,
  releaseActorControl,
  runNpcTurn,
  takeActorControl,
} from "../src/game";
import type { ChatCompletionService } from "../src/llm";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

const ALL_GATE_WORLD = {
  ...TEST_WORLD,
  actors: TEST_WORLD.actors.map((actor) => ({ ...actor, stageKey: "gate" })),
};

const NEVER_CALLED_SERVICE: ChatCompletionService = {
  complete: async () => {
    throw new Error("被玩家接管的 actor 不应该调用 LLM");
  },
};

describe.skipIf(!testDatabaseUrl)("player takeover", () => {
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

  it("lets a player control one actor and use all three communication actions", async () => {
    const game = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "玩家接管测试局",
      world: ALL_GATE_WORLD,
    });

    const control = await takeActorControl(handle.db, game.game.slug, "守烬人");
    expect(control.actorId).toBeTruthy();
    expect(await isPlayerControlled(handle.db, game.game.id, control.actorId)).toBe(true);

    await expect(
      runNpcTurn(handle.db, game.game.slug, "守烬人", {
        service: NEVER_CALLED_SERVICE,
      }),
    ).rejects.toThrow("已被玩家接管");

    const said = await playerSay(
      handle.db,
      game.game.slug,
      "守烬人",
      {
        targetActorRef: "提灯修士",
        message: "公开对你说。",
        reason: "先确认他是否听见钟声。",
      },
      { judge: allowAllDialogue },
    );
    expect(said.ok).toBe(true);
    expect(said.plan?.actions[0]).toMatchObject({
      kind: "say",
      mind: "先确认他是否听见钟声。",
    });

    const whispered = await playerWhisper(
      handle.db,
      game.game.slug,
      "守烬人",
      {
        targetActorRef: "提灯修士",
        message: "这是一句秘密。",
      },
      { judge: allowAllDialogue },
    );
    expect(whispered.ok).toBe(true);

    const announced = await playerAnnounce(
      handle.db,
      game.game.slug,
      "守烬人",
      {
        message: "所有人都听着。",
      },
      { judge: allowAllDialogue },
    );
    expect(announced.ok).toBe(true);

    const state = await getGameState(handle.db, game.game.slug);
    expect(state.game.version).toBe(3);
    expect(state.messages.map((message) => message.kind)).toEqual(["say", "whisper", "announce"]);
    expect(state.messages[0]?.targetActorId).toBeTruthy();
    expect(state.messages[0]?.visibility).toBe("stage");
    expect(state.messages[1]?.targetActorId).toBeTruthy();
    expect(state.messages[1]?.visibility).toBe("private");
    expect(state.messages[2]?.targetActorId).toBeNull();
    expect(state.messages[2]?.visibility).toBe("stage");

    const memories = await getGameMemories(handle.db, game.game.id);
    const keeper = memories.find((memory) => memory.name === "守烬人");
    const monk = memories.find((memory) => memory.name === "提灯修士");
    const scribe = memories.find((memory) => memory.name === "缄默抄经人");

    expect(keeper?.messages.some((message) => message.content.includes("你对@提灯修士说"))).toBe(
      true,
    );
    expect(monk?.messages.some((message) => message.content.includes("@守烬人对你说"))).toBe(true);
    expect(
      scribe?.messages.some((message) => message.content.includes("@守烬人对@提灯修士说")),
    ).toBe(true);

    expect(monk?.messages.some((message) => message.content.includes("这是一句秘密。"))).toBe(true);
    expect(scribe?.messages.some((message) => message.content.includes("这是一句秘密。"))).toBe(
      false,
    );

    expect(keeper?.messages.some((message) => message.content.includes("公开说"))).toBe(true);
    expect(scribe?.messages.some((message) => message.content.includes("所有人都听着。"))).toBe(
      true,
    );

    await releaseActorControl(handle.db, game.game.slug, "守烬人");
    expect(await isPlayerControlled(handle.db, game.game.id, control.actorId)).toBe(false);
  });

  it("lets a controlled actor move to an adjacent stage", async () => {
    const game = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "玩家移动测试局",
      world: ALL_GATE_WORLD,
    });
    await takeActorControl(handle.db, game.game.slug, "守烬人");

    const moved = await playerMove(handle.db, game.game.slug, "守烬人", {
      targetStageRef: "断钟中殿",
    });
    expect(moved.ok).toBe(true);
    expect(moved.plan?.actions[0]).toMatchObject({
      kind: "move",
      targetStageName: "断钟中殿",
    });

    const state = await getGameState(handle.db, game.game.slug);
    expect(state.messages.map((message) => message.kind)).toEqual(["move"]);
    const keeperStage = state.world.stages.find((stage) =>
      stage.actors.some((actor) => actor.name === "守烬人"),
    );
    expect(keeperStage?.name).toBe("断钟中殿");
  });

  it("lets a controlled actor strike", async () => {
    const game = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: "玩家攻击测试局",
      world: ALL_GATE_WORLD,
    });
    await takeActorControl(handle.db, game.game.slug, "守烬人");

    const attacked = await playerStrike(handle.db, game.game.slug, "守烬人", {
      targetActorRef: "提灯修士",
    });
    expect(attacked.ok).toBe(true);
    expect(attacked.plan?.actions[0]).toMatchObject({
      kind: "strike",
      targetActorHandle: "提灯修士",
    });

    const state = await getGameState(handle.db, game.game.slug);
    expect(state.game.version).toBe(1);
    expect(state.messages.map((message) => message.kind)).toEqual(["strike"]);
    const monk = state.world.stages
      .flatMap((stage) => stage.actors)
      .find((actor) => actor.name === "提灯修士");
    // 6（自身 damage）+ 3（已装备的裂齿短刃）- 3（修士 block）= 6 点伤害。
    expect(monk?.hp).toBe(4);
  });
});
