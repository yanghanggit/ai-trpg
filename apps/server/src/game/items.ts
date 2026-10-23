import type { Item, ItemKind, ItemStats } from "./types";

/** 把数据库行的通用字段收窄成对应物品子类；新增 kind 时在这里补分支。 */
export function toItemState(row: {
  id: string;
  name: string;
  description: string;
  kind: ItemKind;
  count: number;
  stats: ItemStats;
}): Item {
  const base = {
    id: row.id,
    name: row.name,
    description: row.description,
    count: row.count,
  };
  switch (row.kind) {
    case "weapon":
      return { ...base, kind: "weapon", stats: row.stats };
    case "equipment":
      return { ...base, kind: "equipment", stats: row.stats };
    case "accessory":
      return { ...base, kind: "accessory" };
    case "consumable":
      return { ...base, kind: "consumable" };
    case "valuable":
      return { ...base, kind: "valuable" };
    default: {
      const exhaustive: never = row.kind;
      throw new Error(`未知物品类型: ${String(exhaustive)}`);
    }
  }
}
