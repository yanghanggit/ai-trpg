import type {
  ActorState,
  EquipmentSlot,
  EquipmentSlots,
  Item,
  ItemKind,
  ItemStats,
  WearableItem,
} from "./types";
import { EQUIPMENT_SLOTS } from "./types";

/** 把数据库行的通用字段收窄成对应物品子类；新增 kind 时在这里补分支。 */
export function toItemState(row: {
  id: string;
  key?: string | null;
  name: string;
  description: string;
  kind: ItemKind;
  count: number;
  stats: ItemStats;
}): Item {
  const base = {
    id: row.id,
    key: row.key ?? row.name,
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

/** 物品是否能放进某个穿戴槽。 */
export function isWearable(item: Item): item is WearableItem {
  return item.kind === "weapon" || item.kind === "equipment" || item.kind === "accessory";
}

export type EquippedItem = {
  slot: EquipmentSlot;
  item: WearableItem;
};

/**
 * 从 actor 的槽位索引解析出当前穿戴中的物品。
 *
 * 槽里只存物品名；物品自身不记录 `equipped`。物品被转移或改名后，
 * 索引可能暂时指向不存在的物品，这里直接跳过。
 */
export function equippedItems(actor: Pick<ActorState, "items" | "equipment">): EquippedItem[] {
  const byName = new Map(actor.items.map((item) => [item.name, item]));
  const equipped: EquippedItem[] = [];
  for (const slot of EQUIPMENT_SLOTS) {
    const itemName = actor.equipment[slot];
    if (!itemName) {
      continue;
    }
    const item = byName.get(itemName);
    if (item && isWearable(item)) {
      equipped.push({ slot, item });
    }
  }
  return equipped;
}

/** 物品离开 actor 时，从所有槽位里移除对它的索引。 */
export function withoutEquippedItem(equipment: EquipmentSlots, itemName: string): EquipmentSlots {
  const next = { ...equipment };
  for (const slot of EQUIPMENT_SLOTS) {
    if (next[slot] === itemName) {
      delete next[slot];
    }
  }
  return next;
}
