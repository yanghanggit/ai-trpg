import { type ChatMessage, getBufferString } from "../../llm";
import type { WorldState } from "../types";
import { worldFunctionPrompt } from "../world-function";
import type { ResolvedOwner } from "./types";

/**
 * 压缩的提示词：任务输入、记忆转写，以及压缩宪法。
 *
 * 压缩结果会成为该主体后续所有回合的长期记忆，所以任务里要写明主体是谁；
 * 宪法在建局时装配好（`worldFunctionPrompt`），这里只取那一份，不再重算。
 */

/**
 * 压缩任务也要带上世界设定：压缩结果会成为该主体后续所有回合的长期记忆，
 * 专名、称谓与人称必须在压缩后仍然一致。
 */
export function buildCompactionInput(owner: ResolvedOwner, transcript: string): string {
  return `# 记忆压缩任务

## 记忆主体

- 名称：${owner.ownerName}
- 类型：${owner.ownerType}

## 待压缩记忆

以下是该主体本局可回忆的私有记忆。

${transcript}

## 输出

把以上记忆压缩成一段连续的私有记忆，只输出压缩后的正文，不要标题、列表或解释。`;
}

/** 把内部消息渲染成 Markdown 小节，并把记忆正文的标题压到三级。 */
export function renderTranscript(messages: readonly ChatMessage[]): string {
  return getBufferString(messages, { renderToolCalls: true })
    .replace(/^Human: /gm, "### 记忆条目\n\n")
    .replace(/^AI: /gm, "### 模型记录\n\n")
    .replace(/^Tool: /gm, "### 工具结果\n\n")
    .replace(/^(#{1,6})\s+(.+)$/gm, (_, _hashes: string, text: string) => `\n### ${text}\n`)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 记忆压缩的宪法：建局时装配好的完整文本。 */
export function buildCompactSystemPrompt(world: WorldState): string {
  return worldFunctionPrompt(world, "compact");
}
