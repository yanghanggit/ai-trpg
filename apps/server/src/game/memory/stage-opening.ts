import { MEMORY_KINDS } from "../constants";
import type { Stage } from "../world-definition";
import { buildStageOpeningSnapshot } from "./prompts";
import { appendMemoryMessages } from "./store";
import type { LoadedMemory, MemoryExecutor } from "./types";

export function hasStageOpeningSnapshot(memory: LoadedMemory): boolean {
  return memory.messages.some(
    (message) => message.metadata?.kind === MEMORY_KINDS.stageOpeningSnapshot,
  );
}

/**
 * 幂等补写：只记录「这个场景第一次落记忆那一刻」的状态，不追现状；老局无需回填，
 * 从未被写过的场景也不付这条记忆。
 */
export async function ensureStageOpeningSnapshot(
  executor: MemoryExecutor,
  memory: LoadedMemory,
  stage: Pick<Stage, "name" | "environment" | "anchors">,
): Promise<boolean> {
  if (hasStageOpeningSnapshot(memory)) {
    return false;
  }
  await appendMemoryMessages(executor, memory.row.id, [
    {
      type: "human",
      content: buildStageOpeningSnapshot(stage),
      metadata: { kind: MEMORY_KINDS.stageOpeningSnapshot },
    },
  ]);
  return true;
}
