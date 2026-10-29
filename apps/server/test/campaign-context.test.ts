import { describe, expect, it } from "vitest";
import { buildCampaignSettingBlock } from "../src/game/campaign-context";
import { buildCompactionInput } from "../src/game/compact";
import { buildDropTurnInput } from "../src/game/drops";
import { buildAffixPrompt } from "../src/game/item-effects/affix-agent";
import {
  buildActorSystemPrompt,
  buildStageSystemPrompt,
  buildWorldSystemPrompt,
} from "../src/game/memory";
import { buildStoryInput } from "../src/game/story";
import type { ActorState, GameState, StageState } from "../src/game/types";
import { TEST_WORLD } from "./test-world";

/**
 * 运行时 agent 的世界设定注入。
 *
 * 约束：凡是会产出世界面文本或改写长期记忆的运行时 agent，都必须把该局的
 * campaignSetting 拿到手。带 memory 的 actor / stage / world（以及复用其
 * memory 的外观与探针）由 system prompt 携带；无 memory 或自建 system 的
 * 掉落 / 词缀 / 故事 / 压缩按任务上下文注入。
 */

const WORLD = {
  name: TEST_WORLD.worldName,
  campaignSetting: TEST_WORLD.campaignSetting,
};

const ACTOR = {
  name: "守烬人",
  appearance: "斗篷边缘被烧焦，脸上覆着一层洗不净的灰。",
  baseBody: TEST_WORLD.actors[0]?.baseBody,
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

describe("campaign setting block", () => {
  it("包含世界名、战役设定与本任务用途", () => {
    const block = buildCampaignSettingBlock(WORLD, { purpose: "只用于保持术语一致。" });
    expect(block).toContain("## 世界设定");
    expect(block).toContain(TEST_WORLD.worldName);
    expect(block).toContain(TEST_WORLD.campaignSetting);
    expect(block).toContain("只用于保持术语一致。");
  });
});

describe("runtime agents carry the campaign setting", () => {
  it("掉落推理", () => {
    const prompt = buildDropTurnInput(ACTOR, STAGE, WORLD);
    expect(prompt).toContain(TEST_WORLD.campaignSetting);
  });

  it("词缀结算", () => {
    const prompt = buildAffixPrompt({
      world: WORLD,
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
    expect(prompt).toContain(TEST_WORLD.campaignSetting);
  });

  it("故事整理", () => {
    const prompt = buildStoryInput(GAME_STATE, []);
    expect(prompt).toContain(TEST_WORLD.campaignSetting);
  });

  it("记忆压缩", () => {
    const prompt = buildCompactionInput(
      { ownerType: "actor", ownerId: "actor-1", ownerName: "守烬人" },
      "[human] 一条待压缩的记忆。",
      WORLD,
    );
    expect(prompt).toContain(TEST_WORLD.campaignSetting);
  });

  it("带 memory 的 actor / stage / world 由 system prompt 自带设定", () => {
    const actor = TEST_WORLD.actors[0];
    const stage = TEST_WORLD.stages[0];
    if (!actor || !stage) {
      throw new Error("TEST_WORLD 缺少 actor 或 stage");
    }
    const world = { id: "world-1", ...WORLD, systemRules: TEST_WORLD.systemRules };

    expect(buildActorSystemPrompt(world, actor)).toContain(TEST_WORLD.campaignSetting);
    expect(buildStageSystemPrompt(world, stage)).toContain(TEST_WORLD.campaignSetting);
    expect(
      buildWorldSystemPrompt({
        ...WORLD,
        worldName: TEST_WORLD.worldName,
        profile: TEST_WORLD.profile,
        systemRules: TEST_WORLD.systemRules,
      }),
    ).toContain(TEST_WORLD.campaignSetting);
  });
});
