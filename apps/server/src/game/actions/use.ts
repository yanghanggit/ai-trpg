import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import type { AddressLookup } from "../addressing";
import {
  applyStaticItemAction,
  hasAffixes,
  type StaticItemActionResult,
  staticAffixes,
} from "../affixes";
import { resolveActorItem } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedUse } from "../apply/types";
import { GameError } from "../errors";
import { equippedSlotOf } from "../items";
import { applyUseEvent } from "../items/use-event";

import {
  EQUIPMENT_SLOT_LABELS,
  type EquipmentSlots,
  type ItemState,
  type UseAction,
} from "../types";

/**
 * `use` 的候选物品：声明了 `affixes.use`，且此刻没被穿戴。
 *
 * 与 `resolveUse` 的拒绝条件同源：候选里没有的物品，即使被模型点名也会在解析阶段失败。
 */
export function usableItemNames(items: readonly ItemState[], equipment: EquipmentSlots): string[] {
  return items
    .filter((item) => hasAffixes(item, "use") && equippedSlotOf(equipment, item.name) === undefined)
    .map((item) => item.name);
}

export function buildUseTool(
  availableItemNames: readonly string[],
  targetActorHandles: readonly string[],
  currentStageName: string,
  stageAnchors: readonly string[] = [],
): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "use",
      description:
        "把一次使用道具加入计划：使用一件没穿戴的物品，作用于一个角色或当前场景（二选一）。",
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
            description: "道具作用的对象角色的引用（名字 或 #编号）；可以是自己，也可以是尸体",
            ...(targetActorHandles.length > 0 ? { enum: [...targetActorHandles] } : {}),
          },
          targetStageName: {
            type: "string",
            description: "道具作用的场景",
            enum: [currentStageName],
          },
          ...(stageAnchors.length > 0
            ? {
                targetAnchor: {
                  type: "string",
                  description: "当前场景的可交互锚点（仅配合 targetStageName）",
                  enum: [...stageAnchors],
                },
              }
            : {}),
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
  const targetAnchor = typeof args.targetAnchor === "string" ? args.targetAnchor.trim() : "";
  if (itemName.length === 0) {
    throw new GameError("invalid_action", "use 需要非空 itemName");
  }
  if ((targetActorHandle.length === 0) === (targetStageName.length === 0)) {
    throw new GameError("invalid_action", "use 需要 targetActorHandle 或 targetStageName 二选一");
  }
  if (targetAnchor.length > 0 && targetStageName.length === 0) {
    throw new GameError("invalid_action", "targetAnchor 只能与 targetStageName 一起使用");
  }
  return {
    kind: "use",
    itemName,
    ...(targetActorHandle.length > 0 ? { targetActorHandle } : {}),
    ...(targetStageName.length > 0 ? { targetStageName } : {}),
    ...(targetAnchor.length > 0 ? { targetAnchor } : {}),
  };
}

/** 静态词缀里是否有 damage op；`use` 指向场景时不成立。 */
function hasDamageOp(item: { affixes: ItemState["affixes"] }): boolean {
  return staticAffixes(item, "use").some((affix) =>
    (affix.ops ?? []).some((op) => op.kind === "damage"),
  );
}

export async function resolveUse(
  executor: Executor,
  stage: ResolvedUse["stage"],
  actorRow: ActorWithStageRow,
  action: UseAction,
  targetActor?: ResolvedUse["target"],
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
  if (!hasAffixes(transferItem, "use")) {
    throw new GameError("invalid_action", `物品没有可用的使用词缀: ${transferItem.name}`);
  }
  const targetAnchor = action.targetAnchor?.trim();
  if (targetAnchor && action.targetStageName === undefined) {
    throw new GameError("invalid_action", "targetAnchor 只能与 targetStageName 一起使用");
  }

  let target: ResolvedUse["target"];
  let targetStage: ResolvedUse["targetStage"];

  if (action.targetStageName !== undefined) {
    if (action.targetStageName !== stage.name) {
      throw new GameError("invalid_action", "只能对当前所在场景使用道具");
    }
    if (
      targetAnchor !== undefined &&
      !stage.anchors.some((anchor) => anchor.label === targetAnchor)
    ) {
      throw new GameError("invalid_action", "当前场景没有这个可交互锚点");
    }
    if (hasDamageOp(transferItem)) {
      throw new GameError("invalid_action", "伤害词缀需要角色目标，不能作用于场景或锚点");
    }
    targetStage = stage;
  } else {
    if (!targetActor) {
      throw new GameError("invalid_action", "use 缺少目标");
    }
    // 目标不要求存活：对尸体使用道具同样合法（例如未来的复活类玩法）。
    target = targetActor;
  }

  return {
    kind: "use",
    action,
    stage,
    transferItem,
    ...(target ? { target } : {}),
    ...(targetStage ? { targetStage } : {}),
    ...(targetAnchor ? { targetAnchor } : {}),
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
): Promise<StaticItemActionResult> {
  const targetAnchor = resolved.targetStage ? resolved.targetAnchor : undefined;
  const baseFeedback = await applyUseEvent({
    executor,
    gameId,
    actorRow,
    stage: resolved.stage,
    item: resolved.transferItem,
    ...(resolved.target ? { target: resolved.target } : {}),
    ...(resolved.targetStage ? { targetStage: resolved.targetStage } : {}),
    ...(targetAnchor ? { targetAnchor } : {}),
    now,
    address,
    ...(trace ? { trace } : {}),
  });
  const staticResult = await applyStaticItemAction({
    executor,
    gameId,
    actorRow,
    stage: resolved.stage,
    item: resolved.transferItem,
    trigger: "use",
    action: "use",
    ...(resolved.target ? { target: resolved.target } : {}),
    ...(targetAnchor ? { targetAnchor } : {}),
    now,
    address,
    ...(trace ? { trace } : {}),
  });
  return {
    ...staticResult,
    feedback: [baseFeedback, staticResult.feedback].filter((line) => line.length > 0).join("\n\n"),
  };
}
