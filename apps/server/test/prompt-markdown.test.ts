import { describe, expect, it } from "vitest";
import { BELL_MONASTERY_WORLD } from "../seeds/dark-fantasy";
import {
  buildActorSystemPrompt,
  buildStageSystemPrompt,
  buildWorldSystemPrompt,
} from "../src/game/memory";
import { WORLD_FUNCTION_TYPES } from "../src/game/types";

/**
 * 导出的 system prompt 是 Markdown 文件（`logs/prompts/`），会被人直接打开阅读。
 * 模板拼接出的列表必须与前后文空行隔开，否则 markdownlint 报 MD032。
 *
 * 这里只查 `- ` 与 `1. ` 两种列表；它们是模板里真实用到的两种写法。
 */
const BULLET = /^\s*[-*+] /;
const ORDERED = /^\s*\d+\. /;

function listSpacingProblems(prompt: string): string[] {
  const problems: string[] = [];
  const lines = prompt.split("\n");
  for (const [index, line] of lines.entries()) {
    const isList = BULLET.test(line) || ORDERED.test(line);
    if (!isList) {
      continue;
    }
    const previous = lines[index - 1];
    const next = lines[index + 1];
    const previousIsList =
      previous !== undefined && (BULLET.test(previous) || ORDERED.test(previous));
    const nextIsList = next !== undefined && (BULLET.test(next) || ORDERED.test(next));
    if (previous !== undefined && previous.trim().length > 0 && !previousIsList) {
      problems.push(`第 ${index + 1} 行：列表前缺空行`);
      break;
    }
    if (next !== undefined && next.trim().length > 0 && !nextIsList) {
      problems.push(`第 ${index + 1} 行：列表后缺空行`);
      break;
    }
  }
  return problems;
}

function allSystemPrompts(): { name: string; prompt: string }[] {
  const world = BELL_MONASTERY_WORLD;
  const campaign = {
    name: world.worldName,
    campaignSetting: world.campaignSetting,
    globalRules: world.globalRules,
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
        { name: actor.name, profile: actor.profile, form: actor.signature.form },
      ),
    })),
    ...WORLD_FUNCTION_TYPES.map((fn) => ({
      name: `function:${fn}`,
      prompt: world.functionAgents.find((agent) => agent.fn === fn)?.systemPrompt ?? "",
    })),
  ];
}

describe("system prompts stay markdown-clean", () => {
  it("surrounds every list with blank lines", () => {
    const failures = allSystemPrompts()
      .map(({ name, prompt }) => ({ name, problems: listSpacingProblems(prompt) }))
      .filter(({ problems }) => problems.length > 0)
      .map(({ name, problems }) => `${name}: ${problems.join("；")}`);
    expect(failures).toEqual([]);
  });
});
