import type { WorldFunctionAgent } from "../../../src/game/types";
import { AFFIXES_AGENT } from "./affixes";
import { COMPACT_AGENT } from "./compact";
import { DIALOGUE_AUDIT_AGENT } from "./dialogue-audit";
import { DROPS_AGENT } from "./drops";
import type { WorldFunctionAgentSpec } from "./spec";
import { STORY_AGENT } from "./story";

/**
 * 世界职能 agent 的清单：显式列出，谁在、顺序如何，一眼可数。
 *
 * 新增或替换一个职能 agent = 在这里加一行；没有隐式的键推导。
 */
export const WORLD_FUNCTION_AGENTS = [
  DROPS_AGENT,
  AFFIXES_AGENT,
  STORY_AGENT,
  COMPACT_AGENT,
  DIALOGUE_AUDIT_AGENT,
] as const satisfies readonly WorldFunctionAgentSpec[];

/** 装配所需的、来自战役与本局的输入。 */
export type WorldFunctionAgentSource = {
  campaignSetting: string;
  globalRules: string;
};

/**
 * 拼装一个 agent：把它自己的文本与这一局的设定、全局规则合成一份完整的 system prompt。
 *
 * 一次只做一件事；谁在、以什么顺序装配，由剧本在调用处逐个写出来。
 */
export function renderWorldFunctionAgent(
  spec: WorldFunctionAgentSpec,
  source: WorldFunctionAgentSource,
): WorldFunctionAgent {
  const tail = spec.constraints === undefined ? "" : `\n\n${spec.constraints}`;
  return {
    fn: spec.fn,
    systemPrompt: `# ${spec.label}

你是这个世界的一项职能：${spec.label}。

## 职责

${spec.duty}

## 战役设定

${source.campaignSetting}

## 全局规则

${source.globalRules}

## 本职能

${spec.profile}${tail}`,
  };
}
