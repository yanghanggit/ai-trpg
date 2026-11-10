import { type TraceContext, traceEvent } from "../../debug/trace";
import type { Executor } from "../persistence/rows";
import { MEMORY_KINDS } from "./kinds";
import { appendMemoryMessages, loadAgentMemory } from "./store";

/**
 * 跨 owner 写记忆的唯一通道：上调是场景报告与引擎确认的事实，下降是 world 裁决。
 *
 * 两端都写对方的 memory，谁都不进公共事件流——这条通道只在两个 agent 之间说话。
 * 「谁能写别人的记忆」只有这一个答案：其他模块要告诉别的 owner 什么，走这里的函数，
 * 不自建一条写入路径。
 */

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

/**
 * 把引擎确认的事实写入 world memory。
 *
 * 与场景报告分开标记：这条不需要 stage 转述，也不带 stage 的口吻（当前只有主角死亡）。
 */
export async function appendWorldEvent(
  executor: Executor,
  gameId: string,
  worldId: string,
  event: { content: string; stageId: string; actorId: string },
  trace?: TraceContext,
): Promise<void> {
  const memory = await loadAgentMemory(executor, gameId, "world", worldId);
  if (!memory) {
    throw new Error(`world 缺少 memory: ${worldId}`);
  }
  await appendMemoryMessages(executor, memory.row.id, [
    {
      type: "human",
      content: event.content,
      metadata: {
        kind: MEMORY_KINDS.worldEvent,
        stageId: event.stageId,
        actorId: event.actorId,
      },
    },
  ]);
  await traceEvent(trace, {
    event: "observed",
    via: "world-memory",
    kind: MEMORY_KINDS.worldEvent,
    stageId: event.stageId,
    content: event.content,
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
