import { type TraceContext, traceEvent } from "../debug/trace";
import type { Executor } from "./apply/types";
import { MEMORY_KINDS } from "./constants";
import { appendMemoryMessages, loadAgentMemory } from "./memory";

/** 把 stage 的报告写入 world memory；报告不是世界事实，也不是系统指令。 */
export async function appendWorldNotification(
  executor: Executor,
  gameId: string,
  worldId: string,
  stage: { id: string; name: string },
  content: string,
  trace?: TraceContext,
): Promise<void> {
  const memory = await loadAgentMemory(executor, gameId, "world", worldId);
  if (!memory) {
    throw new Error(`world 缺少 memory: ${worldId}`);
  }
  await appendMemoryMessages(executor, memory.row.id, [
    {
      type: "human",
      content: `# 来自场景的通知\n场景：${stage.name}\n${content}`,
      metadata: {
        kind: MEMORY_KINDS.worldNotification,
        stageId: stage.id,
        stageName: stage.name,
      },
    },
  ]);
  await traceEvent(trace, {
    event: "observed",
    via: "world-memory",
    kind: MEMORY_KINDS.worldNotification,
    stageId: stage.id,
    content: `# 来自场景的通知\n场景：${stage.name}\n${content}`,
  });
}

/** 把 world 的裁决写入指定 stage memory，供 stage 下一轮读取。 */
export async function appendStageDirective(
  executor: Executor,
  gameId: string,
  stageId: string,
  worldId: string,
  content: string,
  trace?: TraceContext,
): Promise<void> {
  const memory = await loadAgentMemory(executor, gameId, "stage", stageId);
  if (!memory) {
    throw new Error(`stage 缺少 memory: ${stageId}`);
  }
  await appendMemoryMessages(executor, memory.row.id, [
    {
      type: "human",
      content: `# 世界裁决\n${content}`,
      metadata: {
        kind: MEMORY_KINDS.worldDirective,
        worldId,
      },
    },
  ]);
  await traceEvent(trace, {
    event: "observed",
    via: "stage-memory",
    kind: MEMORY_KINDS.worldDirective,
    stageId,
    content: `# 世界裁决\n${content}`,
  });
}
