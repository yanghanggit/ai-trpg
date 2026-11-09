import type { WorldFunctionType } from "../types";
import type { World } from "../world-definition";
import type { PromptDump } from "./types";

/**
 * 建局时导出的 system prompt 清单；只取已定档的那份，不再重算。
 *
 * 世界职能 agent 的宪法在解析内容时已经生成，这里只是按职能挑出文件名。
 */

/** 文件名沿用职能的中文短名之外的习惯写法：dialogueAudit 落到 dialogue-audit。 */
export function dumpFileName(fn: WorldFunctionType): string {
  return fn === "dialogueAudit" ? "dialogue-audit" : fn;
}

/** 世界职能 agent 的宪法在建局前已定档，导出只取那一份，不再重算。 */
export function buildFunctionAgentPrompts(world: World): PromptDump[] {
  return world.functionAgents.map((agent) => ({
    name: dumpFileName(agent.fn),
    prompt: agent.systemPrompt,
  }));
}
