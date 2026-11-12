import { carriedActionsForKind, isSlotActionKind } from "../actions";
import { GameError } from "../errors";
import { hasAffixes } from "../kernel/affixes";
import type {
  ActionKind,
  ActorState,
  EquipmentSlot,
  EquipmentSlots,
  HeldActionKind,
  ItemKind,
  SlotActionKind,
  WearableItemState,
} from "../kernel/types";
import { EQUIPMENT_SLOT_KINDS, EQUIPMENT_SLOT_LABELS, EQUIPMENT_SLOTS } from "../kernel/types";
import { isWearable } from "./project";

/**
 * 穿戴：谁此刻穿着什么、槽位索引怎么改、道具此刻借给角色哪些动作。
 *
 * 槽里只存道具名，道具自己不记 `equipped`——所以指向不存在道具的槽位一律当作没穿。
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
  kind: SlotActionKind;
  slot: EquipmentSlot;
  itemId: string;
  itemName: string;
};

/** 穿戴中的道具借出槽位动作；大类表外的动作不生效。 */
export function carriedActions(actor: Pick<ActorState, "items" | "equipment">): ActionGrant[] {
  const grants: ActionGrant[] = [];
  for (const { slot, item } of equippedItems(actor)) {
    // 槽位与大类不匹配的行（旧数据）不授予任何动作。
    if (!EQUIPMENT_SLOT_KINDS[slot].includes(item.kind)) {
      continue;
    }
    const grantable = carriedActionsForKind(item.kind);
    for (const kind of item.actions) {
      if (isSlotActionKind(kind) && grantable.includes(kind)) {
        grants.push({ kind, slot, itemId: item.id, itemName: item.name });
      }
    }
  }
  return grants;
}

/** 穿戴中的道具提供的动作；槽位索引指向不存在的道具时不授予。 */
export function equippedItemActions(
  actor: Pick<ActorState, "items" | "equipment">,
): SlotActionKind[] {
  return carriedActions(actor).map((grant) => grant.kind);
}

/** 持有携带的动作：与槽位无关，来源只有那件道具。 */
export type HeldActionGrant = {
  kind: HeldActionKind;
  itemId: string;
  itemName: string;
};

/** 持有携带：身上任何声明了 `affixes.use` 的道具都借出 `use`，与是否穿在槽里无关。 */
export function heldActions(actor: Pick<ActorState, "items" | "equipment">): HeldActionGrant[] {
  return actor.items
    .filter((item) => hasAffixes(item, "use"))
    .map((item) => ({ kind: "use" as const, itemId: item.id, itemName: item.name }));
}

export function heldItemActions(actor: Pick<ActorState, "items" | "equipment">): HeldActionKind[] {
  return heldActions(actor).map((grant) => grant.kind);
}

/**
 * 一个动作最多能指向几个目标：读授予它的那件道具自己的 `maxTargets`。
 *
 * 授予者不分槽位携带与持有携带——动作的来源就是道具，上限跟着来源走。没有授予者
 * （固有动作）或道具没声明时为 1，这也是工具形状的描述值：真正的授权由
 * `allowedActionKinds` 与结算端复核决定。多件道具授予同一动作时取第一件。
 */
export function actionMaxTargets(
  actor: Pick<ActorState, "items" | "equipment">,
  kind: ActionKind,
): number {
  const grant =
    carriedActions(actor).find((candidate) => candidate.kind === kind) ??
    heldActions(actor).find((candidate) => candidate.kind === kind);
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
