import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { items, stageItems } from "../../db/schema";
import type { Executor, ItemRow, StageItemRow } from "../apply/types";

/**
 * 物品与场景物品的写操作：玩法层只表达「谁拿到什么」，不关心两张表怎么搬。
 */

/** 读某个 actor 名下的某件物品（按稳定 id，不按名字）。 */
export async function loadActorItem(
  executor: Executor,
  actorId: string,
  itemId: string,
): Promise<ItemRow | undefined> {
  const [item] = await executor
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.actorId, actorId)))
    .limit(1);
  return item;
}

/**
 * 场景物品转入 actor 背包：删一行、插一行，两件事必须同进同退。
 *
 * 放在一个函数里是为了让这条原子性要求在实现处显式可见，而不是由调用方顺手记住。
 */
export async function moveStageItemToActor(
  executor: Executor,
  stageItem: StageItemRow,
  actorId: string,
): Promise<void> {
  await executor.delete(stageItems).where(eq(stageItems.id, stageItem.id));
  await executor.insert(items).values({
    id: randomUUID(),
    actorId,
    key: stageItem.key,
    name: stageItem.name,
    description: stageItem.description,
    kind: stageItem.kind,
    count: stageItem.count,
    stats: stageItem.stats,
    effect: stageItem.effect,
    affixes: [...stageItem.affixes],
  });
}

/** 物品在 actor 之间转移；`items.actor_id` 就是归属本身。 */
export async function transferItemToActor(
  executor: Executor,
  itemId: string,
  actorId: string,
): Promise<void> {
  await executor.update(items).set({ actorId }).where(eq(items.id, itemId));
}
