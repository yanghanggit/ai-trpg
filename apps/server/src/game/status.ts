import { eq } from "drizzle-orm";
import type { Database } from "../db/pool";
import { actors } from "../db/schema";
import type { StatusEffect } from "./types";

type Executor = Pick<Database, "select" | "update">;

/** 沉睡状态的稳定 key；目前用于“场景内有非 wait 行为即惊醒”的硬编码规则。 */
export const SLEEPING_STATUS_KEY = "sleeping";

/**
 * 清除场景内所有 actor 的沉睡状态。
 *
 * 当前规则是硬编码：只要同一场景发生非 wait 行为，沉睡者就醒来。
 * 返回被唤醒的 actor 名称，供调用方选择是否记录额外事件。
 */
export async function wakeSleepingActors(
  executor: Executor,
  stageId: string,
  now: Date,
): Promise<string[]> {
  const rows = await executor.select().from(actors).where(eq(actors.stageId, stageId));
  const woken: string[] = [];
  for (const actor of rows) {
    const statuses = actor.statusEffects as unknown as StatusEffect[];
    if (!statuses.some((status) => status.key === SLEEPING_STATUS_KEY)) {
      continue;
    }
    const remaining = statuses.filter((status) => status.key !== SLEEPING_STATUS_KEY);
    await executor
      .update(actors)
      .set({
        statusEffects: remaining as unknown as typeof actors.$inferInsert.statusEffects,
        updatedAt: now,
      })
      .where(eq(actors.id, actor.id));
    woken.push(actor.name);
  }
  return woken;
}
