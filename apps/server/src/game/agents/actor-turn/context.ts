import { ACTION_KINDS, allowedActionKinds } from "../../actions";
import { type ActorWithStage, otherActorsInStage } from "../../actor-state";
import {
  actionMaxTargets,
  equippedItemActions,
  heldItemActions,
  isWearable,
} from "../../item-state";
import { type AddressLookup, addressLookupFor } from "../../kernel/addressing";
import { itemNamesWithTrigger } from "../../kernel/affixes";
import {
  type ActionKind,
  type ActorState,
  AFFIX_TRIGGERS,
  type AffixTrigger,
  EQUIPMENT_SLOTS,
  type EquipmentSlot,
  type GameStateSlice,
} from "../../kernel/types";
import { adjacentStageRefsForActor } from "./observed-stage";

/**
 * 一轮 actor 回合里「看得到什么、能做什么」的全部派生结果。
 *
 * 任务提示词与工具表都从这里取：同一份 targets / allowed / 道具名不会各算一遍，
 * 也就不会出现提示词里说能做、工具里却没有的错位。
 *
 * 只有读取，不含任何 LLM 或写入：测试可以直接构造 state 断言这里的输出。
 */
export type ActorTurnContext = {
  state: GameStateSlice;
  current: ActorWithStage;
  /** 可移动到的相邻舞台：去过的写名字，没走过的只给编号。 */
  stageRefs: string[];
  /** 同舞台的其他角色，尸体也在内。 */
  others: ActorState[];
  /** 本 actor 视角的地址解析。 */
  address: AddressLookup;
  /** 自己的引用，写进提示词供模型在行动里指认自己。 */
  selfHandle: string;
  /** 可作用对象：同舞台他人在名单里的称呼。 */
  targets: string[];
  /** `use` 能指向的角色：自己与同舞台他人。 */
  selfAndTargets: string[];
  /** 本轮真正会出现在工具列表里的动作：固有动作 ∪ 槽位携带 ∪ 持有携带。 */
  allowed: ActionKind[];
  /**
   * 本回合各触发能拿哪些道具：身上那件道具声明了这个触发的词缀，它就在名单里。
   *
   * 与触发清单同源，新增触发不需要在这里加字段。
   */
  triggerItems: Record<AffixTrigger, string[]>;
  /** 能穿到槽位上的道具名。 */
  wearableItemNames: string[];
  /** 已占用的槽位。 */
  occupiedSlots: EquipmentSlot[];
  /** 每个动作的目标上限：由授予那个动作的道具声明，没授予者或没声明时为 1。 */
  actionCaps: Record<ActionKind, number>;
};

export function actorTurnContext(state: GameStateSlice, current: ActorWithStage): ActorTurnContext {
  const others = otherActorsInStage(current.stage, current.actor.id);
  const address = addressLookupFor(state, current.actor, current.stage);
  const targets = others.map((actor) => address(actor.id).token);
  const slotActions = equippedItemActions(current.actor);
  const triggerItems = Object.fromEntries(
    AFFIX_TRIGGERS.map((trigger) => [trigger, itemNamesWithTrigger(current.actor.items, trigger)]),
  ) as Record<AffixTrigger, string[]>;
  return {
    state,
    current,
    stageRefs: adjacentStageRefsForActor(state, current),
    others,
    address,
    selfHandle: address(current.actor.id).token,
    targets,
    selfAndTargets: [address(current.actor.id).token, ...targets],
    allowed: allowedActionKinds(current.actor.actions, slotActions, heldItemActions(current.actor)),
    triggerItems,
    wearableItemNames: current.actor.items.filter(isWearable).map((item) => item.name),
    occupiedSlots: EQUIPMENT_SLOTS.filter((slot) => current.actor.equipment[slot] !== undefined),
    actionCaps: Object.fromEntries(
      ACTION_KINDS.map((kind) => [kind, actionMaxTargets(current.actor, kind)]),
    ) as Record<ActionKind, number>,
  };
}
