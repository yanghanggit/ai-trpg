/**
 * 世界职能的宪法：战役设定 + 全局规则 + 本职能的世界口径。
 *
 * 世界职能是世界级单例，和 world 平级，但没有 memory：宪法每次重建、不写库、
 * 不参与 compact 与快照，任务提示词只放本轮事实。口径归内容，机制归代码。
 */

import type { WorldFunctionProfiles, WorldFunctionType } from "./types";

/** 中文名只用于提示词；代码里一律用 `WorldFunctionType`。 */
const WORLD_FUNCTION_LABELS: Record<WorldFunctionType, string> = {
  drops: "掉落裁决",
  affixes: "词缀判定",
  story: "故事整理",
  compact: "记忆压缩",
  dialogueAudit: "玩家对话审核",
};

/**
 * 世界宪法：一局的战役设定、全局规则与各职能口径。
 *
 * 运行时是 `WorldState` 的投影，内容侧是 `World`；两边结构上都满足它。
 */
export type WorldConstitution = {
  name: string;
  campaignSetting: string;
  globalRules: string;
  worldFunctions: WorldFunctionProfiles;
};

export function buildWorldFunctionPrompt(world: WorldConstitution, fn: WorldFunctionType): string {
  const label = WORLD_FUNCTION_LABELS[fn];
  return `# ${world.name} · ${label}

你是这个世界的一项职能：${label}；不扮演任何实体，也不记得上一轮。

## 战役设定

${world.campaignSetting}

## 全局规则

${world.globalRules}

## 本职能

${world.worldFunctions[fn]}`;
}

/** 宪法 + 该职能的代码契约；契约只写机制，口径在内容里。 */
export function worldFunctionSystemPrompt(
  world: WorldConstitution,
  fn: WorldFunctionType,
  contract: string,
): string {
  return `${buildWorldFunctionPrompt(world, fn)}\n\n## 契约\n\n${contract.trim()}`;
}
