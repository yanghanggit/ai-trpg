import { randomUUID } from "node:crypto";
import { normalizeAffixTriggers } from "../affixes";
import { toStats } from "../attributes";
import type { ItemDefinition } from "../world-definition";

/**
 * 内容定义 → 数据库行的公共列。
 *
 * `stage_items` 与 `items` 字段相同，只差归属列，所以只有这一份取值逻辑：
 * 两边各写一份的话，新增物品字段时总会漏掉一边。
 */

/** 物品行的公共列；`stage_items` 与 `items` 字段相同，只差归属列。 */
export function itemValues(item: ItemDefinition, seq: number) {
  return {
    id: randomUUID(),
    seq,
    key: item.key,
    name: item.name,
    description: item.description,
    kind: item.kind,
    source: item.source ?? null,
    count: item.count ?? 1,
    stats: toStats(item.stats),
    maxTargets: item.maxTargets ?? 1,
    affixes: normalizeAffixTriggers(item.affixes),
    actions: [...(item.actions ?? [])],
  };
}
