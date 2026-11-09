import { allowedActionKinds } from "../actions";
import { usableItemNames } from "../actions/use";
import { type ActorWithStage, otherActorsInStage } from "../actor-state";
import { type AddressLookup, addressLookupFor } from "../addressing";
import { carriedActionCap, equippedItemActions, isWearable } from "../items";
import { adjacentStageRefsForActor } from "../plan";
import {
  type ActionKind,
  type ActorState,
  EQUIPMENT_SLOTS,
  type EquipmentSlot,
  type GameStateSlice,
} from "../types";

/**
 * 一轮 actor 回合里「看得到什么、能做什么」的全部派生结果。
 *
 * 任务提示词与工具表都从这里取：同一份 targets / allowed / 物品名不会各算一遍，
 * 也就不会出现提示词里说能做、工具里却没有的错位。
 *
 * 只有读取，不含任何 LLM 或写入：测试可以直接构造 state 断言这里的输出。
 */
export type ActorTurnContext = {
  state: GameStateSlice;
  current: ActorWithStage;
  /** 可移动到的相邻场景：去过的写名字，没走过的只给编号。 */
  stageRefs: string[];
  /** 同场景的其他角色，尸体也在内。 */
  others: ActorState[];
  /** 本 actor 视角的地址解析。 */
  address: AddressLookup;
  /** 自己的引用，写进提示词供模型在行动里指认自己。 */
  selfHandle: string;
  /** 可作用对象：同场景他人在名单里的称呼。 */
  targets: string[];
  /** `use` 能指向的角色：自己与同场景他人。 */
  selfAndTargets: string[];
  /** 本轮真正会出现在工具列表里的动作：固有动作 ∪ 携带者授予。 */
  allowed: ActionKind[];
  /** 背包里能当道具的物品名：未穿戴，且声明了 use 词缀。 */
  usableItemNames: string[];
  /** 能穿到槽位上的物品名。 */
  wearableItemNames: string[];
  /** 已占用的槽位。 */
  occupiedSlots: EquipmentSlot[];
  /** 横扫的目标上限，属于当前穿戴的武器；没武器时回落到 1。 */
  cleaveMaxTargets: number;
};

export function actorTurnContext(state: GameStateSlice, current: ActorWithStage): ActorTurnContext {
  const others = otherActorsInStage(current.stage, current.actor.id);
  const address = addressLookupFor(state, current.actor, current.stage);
  const targets = others.map((actor) => address(actor.id).token);
  return {
    state,
    current,
    stageRefs: adjacentStageRefsForActor(state, current),
    others,
    address,
    selfHandle: address(current.actor.id).token,
    targets,
    selfAndTargets: [address(current.actor.id).token, ...targets],
    allowed: allowedActionKinds(current.actor.actions, equippedItemActions(current.actor)),
    usableItemNames: usableItemNames(current.actor.items, current.actor.equipment),
    wearableItemNames: current.actor.items.filter(isWearable).map((item) => item.name),
    occupiedSlots: EQUIPMENT_SLOTS.filter((slot) => current.actor.equipment[slot] !== undefined),
    cleaveMaxTargets: carriedActionCap(current.actor, "cleave"),
  };
}
