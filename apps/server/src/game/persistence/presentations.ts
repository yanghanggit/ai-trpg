import { and, eq, inArray, isNull } from "drizzle-orm";
import { actorPresentations } from "../../db/schema";
import type { Executor } from "../apply/types";

/**
 * 形象的持久化原语。
 *
 * `actors` 只持有身份与身体；「别人此刻看到的样子」属于形象。所以外观的读写都走这里，
 * 换装只改当前形象，伪装 / 变身会开一条新形象并把旧的封上（`endedAt`）。
 */

export type NewPresentation = {
  id: string;
  seq: number;
  actorId: string;
  anchor: string;
  appearance: string;
  isDefault: boolean;
  /** 新形象先以「已退场」插入，再由 `switchCurrentPresentation` 启用，避免撞唯一索引。 */
  endedAt?: Date | null;
};

export async function insertPresentation(
  executor: Executor,
  presentation: NewPresentation,
): Promise<void> {
  await executor
    .insert(actorPresentations)
    .values({ ...presentation, endedAt: presentation.endedAt ?? null });
}

/**
 * 本局内给定 actor 的当前形象（每个 actor 至多一条）。
 *
 * 调用方先算出 actorIds，再一次性读回，避免按 actor 逐个查询。
 */
export async function listCurrentPresentations(
  executor: Executor,
  actorIds: readonly string[],
): Promise<(typeof actorPresentations.$inferSelect)[]> {
  if (actorIds.length === 0) {
    return [];
  }
  return executor
    .select()
    .from(actorPresentations)
    .where(
      and(inArray(actorPresentations.actorId, [...actorIds]), isNull(actorPresentations.endedAt)),
    );
}

/**
 * 切换当前形象：把正在使用的那条封上，再把目标形象恢复为当前。
 *
 * 伪装 / 变身只切换、不销毁：切回旧形象时，旧的 `name_knowledge` 行会立刻重新生效，
 * 老朋友不需要重新认识一遍。
 */
export async function switchCurrentPresentation(
  executor: Executor,
  actorId: string,
  presentationId: string,
  now: Date,
): Promise<void> {
  await executor
    .update(actorPresentations)
    .set({ endedAt: now })
    .where(and(eq(actorPresentations.actorId, actorId), isNull(actorPresentations.endedAt)));
  await executor
    .update(actorPresentations)
    .set({ endedAt: null })
    .where(and(eq(actorPresentations.id, presentationId), eq(actorPresentations.actorId, actorId)));
}

/** 写当前形象的展示值；外观推理与死亡快照都落在这里。 */
export async function setPresentationAppearance(
  executor: Executor,
  actorId: string,
  appearance: string,
): Promise<void> {
  await executor
    .update(actorPresentations)
    .set({ appearance })
    .where(and(eq(actorPresentations.actorId, actorId), isNull(actorPresentations.endedAt)));
}
