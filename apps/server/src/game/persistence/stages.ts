import { and, eq } from "drizzle-orm";
import { stages } from "../../db/schema";
import type { Executor, StageRow } from "../apply/types";
import type { StageAnchor } from "../types";

/** 读一个场景，并限定在该 world 内。 */
export async function loadStageInWorld(
  executor: Executor,
  stageId: string,
  worldId: string,
): Promise<StageRow | undefined> {
  const [stage] = await executor
    .select()
    .from(stages)
    .where(and(eq(stages.id, stageId), eq(stages.worldId, worldId)))
    .limit(1);
  return stage;
}

/** 读一个 world 的全部场景。 */
export async function listStagesOfWorld(executor: Executor, worldId: string): Promise<StageRow[]> {
  return executor.select().from(stages).where(eq(stages.worldId, worldId));
}

/** 场景的写操作；stage 回合只调用这里，不直接拼 SQL。 */
export async function setStageEnvironment(
  executor: Executor,
  stageId: string,
  environment: string,
): Promise<void> {
  await executor.update(stages).set({ environment }).where(eq(stages.id, stageId));
}

/** 写入完整的锚点快照；调用方负责校验与公共事件。 */
export async function setStageAnchors(
  executor: Executor,
  stageId: string,
  anchors: StageAnchor[],
): Promise<void> {
  await executor.update(stages).set({ anchors }).where(eq(stages.id, stageId));
}
