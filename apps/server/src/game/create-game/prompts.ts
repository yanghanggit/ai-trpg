import { WORLD_FUNCTION_TYPES } from "../types";
import type { World } from "../world-definition";
import type { PromptDump } from "./types";

/**
 * 建局时导出的 system prompt 清单；只取已定档的那份，不再重算。
 *
 * 世界职能宪法在解析内容时已经生成，这里只是按职能挑出文件名。
 */

/** 文件名沿用职能的中文短名之外的习惯写法：dialogueAudit 落到 dialogue-audit。 */
function dumpFileName(fn: string): string {
  return fn === "dialogueAudit" ? "dialogue-audit" : fn;
}

/** 世界职能宪法在建局前已定档，导出只按职能顺序取那一份。 */
export function buildFunctionPromptDumps(world: World): PromptDump[] {
  return WORLD_FUNCTION_TYPES.map((fn) => ({
    name: dumpFileName(fn),
    prompt: world.functionPrompts[fn],
  }));
}
