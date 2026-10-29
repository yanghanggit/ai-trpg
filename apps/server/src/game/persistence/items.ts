import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { items, stageItems } from "../../db/schema";
import type { Executor, ItemRow, StageItemRow } from "../apply/types";
import { toStats } from "../attributes";
import { GameError } from "../errors";
import { allocateEntitySeq } from "./entity-seq";

/** 掉落只产 `material`：惰性效果、无属性，数量可堆叠。 */
const MATERIAL_EFFECT = { type: "none" } as const;

/** 递归按键排序的 JSON：jsonb 读回的键序不稳定，不能直接比较字符串。 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * 两件物品是否等价到可以并成一行。
 *
 * 只看会影响玩法与展示的字段；`seq`、`count`、归属不算。名字相同但描述、属性、
 * 效果或词缀不同的，是两件不同的东西，不能合并。
 */
export function sameItemSignature(
  a: {
    kind: string;
    name: string;
    description: string;
    stats: unknown;
    effect: unknown;
    affixes: unknown;
    source: string | null;
  },
  b: {
    kind: string;
    name: string;
    description: string;
    stats: unknown;
    effect: unknown;
    affixes: unknown;
    source: string | null;
  },
): boolean {
  return (
    a.kind === b.kind &&
    a.name === b.name &&
    a.description === b.description &&
    a.source === b.source &&
    stableJson(a.stats) === stableJson(b.stats) &&
    stableJson(a.effect) === stableJson(b.effect) &&
    stableJson(a.affixes) === stableJson(b.affixes)
  );
}

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
    .limit(2);
  if (existing) {
    if (!sameItemSignature(existing, stageItem)) {
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
    effect: stageItem.effect,
    affixes: [...stageItem.affixes],
    actions: [...stageItem.actions],
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
  const existingByName = new Map(existingRows.map((row) => [row.name, row]));

  for (const material of materials) {
    const existing = existingByName.get(material.name);
    if (existing?.kind === "material") {
      // 同一批材料按签名堆叠：名字相同但描述 / 来源不同的，视为不同物品。
      const candidate = {
        kind: "material" as const,
        name: material.name,
        description: material.description,
        stats: toStats({}),
        effect: MATERIAL_EFFECT,
        affixes: [],
        source,
      };
      if (!sameItemSignature(existing, candidate)) {
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
      effect: MATERIAL_EFFECT,
      affixes: [],
      actions: [],
    });
    written.push(material.name);
  }

  return { written, skipped };
}
