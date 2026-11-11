import { carriedActionsForKind } from "../actions";
import { GameError } from "../errors";
import type {
  ActorState,
  CarriedActionKind,
  EquipmentSlot,
  EquipmentSlots,
  ItemKind,
  WearableItemState,
} from "../kernel/types";
import { EQUIPMENT_SLOT_KINDS, EQUIPMENT_SLOT_LABELS, EQUIPMENT_SLOTS } from "../kernel/types";
import { isWearable } from "./project";

/**
 * 穿戴：谁此刻穿着什么、槽位索引怎么改、穿戴中的道具授予了哪些动作。
 *
 * 槽里只存道具名，道具自己不记 `equipped`——所以指向不存在道具的槽位一律当作没穿。
 * 授予只认携带者表，表外的动作写了也不生效。
 */

export type EquippedItemState = {
  slot: EquipmentSlot;
  item: WearableItemState;
};

/**
 * 从 actor 的槽位索引解析出当前穿戴中的道具。
 *
 * 槽里只存道具名；道具自身不记录 `equipped`。道具被转移或改名后，
 * 索引可能暂时指向不存在的道具，这里直接跳过。
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

/** 穿戴中的道具实际授予给角色的动作，带来源：哪一件、在哪个槽。 */
export type ActionGrant = {
  kind: CarriedActionKind;
  slot: EquipmentSlot;
  itemId: string;
  itemName: string;
};

/**
 * 携带者授予的动作清单。
 *
 * 这是“动作可以来自外部数据”的唯一入口：调用方不关心是武器还是未来的其它携带者，
 * 只问“现在谁给了我什么动作”。来源字段用于工具装配与错误文案，不参与授权判定。
 */
export function carriedActions(actor: Pick<ActorState, "items" | "equipment">): ActionGrant[] {
  const grants: ActionGrant[] = [];
  for (const { slot, item } of equippedItems(actor)) {
    // 槽位与大类不匹配的行（旧数据）不授予任何动作。
    if (!EQUIPMENT_SLOT_KINDS[slot].includes(item.kind)) {
      continue;
    }
    // 携带者表决定“这件东西能不能授予这个动作”；表外的动作一律不生效。
    const grantable = carriedActionsForKind(item.kind);
    for (const kind of item.actions) {
      if (grantable.includes(kind)) {
        grants.push({ kind, slot, itemId: item.id, itemName: item.name });
      }
    }
  }
  return grants;
}

/** 穿戴中的道具提供的动作；槽位索引指向不存在的道具时不授予。 */
export function equippedItemActions(
  actor: Pick<ActorState, "items" | "equipment">,
): CarriedActionKind[] {
  return carriedActions(actor).map((grant) => grant.kind);
}

/**
 * 携带者授予的动作上限：`strike` 恒为 1，`cleave` 读武器自己的 `maxTargets`。
 *
 * 没有携带者时回落到 1——这也是工具形状的描述值，真正的授权由 `allowedActionKinds` 与
 * 结算端复核决定。
 */
export function carriedActionCap(
  actor: Pick<ActorState, "items" | "equipment">,
  kind: CarriedActionKind,
): number {
  const grant = carriedActions(actor).find((candidate) => candidate.kind === kind);
  if (!grant) {
    return 1;
  }
  return actor.items.find((item) => item.id === grant.itemId)?.maxTargets ?? 1;
}

export function equipSlot(
  equipment: EquipmentSlots,
  slot: EquipmentSlot,
  item: { name: string; kind: ItemKind },
): EquipmentSlots {
  if (!EQUIPMENT_SLOT_KINDS[slot].includes(item.kind)) {
    throw new GameError(
      "invalid_action",
      `道具不能放进${EQUIPMENT_SLOT_LABELS[slot]}槽: ${item.name}`,
    );
  }
  const next = withoutEquippedItem(equipment, item.name);
  next[slot] = item.name;
  return next;
}

/** 卸下槽位；道具本身不动，只是不再被索引。 */
export function unequipSlot(equipment: EquipmentSlots, slot: EquipmentSlot): EquipmentSlots {
  const next = { ...equipment };
  delete next[slot];
  return next;
}

/** 道具当前占据的槽位；没被穿戴时返回 undefined。槽里只存名字，所以按名字查。 */
export function equippedSlotOf(
  equipment: EquipmentSlots,
  itemName: string,
): EquipmentSlot | undefined {
  return EQUIPMENT_SLOTS.find((slot) => equipment[slot] === itemName);
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
