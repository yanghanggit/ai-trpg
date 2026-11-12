import { normalizeAffixTriggers } from "../kernel/affixes";
import { type Stats, toStats } from "../kernel/attributes";
import type {
  AffixTriggers,
  CarriedActionKind,
  ItemKind,
  ItemState,
  WearableItemState,
} from "../kernel/types";

/**
 * 道具状态的投影：数据库那行 → `ItemState`，以及「它能不能穿 / 参不参与外观」。
 *
 * 这里只做形状与归一（缺省字段、旧值兜底），不判断身份与归属。穿戴在 `slots.ts`。
 */

export function toItemState(row: {
  id: string;
  seq: number;
  key?: string | null;
  name: string;
  description: string;
  kind: ItemKind;
  source?: string | null;
  count: number;
  stats: Stats;
  affixes?: AffixTriggers;
  actions?: readonly CarriedActionKind[];
  maxTargets?: number;
  appearsInAppearance?: boolean | null;
}): ItemState {
  const base = {
    id: row.id,
    seq: row.seq,
    key: row.key ?? row.name,
    name: row.name,
    description: row.description,
    count: row.count,
    affixes: normalizeAffixTriggers(row.affixes),
    actions: row.actions ?? [],
    stats: toStats(row.stats),
    // 旧数据没有这一列时按 1 归一：单体挥击是默认形态。
    maxTargets: row.maxTargets ?? 1,
    // 只有 accessory 会写 true；缺列（旧行）按不参与外观归一。
    appearsInAppearance: row.appearsInAppearance ?? false,
  };
  switch (row.kind) {
    case "weapon":
      return { ...base, kind: "weapon" };
    case "equipment":
      return { ...base, kind: "equipment" };
    case "accessory":
      return { ...base, kind: "accessory" };
    case "consumable":
      return { ...base, kind: "consumable" };
    case "valuable":
      return { ...base, kind: "valuable" };
    case "material":
      return { ...base, kind: "material", source: row.source ?? null };
    default: {
      const exhaustive: never = row.kind;
      throw new Error(`未知道具类型: ${String(exhaustive)}`);
    }
  }
}

export function isWearable(item: ItemState): item is WearableItemState {
  return item.kind === "weapon" || item.kind === "equipment" || item.kind === "accessory";
}

/**
 * 这件穿戴是否作为外观推理的输入。
 *
 * 武器与护甲总是参与；饰品由内容在道具定义上声明——同一个槽位在不同题材里
 * 可能是项链，也可能是看不见的植入物。换装后要不要重算外观也用它判定。
 * 见 `docs/appearance.md`。
 */
export function participatesInAppearance(
  item: Pick<ItemState, "kind" | "appearsInAppearance">,
): boolean {
  return item.kind !== "accessory" || item.appearsInAppearance;
}
