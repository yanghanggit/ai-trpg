import { randomUUID } from "node:crypto";
import { knownStages } from "../../db/schema";
import type { Executor } from "../apply/types";

/**
 * 「actor 知道这个场景的真名」的持久化原语。
 *
 * 只记非到访来源：到访由 `stage_visits` 负责，读取时用 `knownStageIds` 合并，
 * 所以到达路径不需要写第二张表。同一「actor × 场景」重复得知不覆盖首次时间。
 */

export type KnownStageSource = "content" | "runtime";

export type KnownStageWrite = {
  gameId: string;
  actorId: string;
  stageId: string;
  source: KnownStageSource;
  /** 在哪个场景听说的；内容直接声明时为 null。 */
  learnedStageId: string | null;
};

export async function recordKnownStage(
  executor: Executor,
  write: KnownStageWrite,
  now: Date = new Date(),
): Promise<void> {
  await executor
    .insert(knownStages)
    .values({
      id: randomUUID(),
      gameId: write.gameId,
      actorId: write.actorId,
      stageId: write.stageId,
      firstLearnedAt: now,
      source: write.source,
      learnedStageId: write.learnedStageId,
    })
    .onConflictDoNothing();
}
