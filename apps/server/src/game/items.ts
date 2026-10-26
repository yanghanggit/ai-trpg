import { type Stats, toStats } from "./attributes";
import { GameError } from "./errors";
import type {
  ActorState,
  EquipmentSlot,
  EquipmentSlots,
  ItemEffect,
  ItemKind,
  ItemState,
  WearableItemState,
} from "./types";
import { EQUIPMENT_SLOT_KINDS, EQUIPMENT_SLOT_LABELS, EQUIPMENT_SLOTS } from "./types";

export function toItemState(row: {
  id: string;
  key?: string | null;
  name: string;
  description: string;
  kind: ItemKind;
  count: number;
  stats: Stats;
  effect: ItemEffect;
  affixes?: readonly string[];
}): ItemState {
  const base = {
    id: row.id,
    key: row.key ?? row.name,
    name: row.name,
    description: row.description,
    count: row.count,
    effect: row.effect,
    affixes: row.affixes ?? [],
    stats: toStats(row.stats),
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
    default: {
      const exhaustive: never = row.kind;
      throw new Error(`未知物品类型: ${String(exhaustive)}`);
    }
  }
}

export function isWearable(item: ItemState): item is WearableItemState {
  return item.kind === "weapon" || item.kind === "equipment" || item.kind === "accessory";
}

export type EquippedItemState = {
  slot: EquipmentSlot;
  item: WearableItemState;
};

/**
 * 从 actor 的槽位索引解析出当前穿戴中的物品。
 *
 * 槽里只存物品名；物品自身不记录 `equipped`。物品被转移或改名后，
 * 索引可能暂时指向不存在的物品，这里直接跳过。
 */
export function equippedItems(actor: Pick<ActorState, "items" | "equipment">): EquippedItemState[] {
  const byName = new Map(actor.items.map((item) => [item.name, item]));
  const equipped: EquippedItemState[] = [];
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

export function equipSlot(
  equipment: EquipmentSlots,
  slot: EquipmentSlot,
  item: { name: string; kind: ItemKind },
): EquipmentSlots {
  if (!EQUIPMENT_SLOT_KINDS[slot].includes(item.kind)) {
    throw new GameError(
      "invalid_action",
      `物品不能放进${EQUIPMENT_SLOT_LABELS[slot]}槽: ${item.name}`,
    );
  }
  const next = withoutEquippedItem(equipment, item.name);
  next[slot] = item.name;
  return next;
}

/** 卸下槽位；物品本身不动，只是不再被索引。 */
export function unequipSlot(equipment: EquipmentSlots, slot: EquipmentSlot): EquipmentSlots {
  const next = { ...equipment };
  delete next[slot];
  return next;
}

export function withoutEquippedItem(equipment: EquipmentSlots, itemName: string): EquipmentSlots {
  const next = { ...equipment };
  for (const slot of EQUIPMENT_SLOTS) {
    if (next[slot] === itemName) {
      delete next[slot];
    }
  }
  return next;
}
