import type { AgentMemoryState } from "../memory";
import type { GameState } from "../types";
import { type WorldConstitution, worldFunctionAgent } from "../world-function";

/**
 * 故事整理的提示词：宪法来自世界职能，任务只说明这一轮要读什么、写成什么样。
 *
 * 只依赖状态与记忆条数，不碰数据库；回合怎么跑在 `turn.ts`。
 */

/** 故事整理的宪法：建局时装配好的完整文本。 */
export function buildStorySystemPrompt(world: WorldConstitution): string {
  return worldFunctionAgent(world, "story").systemPrompt;
}

export function buildStoryInput(state: GameState, memories: readonly AgentMemoryState[]): string {
  return `# 当前游戏

- 游戏：${state.game.name}
- slug：${state.game.slug}
- 状态：${state.game.status}
- 内容版本：${state.game.contentVersion}
- 版本号：${state.game.version}

本局共有 ${memories.length} 个实体记忆。请先调用 list_memories，再读取每一个实体，最后读取事件流并提交故事。

游戏可能仍在进行，也可能已经结束；只根据当前已经发生的记忆和事件写作，不要虚构尚未发生的结局。

# 本轮任务

写一段完整、连贯的故事：开头、发展、冲突与当前阶段的收束，能解释关键角色为什么行动；保留关键因果、关系、物品、地点与结局。

1. list_memories；
2. 对每一个 world / stage / actor 调用 read_memory；如果摘要不足以理解关键因果，可用 includeArchived 展开归档；
3. read_events；
4. 综合所有视角，调用 submit_story。

只使用工具返回的记忆与事件。把场景通知与世界裁决改写成故事里实际发生的事，不要解释“谁向谁报告、谁如何裁决”；不要跳过任何实体，不要把单个角色的误解当作客观事实，不要编造未出现的事件。`;
}
