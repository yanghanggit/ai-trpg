import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { items, stageItems } from "../../db/schema";
import type { Executor, ItemRow, StageItemRow } from "../apply/types";
import { toStats } from "../attributes";

/** 掉落只产 `material`：惰性效果、无属性，数量可堆叠。 */
const MATERIAL_EFFECT = { type: "none" } as const;

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

export type MaterialDrop = { name: string; description: string; count: number };

/**
 * 把掉落材料写进尸体背包。
 *
 * 掉在尸体上而不是地上：搜刮走 `steal`，`pickup` 只够得到场景物品。
 * 同名材料并进已有那一行（材料可堆叠）；同名但不是材料说明尸体本来就有
 * 一件别的东西，跳过它，不去覆盖原有的物品。
 */
export async function addActorMaterials(
  executor: Executor,
  actorId: string,
  materials: readonly MaterialDrop[],
): Promise<{ written: string[]; skipped: string[] }> {
  const written: string[] = [];
  const skipped: string[] = [];
  if (materials.length === 0) {
    return { written, skipped };
  }

  const existingRows = await executor
    .select()
    .from(items)
    .where(
      and(
        eq(items.actorId, actorId),
        inArray(
          items.name,
          materials.map((material) => material.name),
        ),
      ),
    );
  const existingByName = new Map(existingRows.map((row) => [row.name, row]));

  for (const material of materials) {
    const existing = existingByName.get(material.name);
    if (existing?.kind === "material") {
      await executor
        .update(items)
        .set({ count: existing.count + material.count })
        .where(eq(items.id, existing.id));
      written.push(material.name);
      continue;
    }
    if (existing) {
      skipped.push(material.name);
      continue;
    }
    await executor.insert(items).values({
      id: randomUUID(),
      actorId,
      key: `material:${material.name}`,
      name: material.name,
      description: material.description,
      kind: "material",
      count: material.count,
      stats: toStats({}),
      effect: MATERIAL_EFFECT,
      affixes: [],
    });
    written.push(material.name);
  }

  return { written, skipped };
}
