import { describe, expect, it } from "vitest";
import { BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";
import {
  buildActorSystemPrompt,
  buildStageSystemPrompt,
  buildWorldSystemPrompt,
} from "../src/game/memory";
import type { World } from "../src/game/types";
import { TEST_WORLD } from "./test-world";

/**
 * 工具名属于工具层：只出现在工具定义与本轮任务文本里。system prompt 与
 * openingBriefing 只写世界、身份与规则；工具会改名，内容不该跟着改。
 *
 * 工具名都是小写 snake_case，所以这里直接扫 System prompt 里的 snake_case 词：
 * 框架模板与内容注入都被覆盖，新增工具也自动纳入。内容里合法的 snake_case
 * 词请加进 NON_TOOL_SNAKE_CASE，而不是放宽规则。
 */
const SNAKE_CASE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

/** 世界设定里本来就有的 snake_case 词；不是工具。 */
const NON_TOOL_SNAKE_CASE = new Set(["max_hp"]);

function systemPrompts(world: World): { name: string; prompt: string }[] {
  const campaign = {
    name: world.worldName,
    campaignSetting: world.campaignSetting,
    systemRules: world.systemRules,
  };
  return [
    { name: `world:${world.worldName}`, prompt: buildWorldSystemPrompt(world) },
    ...world.stages.map((stage) => ({
      name: `stage:${stage.name}`,
      prompt: buildStageSystemPrompt(campaign, stage),
    })),
    ...world.actors.map((actor) => ({
      name: `actor:${actor.name}`,
      prompt: buildActorSystemPrompt(
        { ...campaign, id: "00000000-0000-4000-8000-000000000000" },
        actor,
      ),
    })),
    // openingBriefing 不是 system prompt，但同样是内容注入的固定文本。
    ...world.actors.flatMap((actor) =>
      actor.openingBriefing
        ? [{ name: `briefing:${actor.name}`, prompt: actor.openingBriefing }]
        : [],
    ),
  ];
}

describe("prompt material stays free of tool names", () => {
  it("never mentions a snake_case tool name", () => {
    const hits: string[] = [];
    for (const world of [TEST_WORLD, BELL_MONASTERY_WORLD]) {
      for (const { name, prompt } of systemPrompts(world)) {
        for (const match of prompt.matchAll(SNAKE_CASE)) {
          if (!NON_TOOL_SNAKE_CASE.has(match[0])) {
            hits.push(`${name}: ${match[0]}`);
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("keeps the ending rules role-neutral and free of tool names", () => {
    const rules = BELL_MONASTERY_WORLD.systemRules;
    expect(rules).toContain("只有世界能结束游戏");
    expect(rules).not.toContain("end_game");
    expect(rules).not.toContain("notify_stage");
  });
});
