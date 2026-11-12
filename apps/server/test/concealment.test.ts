import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import type { DatabaseHandle } from "../src/db/connect";
import { openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import {
  createGame,
  getActorView,
  getGameMemories,
  getGameState,
  playerCall,
  playerHide,
  playerInspect,
  playerMove,
  playerReveal,
  playerSay,
  playerSteal,
  playerWhisper,
  takeActorControl,
} from "../src/game";
import { describeSelf, describeStageForActor } from "../src/game/agents/actor-turn";
import { declareDeath } from "../src/game/agents/death/declare";
import { buildStageTurnInput } from "../src/game/agents/stage-turn";
import { damageActor } from "../src/game/persistence/actors";
import type { World } from "../src/game/world-definition";
import { buildActorTurnInput } from "./actor-turn-input";
import { TEST_WORLD } from "./test-world";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

/** 测试局：抄经人开局隐匿；给守烬人一枚可偷的铜币；敏捷可调用来覆盖察觉。 */
function worldWith(options: { scribeAgility?: number } = {}): World {
  return {
    ...TEST_WORLD,
    contentVersion: "test-concealment.v1",
    actors: TEST_WORLD.actors.map((actor) => {
      if (actor.key === "silent-scribe") {
        return {
          ...actor,
          concealed: true,
          stats: { ...actor.stats, agility: options.scribeAgility ?? 4 },
          actions: ["steal", "inspect", "call", ...actor.actions, "hide", "reveal"],
        };
      }
      if (actor.key === "ember-keeper") {
        return {
          ...actor,
          actions: ["call", ...actor.actions, "hide", "reveal"],
          inventory: [
            ...actor.inventory,
            {
              key: "old-coin",
              name: "旧铜币",
              description: "一枚磨得发亮的旧铜币，边缘缺了一角。",
              kind: "valuable" as const,
              count: 1,
            },
          ],
        };
      }
      return actor;
    }),
  };
}

function memoriesOf(memories: Awaited<ReturnType<typeof getGameMemories>>, name: string): string {
  return (
    memories
      .find((memory) => memory.name === name)
      ?.messages.map((message) => message.content)
      .join("\n") ?? ""
  );
}

function actorIn(state: Awaited<ReturnType<typeof getGameState>>, name: string) {
  const found = state.world.stages.flatMap((stage) => stage.actors).find((a) => a.name === name);
  if (!found) {
    throw new Error(`缺少 actor: ${name}`);
  }
  return found;
}

function stageOf(state: Awaited<ReturnType<typeof getGameState>>, stageName: string) {
  const found = state.world.stages.find((stage) => stage.name === stageName);
  if (!found) {
    throw new Error(`缺少舞台: ${stageName}`);
  }
  return found;
}

describe.skipIf(!testDatabaseUrl)("concealment", () => {
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

  async function create(options: { scribeAgility?: number } = {}) {
    const created = await createGame(handle.db, {
      username: DEMO_USER.username,
      name: `隐匿测试局-${Math.random().toString(36).slice(2, 8)}`,
      world: worldWith(options),
    });
    await Promise.all([
      takeActorControl(handle.db, created.game.slug, "守烬人"),
      takeActorControl(handle.db, created.game.slug, "缄默抄经人"),
      takeActorControl(handle.db, created.game.slug, "提灯修士"),
    ]);
    return created.game.slug;
  }

  /** 把守烬人移到中殿，与隐匿的抄经人同场；提灯修士可一起移过去当旁观者。 */
  async function gather(slug: string, withLantern = false) {
    await playerMove(handle.db, slug, "守烬人", { targetStageRef: "断钟中殿" });
    if (withLantern) {
      await playerMove(handle.db, slug, "提灯修士", { targetStageRef: "断钟中殿" });
    }
  }

  it("隐匿者不进名单、不可被指向，但自己仍看得见别人", async () => {
    const slug = await create();
    await playerMove(handle.db, slug, "守烬人", { targetStageRef: "断钟中殿" });
    const state = await getGameState(handle.db, slug);
    const nave = stageOf(state, "断钟中殿");
    const ember = actorIn(state, "守烬人");
    const scribe = actorIn(state, "缄默抄经人");

    expect(scribe.concealed).toBe(true);
    expect(buildActorTurnInput(state, { actor: ember, stage: nave })).not.toContain("缄默抄经人");
    expect(describeStageForActor(state, { actor: ember, stage: nave })).not.toContain("缄默抄经人");
    expect(describeSelf(scribe)).toContain("（隐匿）");
    // 隐匿只影响旁人如何看它；它自己仍看得见同场的人。
    expect(buildActorTurnInput(state, { actor: scribe, stage: nave })).toContain("守烬人");
    expect(actorIn(state, "提灯修士").concealed).toBe(false);

    const view = await getActorView(handle.db, slug, "守烬人");
    expect(view.stage?.actors.map((actor) => actor.actorId)).not.toContain(scribe.id);

    // 名字指向被隐匿者时按「找不到」拒绝，不确认他在这里。
    await expect(
      playerSay(handle.db, slug, "守烬人", {
        targetActorRef: "缄默抄经人",
        message: "出来。",
      }),
    ).rejects.toThrow("找不到");
    await expect(
      playerSay(handle.db, slug, "守烬人", {
        targetActorRef: `#${scribe.signature.seq}`,
        message: "出来。",
      }),
    ).rejects.toThrow("找不到");
  });

  it("说话自动先现身，只追加一次反馈，之后进名单", async () => {
    const slug = await create();
    await gather(slug);
    const result = await playerSay(handle.db, slug, "缄默抄经人", {
      targetActorRef: "守烬人",
      message: "别动。",
    });
    expect(result.ok).toBe(true);

    const state = await getGameState(handle.db, slug);
    const nave = stageOf(state, "断钟中殿");
    expect(actorIn(state, "缄默抄经人").concealed).toBe(false);
    expect(buildActorTurnInput(state, { actor: actorIn(state, "守烬人"), stage: nave })).toContain(
      "缄默抄经人",
    );

    const memories = await getGameMemories(handle.db, state.game.id);
    const own = memoriesOf(memories, "缄默抄经人");
    expect(own).toContain("你从暗处现身了");
    expect(own.match(/你从暗处现身了/g)).toHaveLength(1);
    expect(memoriesOf(memories, "守烬人")).toContain("别动。");
  });

  it("耳语会先现身：目标听见耳语，旁观者看到现身事件", async () => {
    const slug = await create();
    await gather(slug, true);
    const result = await playerWhisper(handle.db, slug, "缄默抄经人", {
      targetActorRef: "守烬人",
      message: "有人在等你。",
    });
    expect(result.ok).toBe(true);

    const state = await getGameState(handle.db, slug);
    const memories = await getGameMemories(handle.db, state.game.id);
    const target = memoriesOf(memories, "守烬人");
    expect(target).toContain("有人在等你。");
    expect(target).toContain("从暗处现身");
    const bystander = memoriesOf(memories, "提灯修士");
    expect(bystander).toContain("从暗处现身");
    expect(bystander).not.toContain("有人在等你。");
  });

  it("远端传话不破隐：目标听见，旁人看不到现身", async () => {
    const slug = await create();
    const result = await playerCall(handle.db, slug, "缄默抄经人", {
      targetActorName: "守烬人",
      message: "在门廊等我。",
    });
    expect(result.ok).toBe(true);
    const state = await getGameState(handle.db, slug);
    expect(actorIn(state, "缄默抄经人").concealed).toBe(true);
    const memories = await getGameMemories(handle.db, state.game.id);
    expect(memoriesOf(memories, "守烬人")).toContain("在门廊等我。");
    expect(memoriesOf(memories, "守烬人")).not.toContain("从暗处现身");
  });

  it("隐匿中查看被察觉时，只给目标匿名提示，仍保持隐匿", async () => {
    const slug = await create();
    await gather(slug);
    const result = await playerInspect(handle.db, slug, "缄默抄经人", {
      targetActorRef: "守烬人",
    });
    expect(result.ok).toBe(true);

    const state = await getGameState(handle.db, slug);
    expect(actorIn(state, "缄默抄经人").concealed).toBe(true);
    const memories = await getGameMemories(handle.db, state.game.id);
    const target = memoriesOf(memories, "守烬人");
    expect(target).toContain("有人翻看了你随身携带的东西");
    expect(target).not.toContain("缄默抄经人");
  });

  it("窃取被察觉才现身；未被察觉时保持隐匿", async () => {
    const noticedSlug = await create();
    await gather(noticedSlug);
    const noticed = await playerSteal(handle.db, noticedSlug, "缄默抄经人", {
      targetActorRef: "守烬人",
      itemName: "旧铜币",
    });
    expect(noticed.ok).toBe(true);
    const noticedState = await getGameState(handle.db, noticedSlug);
    expect(actorIn(noticedState, "缄默抄经人").concealed).toBe(false);

    // 比目标敏捷时不会察觉，也就继续隐匿。
    const quietSlug = await create({ scribeAgility: 10 });
    await gather(quietSlug);
    const quiet = await playerSteal(handle.db, quietSlug, "缄默抄经人", {
      targetActorRef: "守烬人",
      itemName: "旧铜币",
    });
    expect(quiet.ok).toBe(true);
    const quietState = await getGameState(handle.db, quietSlug);
    expect(actorIn(quietState, "缄默抄经人").concealed).toBe(true);
    const quietMemories = await getGameMemories(handle.db, quietState.game.id);
    expect(memoriesOf(quietMemories, "守烬人")).not.toContain("取走了");
  });

  it("隐匿移动不写旁人观察；之后可重新隐匿与主动现身", async () => {
    const slug = await create();
    await playerMove(handle.db, slug, "缄默抄经人", { targetStageRef: "灰烬门廊" });

    const state = await getGameState(handle.db, slug);
    const gate = stageOf(state, "灰烬门廊");
    expect(actorIn(state, "缄默抄经人").concealed).toBe(true);
    expect(
      buildActorTurnInput(state, { actor: actorIn(state, "守烬人"), stage: gate }),
    ).not.toContain("缄默抄经人");
    // 公共事件流仍是上帝视角：移动本身有记录，只是不进旁人记忆。
    expect(
      state.messages.some((message) =>
        message.content.includes("缄默抄经人从断钟中殿走向灰烬门廊"),
      ),
    ).toBe(true);
    const memories = await getGameMemories(handle.db, state.game.id);
    const emberMemory = memoriesOf(memories, "守烬人");
    expect(emberMemory).not.toContain("进入了灰烬门廊");
    expect(emberMemory).not.toContain("缄默抄经人");

    // 显式 hide 幂等；reveal 让旁人看见，随后还能再 hide。
    const hinted = await playerSay(handle.db, slug, "缄默抄经人", {
      targetActorRef: "守烬人",
      message: "我在这里。",
    });
    expect(hinted.ok).toBe(true);
    expect(actorIn(await getGameState(handle.db, slug), "缄默抄经人").concealed).toBe(false);

    const hidden = await playerHide(handle.db, slug, "缄默抄经人");
    expect(hidden.ok).toBe(true);
    expect(actorIn(await getGameState(handle.db, slug), "缄默抄经人").concealed).toBe(true);

    const revealed = await playerReveal(handle.db, slug, "缄默抄经人");
    expect(revealed.ok).toBe(true);
    expect(actorIn(await getGameState(handle.db, slug), "缄默抄经人").concealed).toBe(false);
  });

  it("死亡会解除隐匿：尸体必须能被发现", async () => {
    const slug = await create();
    await playerMove(handle.db, slug, "守烬人", { targetStageRef: "断钟中殿" });
    const state = await getGameState(handle.db, slug);
    const scribe = actorIn(state, "缄默抄经人");
    const stage = state.world.stages.find((candidate) =>
      candidate.actors.some((actor) => actor.id === scribe.id),
    );
    if (!stage) throw new Error("缺少舞台");
    await damageActor(handle.db, scribe.id, 999, new Date());
    const declared = await declareDeath(handle.db, state.game.id, {
      id: scribe.id,
      name: scribe.name,
      stageId: stage.id,
      isDefaultPlayer: false,
    });
    expect(declared).toBe(true);
    const after = await getGameState(handle.db, slug);
    expect(actorIn(after, "缄默抄经人").concealed).toBe(false);
    const memories = await getGameMemories(handle.db, state.game.id);
    expect(memoriesOf(memories, "守烬人")).toContain("倒下了");
  });

  it("舞台提示词把隐匿者放进独立区块，并禁止写进 environment", async () => {
    const slug = await create();
    const state = await getGameState(handle.db, slug);
    const nave = stageOf(state, "断钟中殿");
    const prompt = buildStageTurnInput(state, nave);
    expect(prompt).toContain("隐匿中的角色");
    expect(prompt).toContain("缄默抄经人（隐匿）");
    expect(prompt).toContain("不要写进 environment");
  });
});
