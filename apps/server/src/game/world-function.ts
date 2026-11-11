/**
 * 世界职能的宪法：内容层定档，运行时直接读。
 *
 * 一个职能就是一份 system prompt——口径、职责与不可协商的约束全在那段文本里。
 * 文本在 `seeds/` 装配，建局时随世界存库；这里只负责按职能取出来，不再拼接任何片段。
 */

import type { FunctionPromptVariant, WorldFunction, WorldState } from "./kernel/types";
import type { MemoryOwnerType } from "./memory";

/**
 * 取某个职能的宪法；内容层漏定档时在这里一次说清，而不是让空 prompt 流到模型。
 *
 * 给了 `ownerType` 时先试 `fn.主体` 这份细分宪法，没有就回落到主宪法——内容层决定
 * 要不要按主体分口径，调用方不需要知道这次到底用了哪一份。
 */
export function worldFunctionPrompt(
  world: WorldState,
  fn: WorldFunction,
  ownerType?: MemoryOwnerType,
): string {
  const variant =
    ownerType === undefined ? undefined : (`${fn}.${ownerType}` as FunctionPromptVariant);
  const prompt =
    (variant === undefined ? undefined : world.functionPrompts[variant]) ??
    world.functionPrompts[fn];
  if (prompt.trim().length === 0) {
    throw new Error(`缺少世界职能宪法: ${world.name} / ${variant ?? fn}`);
  }
  return prompt;
}
