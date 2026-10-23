import type { ToolDefinition } from "../../llm/types";
import { assertAlive, findActorInStage, resolveActorItem } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedUse } from "../apply/types";
import { MAX_TARGET_DETAIL_LENGTH } from "../constants";
import { GameError } from "../errors";
import { applyItemEffect } from "../item-effects";
import type { UseAction } from "../types";

/** 构造 use 工具：用自己的一件物品作用于一个角色或当前场景。 */
export function buildUseTool(
  availableItemNames: readonly string[],
  targetActorNames: readonly string[],
  currentStageName: string,
): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "use",
      description:
        "把一次使用道具加入计划：使用自己持有的一件物品，作用于一个角色或当前场景。物品只声明 effect；use 只负责选择物品与目标并分派。targetActorName 与 targetStageName 二选一。",
      parameters: {
        type: "object",
        properties: {
          itemName: {
            type: "string",
            description: "要使用的自己持有的物品名",
            ...(availableItemNames.length > 0 ? { enum: [...availableItemNames] } : {}),
          },
          targetActorName: {
            type: "string",
            description: "道具作用的对象角色；可以是自己",
            ...(targetActorNames.length > 0 ? { enum: [...targetActorNames] } : {}),
          },
          targetStageName: {
            type: "string",
            description: "道具作用的场景；当前只允许所在场景",
            enum: [currentStageName],
          },
          targetDetail: {
            type: "string",
            description:
              "对场景具体位置或部位的描述，例如锁孔、炉膛；只用于 targetStageName，是行动描述而非结果。",
          },
        },
        required: ["itemName"],
      },
    },
  };
}

/** 把 use 工具参数转成动作；只检查形状。 */
export function parseUse(args: Record<string, unknown>): UseAction {
  const itemName = typeof args.itemName === "string" ? args.itemName.trim() : "";
  const targetActorName =
    typeof args.targetActorName === "string" ? args.targetActorName.trim() : "";
  const targetStageName =
    typeof args.targetStageName === "string" ? args.targetStageName.trim() : "";
  const targetDetail = typeof args.targetDetail === "string" ? args.targetDetail.trim() : "";
  if (itemName.length === 0) {
    throw new GameError("invalid_action", "use 需要非空 itemName");
  }
  if ((targetActorName.length === 0) === (targetStageName.length === 0)) {
    throw new GameError("invalid_action", "use 需要 targetActorName 或 targetStageName 二选一");
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
    ...(targetActorName.length > 0 ? { targetActorName } : {}),
    ...(targetStageName.length > 0 ? { targetStageName } : {}),
    ...(targetDetail.length > 0 ? { targetDetail } : {}),
  };
}

/** 校验 use：物品必须是自己的，目标必须有效。 */
export async function resolveUse(
  executor: Executor,
  stage: ResolvedUse["stage"],
  actorId: string,
  action: UseAction,
): Promise<ResolvedUse> {
  const transferItem = await resolveActorItem(executor, actorId, action.itemName);
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
    if (action.targetStageName !== stage.name) {
      throw new GameError("invalid_action", "只能对当前所在场景使用道具");
    }
    targetStage = stage;
  } else {
    const targetActorName = action.targetActorName;
    if (!targetActorName) {
      throw new GameError("invalid_action", "use 缺少目标");
    }
    target = await findActorInStage(executor, stage.id, targetActorName);
    assertAlive(target);
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

/** 应用 use：只选择物品与目标，并把声明式 effect 交给效果执行器。 */
export async function applyUse(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedUse,
  now: Date,
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
    ...(resolved.target ? { target: resolved.target } : {}),
    ...(resolved.targetStage ? { targetStage: resolved.targetStage } : {}),
    ...(targetDetail ? { targetDetail } : {}),
    now,
  });
}
