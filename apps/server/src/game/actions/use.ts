import type { ToolDefinition } from "../../llm/types";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import { assertAlive, findActorInStage, resolveActorItem } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedUse } from "../apply/types";
import { GameError } from "../errors";
import { applyItemUseEffects } from "../item-effects";
import { appendItemObservations, appendStageEvent } from "../observations";
import type { UseAction } from "../types";

/** 构造 use 工具：用自己的物品作用于一个角色或当前场景。 */
export function buildUseTool(
  itemNames: readonly string[],
  targetActorNames: readonly string[],
  currentStageName: string,
): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "use",
      description:
        "把一次使用道具加入计划：使用自己持有的一件物品，作用于一个角色或当前场景。targetActorName 与 targetStageName 二选一。",
      parameters: {
        type: "object",
        properties: {
          itemName: {
            type: "string",
            description: "要使用的自己持有的物品名",
            ...(itemNames.length > 0 ? { enum: [...itemNames] } : {}),
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
  if (itemName.length === 0) {
    throw new GameError("invalid_action", "use 需要非空 itemName");
  }
  if ((targetActorName.length === 0) === (targetStageName.length === 0)) {
    throw new GameError("invalid_action", "use 需要 targetActorName 或 targetStageName 二选一");
  }
  return {
    kind: "use",
    itemName,
    ...(targetActorName.length > 0 ? { targetActorName } : {}),
    ...(targetStageName.length > 0 ? { targetStageName } : {}),
  };
}

/** 校验 use：物品必须是自己的；场景只能是当前场景；角色必须存活；物品行为必须接受目标。 */
export async function resolveUse(
  executor: Executor,
  stage: ResolvedUse["stage"],
  actorId: string,
  action: UseAction,
): Promise<ResolvedUse> {
  const transferItem = await resolveActorItem(executor, actorId, action.itemName);

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

  const use = transferItem.use;
  if (use) {
    const targetKind = targetStage ? "stage" : "actor";
    if (use.target !== "any" && use.target !== targetKind) {
      throw new GameError("invalid_action", `${transferItem.name} 不能用于这个目标`);
    }
    if (use.targetStageKey && targetStage?.key !== use.targetStageKey) {
      throw new GameError("invalid_action", `${transferItem.name} 不能用于这个场景`);
    }
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

/** 应用 use：写通用使用事件，再执行物品自己声明的效果。 */
export async function applyUse(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedUse,
  now: Date,
): Promise<string> {
  const actor = { id: actorRow.actor.id, name: actorRow.actor.name };
  const item = resolved.transferItem;
  const target = resolved.target;
  const targetStage = resolved.targetStage;
  const targetLabel = targetStage?.name ?? target?.name ?? "目标";

  await bumpGameVersion(executor, gameId, now);

  const content = targetStage
    ? `${actor.name}在${targetStage.name}使用了${item.name}。`
    : `${actor.name}对${targetLabel}使用了${item.name}。`;
  await appendPublicMessage(executor, gameId, actor.id, {
    kind: "use",
    stageId: resolved.stage.id,
    ...(target ? { targetActorId: target.id } : {}),
    visibility: "stage",
    content,
  });
  await appendItemObservations(executor, gameId, resolved.stage, actor, "use", item.name, {
    ...(target ? { target: { id: target.id, name: target.name } } : {}),
    ...(targetStage ? { targetStageName: targetStage.name } : {}),
    broadcast: "stage",
  });
  await appendStageEvent(executor, gameId, resolved.stage.id, `# 场景事件\n${content}`, {
    eventKind: "use",
    ...(target ? { targetActorId: target.id } : {}),
    ...(targetStage ? { targetStageId: targetStage.id } : {}),
  });

  const outcome = await applyItemUseEffects(
    {
      executor,
      gameId,
      stage: resolved.stage,
      actor,
      item,
      ...(target ? { target } : {}),
      ...(targetStage ? { targetStage } : {}),
      now,
    },
    item.use?.effects ?? [],
  );

  return `# 行动结果\n你对${targetLabel}使用了${item.name}。${
    outcome.results.length > 0 ? `\n${outcome.results.join("\n")}` : ""
  }`;
}
