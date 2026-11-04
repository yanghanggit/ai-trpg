import { describe, expect, it } from "vitest";
import { buildAffixPrompt } from "../src/game/affixes";
import { buildCompactionInput } from "../src/game/compact";
import { buildDropTurnInput } from "../src/game/drops";
import {
  buildActorSystemPrompt,
  buildStageSystemPrompt,
  buildWorldSystemPrompt,
} from "../src/game/memory";
import { buildStoryInput } from "../src/game/story";
import type { ActorState, GameState, StageState } from "../src/game/types";
import { TEST_WORLD } from "./test-world";

/**
 * 运行时 agent 的世界宪法注入。
 *
 * 约束一：凡是会产出世界面文本或改写长期记忆的运行时 agent，都必须拿到该局的
 * campaignSetting 与 globalRules——带 memory 的实体由 system prompt 携带，世界职能
 * 由各自的宪法携带。
 * 约束二：世界职能的任务提示词只放本轮事实，内容一律不进任务层。
 */

const WORLD = {
  name: TEST_WORLD.worldName,
  campaignSetting: TEST_WORLD.campaignSetting,
  globalRules: TEST_WORLD.globalRules,
  functionAgents: TEST_WORLD.functionAgents,
};

const ACTOR = {
  name: "守烬人",
  appearance: "斗篷边缘被烧焦，脸上覆着一层洗不净的灰。",
  signature: { id: "signature-1", seq: 1, form: TEST_WORLD.actors[0]?.signature.form },
} as unknown as ActorState;

const STAGE = {
  name: "灰烬门廊",
  environment: "风从破窗灌入，灰烬像雪一样落在石阶上。",
} as unknown as StageState;

const GAME_STATE = {
  game: {
    name: "注入测试局",
    slug: "injection-test",
    status: "active",
    contentVersion: TEST_WORLD.contentVersion,
    version: 1,
  },
  world: WORLD,
} as unknown as GameState;

const STATS = { maxHp: 10, strength: 4, wisdom: 2, agility: 3, damage: 5, block: 1 };

describe("runtime agents carry the campaign setting", () => {
  it("世界职能 agent 的宪法携带设定、规则与自己的口径", () => {
    for (const fn of ["drops", "affixes", "story", "compact", "dialogueAudit"] as const) {
      const prompt = WORLD.functionAgents.find((agent) => agent.fn === fn)?.systemPrompt ?? "";
      expect(prompt).toContain(TEST_WORLD.campaignSetting);
      expect(prompt).toContain(TEST_WORLD.globalRules);
    }
  });

  it("掉落任务提示词只放本轮事实", () => {
    const prompt = buildDropTurnInput(ACTOR, STAGE);
    expect(prompt).not.toContain(TEST_WORLD.campaignSetting);
  });

  it("词缀结算", () => {
    const prompt = buildAffixPrompt({
      actorName: "守烬人",
      actorStats: STATS,
      itemName: "裂齿短刃",
      itemDescription: "刃口缺了两处，血槽里嵌着旧锈。",
      itemStats: STATS,
      affixes: [{ name: "嗜血", content: "见到血时伤害提高。" }],
      defaultFeedback: "裂齿短刃劈开了石阶上的灰。",
      terminalToolName: "submit_affix",
      stageName: "灰烬门廊",
    });
    expect(prompt).not.toContain(TEST_WORLD.campaignSetting);
  });

  it("故事整理与记忆压缩的任务提示词只放本轮事实", () => {
    expect(buildStoryInput(GAME_STATE, [])).not.toContain(TEST_WORLD.campaignSetting);
    expect(
      buildCompactionInput(
        { ownerType: "actor", ownerId: "actor-1", ownerName: "守烬人" },
        "[human] 一条待压缩的记忆。",
      ),
    ).not.toContain(TEST_WORLD.campaignSetting);
  });

  it("带 memory 的 actor / stage / world 由 system prompt 自带设定", () => {
    const actor = TEST_WORLD.actors[0];
    const stage = TEST_WORLD.stages[0];
    if (!actor || !stage) {
      throw new Error("TEST_WORLD 缺少 actor 或 stage");
    }
    const world = { id: "world-1", ...WORLD, globalRules: TEST_WORLD.globalRules };

    expect(buildActorSystemPrompt(world, { ...actor, form: actor.signature.form })).toContain(
      TEST_WORLD.campaignSetting,
    );
    expect(buildStageSystemPrompt(world, stage)).toContain(TEST_WORLD.campaignSetting);
    expect(
      buildWorldSystemPrompt({
        ...WORLD,
        worldName: TEST_WORLD.worldName,
        profile: TEST_WORLD.profile,
        globalRules: TEST_WORLD.globalRules,
      }),
    ).toContain(TEST_WORLD.campaignSetting);
  });
});
