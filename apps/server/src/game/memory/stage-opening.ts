import { MEMORY_KINDS } from "../constants";
import { listStageItems } from "../persistence/items";
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
  stage: {
    id: string;
    name: string;
    environment: string;
    anchors: readonly { key: string; label: string; description?: string }[];
  },
): Promise<boolean> {
  if (hasStageOpeningSnapshot(memory)) {
    return false;
  }
  const itemsByAnchor = new Map<string, string[]>();
  for (const item of await listStageItems(executor, stage.id)) {
    const list = itemsByAnchor.get(item.anchorKey) ?? [];
    list.push(item.name);
    itemsByAnchor.set(item.anchorKey, list);
  }
  const anchors = stage.anchors.map((anchor) => ({
    ...anchor,
    items: (itemsByAnchor.get(anchor.key) ?? []).map((name) => ({ name })),
  }));
  await appendMemoryMessages(executor, memory.row.id, [
    {
      type: "human",
      content: buildStageOpeningSnapshot({ ...stage, anchors }),
      metadata: { kind: MEMORY_KINDS.stageOpeningSnapshot },
    },
  ]);
  return true;
}
