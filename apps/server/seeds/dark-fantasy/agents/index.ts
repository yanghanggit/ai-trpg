import type { WorldFunction } from "../../../src/game/types";
import { AFFIXES_SPEC } from "./affixes";
import { COMPACT_SPEC } from "./compact";
import { DIALOGUE_AUDIT_SPEC } from "./dialogue-audit";
import { DROPS_SPEC } from "./drops";
import type { WorldFunctionSpec, WorldFunctions } from "./spec";
import { STORY_SPEC } from "./story";

/**
 * 世界职能的文本清单：键就是职能名，`WorldFunctions` 保证每个职能恰好一条。
 *
 * 新增或替换一个职能 = 在这里加一行并把键对上；顺序由 `WORLD_FUNCTION_TYPES` 决定。
 */
export const WORLD_FUNCTIONS: WorldFunctions = {
  drops: DROPS_SPEC,
  affixes: AFFIXES_SPEC,
  story: STORY_SPEC,
  compact: COMPACT_SPEC,
  dialogueAudit: DIALOGUE_AUDIT_SPEC,
};

/** 装配所需的、来自战役与本局的输入。 */
export type WorldFunctionSource = {
  campaignSetting: string;
  globalRules: string;
};

/**
 * 拼装一个职能的宪法：把它自己的文本与这一局的设定、全局规则合成一份完整 system prompt。
 *
 * 排版只此一处；谁在、以什么顺序装配，由剧本调用 `renderFunctionPrompts` 一次写出来。
 */
export function renderFunctionPrompt(spec: WorldFunctionSpec, source: WorldFunctionSource): string {
  const tail = spec.constraints === undefined ? "" : `\n\n${spec.constraints}`;
  return `# ${spec.label}

你是这个世界的一项职能：${spec.label}。

## 职责

${spec.duty}

## 战役设定

${source.campaignSetting}

## 全局规则

${source.globalRules}

## 本职能

${spec.profile}${tail}`;
}

/** 把清单里每个职能都装配一次，得到一个职能 → 宪法的映射。 */
export function renderFunctionPrompts(source: WorldFunctionSource): Record<WorldFunction, string> {
  const prompts = {} as Record<WorldFunction, string>;
  for (const [fn, spec] of Object.entries(WORLD_FUNCTIONS) as [
    WorldFunction,
    WorldFunctionSpec,
  ][]) {
    prompts[fn] = renderFunctionPrompt(spec, source);
  }
  return prompts;
}
