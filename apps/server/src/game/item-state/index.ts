/**
 * 道具的状态层：道具是什么（投影），以及谁穿着它（槽位与授予）。
 *
 * 与 `actor-state/`、`stage-state/` 同一条轴：只读已装载的状态，不碰数据库。
 * 定义侧的校验在 `world-definition/item-schema.ts`，行怎么搬在 `persistence/items.ts`。
 */

export {
  describeEquipment,
  describeEquipmentBrief,
  describeItems,
  itemSourceNote,
} from "./describe";
export { isWearable, toItemState } from "./project";
export {
  type ActionGrant,
  actionMaxTargets,
  carriedActions,
  type EquippedItemState,
  equippedItemActions,
  equippedItems,
  equippedSlotOf,
  equipSlot,
  type HeldActionGrant,
  heldActions,
  heldItemActions,
  unequipSlot,
  withoutEquippedItem,
} from "./slots";
