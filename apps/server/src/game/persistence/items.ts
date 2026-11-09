import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { items, stageItems } from "../../db/schema";
import type { Executor, ItemRow, StageItemRow } from "../apply/types";
import { toStats } from "../attributes";
import { GameError } from "../errors";
import { isSameItem } from "../item-identity";
import { normalizeAffixTriggers } from "../items/affix-model";
import { allocateEntitySeq } from "./entity-seq";

/**
 * 物品与场景物品的读写操作：玩法层只表达「谁拿到什么」，不关心两张表怎么搬。
 */

/** 读一个场景当前陈列的物品，按实体序号稳定排序。 */
export async function listStageItems(
  executor: Pick<Database, "select">,
  stageId: string,
): Promise<StageItemRow[]> {
  return executor
    .select()
    .from(stageItems)
    .where(eq(stageItems.stageId, stageId))
    .orderBy(asc(stageItems.seq));
}

/** 移除锚点上的全部物品；返回被移除的行数。 */
export async function deleteStageItemsByAnchor(
  executor: Executor,
  stageId: string,
  anchorKey: string,
): Promise<number> {
  const removed = await executor
    .delete(stageItems)
    .where(and(eq(stageItems.stageId, stageId), eq(stageItems.anchorKey, anchorKey)))
    .returning({ id: stageItems.id });
  return removed.length;
}

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
 * 场景物品转入 actor 背包。
 *
 * 背包里已有同名物品时：签名相同就并入 `count`（同一件东西的两份），
 * 签名不同说明是两件不同的东西，直接拒绝，避免覆盖或撞唯一索引。
 */
export async function moveStageItemToActor(
  executor: Executor,
  stageItem: StageItemRow,
  actorId: string,
): Promise<void> {
  const [existing] = await executor
    .select()
    .from(items)
    .where(and(eq(items.actorId, actorId), eq(items.name, stageItem.name)))
    .limit(1);
  if (existing) {
    if (!isSameItem(existing, stageItem)) {
      throw new GameError("invalid_action", `你已经有同名物品: ${stageItem.name}`);
    }
    await executor
      .update(items)
      .set({ count: existing.count + stageItem.count })
      .where(eq(items.id, existing.id));
    await executor.delete(stageItems).where(eq(stageItems.id, stageItem.id));
    return;
  }
  await executor.delete(stageItems).where(eq(stageItems.id, stageItem.id));
  await executor.insert(items).values({
    id: randomUUID(),
    // 换归属不是新建实体：保留原序号，避免拾取后物品在列表里跳到末尾。
    seq: stageItem.seq,
    actorId,
    key: stageItem.key,
    name: stageItem.name,
    description: stageItem.description,
    kind: stageItem.kind,
    source: stageItem.source,
    count: stageItem.count,
    stats: stageItem.stats,
    affixes: normalizeAffixTriggers(stageItem.affixes),
    actions: [...stageItem.actions],
  });
}

/**
 * 物品在 actor 之间转移；`items.actor_id` 就是归属本身。
 *
 * 与拾取同一条规则：一个作用域里一个名字只有一行。背包里已有同名物品时，
 * 签名相同就并入 `count`（同一件东西的两份），签名不同说明是两件不同的东西，
 * 直接拒绝——否则后到的那件永远排不到名字地址，等于拿不到。
 */
export async function transferItemToActor(
  executor: Executor,
  item: ItemRow,
  actorId: string,
): Promise<void> {
  const [existing] = await executor
    .select()
    .from(items)
    .where(and(eq(items.actorId, actorId), eq(items.name, item.name)))
    .limit(1);
  if (!existing) {
    await executor.update(items).set({ actorId }).where(eq(items.id, item.id));
    return;
  }
  if (!isSameItem(existing, item)) {
    throw new GameError("invalid_action", `目标已经有同名的另一件物品: ${item.name}`);
  }
  await executor
    .update(items)
    .set({ count: existing.count + item.count })
    .where(eq(items.id, existing.id));
  await executor.delete(items).where(eq(items.id, item.id));
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
  gameId: string,
  actorId: string,
  source: string,
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
  const existingByName = new Map<string, ItemRow>();
  for (const row of [...existingRows].sort((a, b) => a.seq - b.seq)) {
    if (!existingByName.has(row.name)) {
      existingByName.set(row.name, row);
    }
  }

  for (const material of materials) {
    const existing = existingByName.get(material.name);
    if (existing?.kind === "material") {
      // 同一批材料按签名堆叠：名字相同但描述 / 来源不同的，视为不同物品。
      const candidate = {
        kind: "material" as const,
        name: material.name,
        description: material.description,
        stats: toStats({}),
        affixes: {},
        actions: [],
        source,
      };
      if (!isSameItem(existing, candidate)) {
        skipped.push(material.name);
        continue;
      }
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
      seq: await allocateEntitySeq(executor, gameId),
      actorId,
      key: `material:${material.name}`,
      name: material.name,
      description: material.description,
      kind: "material",
      source,
      count: material.count,
      stats: toStats({}),
      affixes: {},
      actions: [],
    });
    written.push(material.name);
  }

  return { written, skipped };
}
