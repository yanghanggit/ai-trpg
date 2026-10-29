import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { type AddressLookup, stripNameRef } from "../addressing";
import { findActorInStage, resolveActorItem } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedUse } from "../apply/types";
import { MAX_TARGET_DETAIL_LENGTH } from "../constants";
import { GameError } from "../errors";
import { applyItemEffect, hasItemEffectHandler } from "../item-effects";
import { equippedSlotOf } from "../items";
import {
  EQUIPMENT_SLOT_LABELS,
  type EquipmentSlots,
  type ItemState,
  type UseAction,
} from "../types";

/**
 * `use` 的候选物品：有可执行效果，且此刻没被穿戴。
 *
 * 与 `resolveUse` 的拒绝条件同源：候选里没有的物品，即使被模型点名也会在解析阶段失败。
 */
export function usableItemNames(items: readonly ItemState[], equipment: EquipmentSlots): string[] {
  return items
    .filter(
      (item) =>
        hasItemEffectHandler(item.effect.type) &&
        equippedSlotOf(equipment, item.name) === undefined,
    )
    .map((item) => item.name);
}

export function buildUseTool(
  availableItemNames: readonly string[],
  targetActorHandles: readonly string[],
  currentStageName: string,
): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "use",
      description:
        "把一次使用道具加入计划：使用一件背在身上、没穿戴的物品，作用于一个角色或当前场景。物品只声明 effect；use 只负责选择物品与目标并分派。targetActorHandle 与 targetStageName 二选一。正装备在槽里的物品不能使用：武器用 strike 出手，其余先 unequip。",
      parameters: {
        type: "object",
        properties: {
          itemName: {
            type: "string",
            description: "要使用的自己持有的物品名",
            ...(availableItemNames.length > 0 ? { enum: [...availableItemNames] } : {}),
          },
          targetActorHandle: {
            type: "string",
            description: "道具作用的对象角色的引用（@名字 或 #编号）；可以是自己，也可以是尸体",
            ...(targetActorHandles.length > 0 ? { enum: [...targetActorHandles] } : {}),
          },
          targetStageName: {
            type: "string",
            description: "道具作用的场景；当前只允许所在场景",
            enum: [currentStageName],
          },
          targetDetail: {
            type: "string",
            description:
              "对场景中具体位置或部位的描述；只用于 targetStageName，是行动描述而非结果。",
          },
        },
        required: ["itemName"],
      },
    },
  };
}

export function parseUse(args: Record<string, unknown>): UseAction {
  const itemName = typeof args.itemName === "string" ? args.itemName.trim() : "";
  const targetActorHandle =
    typeof args.targetActorHandle === "string" ? args.targetActorHandle.trim() : "";
  const targetStageName =
    typeof args.targetStageName === "string" ? args.targetStageName.trim() : "";
  const targetDetail = typeof args.targetDetail === "string" ? args.targetDetail.trim() : "";
  if (itemName.length === 0) {
    throw new GameError("invalid_action", "use 需要非空 itemName");
  }
  if ((targetActorHandle.length === 0) === (targetStageName.length === 0)) {
    throw new GameError("invalid_action", "use 需要 targetActorHandle 或 targetStageName 二选一");
  }
  if (targetDetail.length > MAX_TARGET_DETAIL_LENGTH) {
    throw new GameError(
      "invalid_action",
      `targetDetail 不能超过 ${MAX_TARGET_DETAIL_LENGTH} 个字符`,
    );
  }
  if (targetDetail.length > 0 && targetStageName.length === 0) {
    throw new GameError("invalid_action", "targetDetail 只能与 targetStageName 一起使用");
  }
  return {
    kind: "use",
    itemName,
    ...(targetActorHandle.length > 0 ? { targetActorHandle } : {}),
    ...(targetStageName.length > 0 ? { targetStageName: stripNameRef(targetStageName) } : {}),
    ...(targetDetail.length > 0 ? { targetDetail } : {}),
  };
}

export async function resolveUse(
  executor: Executor,
  stage: ResolvedUse["stage"],
  actorRow: ActorWithStageRow,
  action: UseAction,
): Promise<ResolvedUse> {
  const transferItem = await resolveActorItem(executor, actorRow.actor.id, action.itemName);
  // 动作由物品状态唯一决定：装备中的物品归 strike 或被动装备，不能当道具使用。
  const slot = equippedSlotOf(actorRow.actor.equipment, transferItem.name);
  if (slot) {
    throw new GameError(
      "invalid_action",
      `${transferItem.name}正装备在${EQUIPMENT_SLOT_LABELS[slot]}槽，先卸下再使用`,
    );
  }
  const targetDetail = action.targetDetail?.trim();
  if (targetDetail && targetDetail.length > MAX_TARGET_DETAIL_LENGTH) {
    throw new GameError(
      "invalid_action",
      `targetDetail 不能超过 ${MAX_TARGET_DETAIL_LENGTH} 个字符`,
    );
  }
  if (targetDetail && action.targetStageName === undefined) {
    throw new GameError("invalid_action", "targetDetail 只能与 targetStageName 一起使用");
  }

  let target: ResolvedUse["target"];
  let targetStage: ResolvedUse["targetStage"];

  if (action.targetStageName !== undefined) {
    if (stripNameRef(action.targetStageName) !== stage.name) {
      throw new GameError("invalid_action", "只能对当前所在场景使用道具");
    }
    targetStage = stage;
  } else {
    const targetActorHandle = action.targetActorHandle;
    if (!targetActorHandle) {
      throw new GameError("invalid_action", "use 缺少目标");
    }
    // 目标不要求存活：对尸体使用道具同样合法（例如未来的复活类玩法）。
    target = await findActorInStage(executor, stage.id, targetActorHandle);
  }

  return {
    kind: "use",
    action,
    stage,
    transferItem,
    ...(target ? { target } : {}),
    ...(targetStage ? { targetStage } : {}),
  };
}

export async function applyUse(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedUse,
  now: Date,
  address: AddressLookup,
  trace?: TraceContext,
): Promise<string> {
  const targetDetail = resolved.targetStage ? resolved.action.targetDetail?.trim() : undefined;
  return applyItemEffect({
    executor,
    gameId,
    actorRow,
    stage: resolved.stage,
    actionKind: "use",
    effect: resolved.transferItem.effect,
    item: resolved.transferItem,
    address,
    ...(resolved.target ? { target: resolved.target } : {}),
    ...(resolved.targetStage ? { targetStage: resolved.targetStage } : {}),
    ...(targetDetail ? { targetDetail } : {}),
    now,
    ...(trace ? { trace } : {}),
  });
}
