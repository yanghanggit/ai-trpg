import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import { resolveStageItem } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedPickup } from "../apply/types";
import { GameError } from "../errors";
import { appendItemObservations, appendStageMemory } from "../observations";
import { moveStageItemToActor } from "../persistence/items";
import type { PickupAction } from "../types";

export function buildPickupTool(availableItemNames: readonly string[] = []): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "pickup",
      description: "把一次拾取加入计划：从当前场景的锚点上取下一件物品，放进自己的背包。",
      parameters: {
        type: "object",
        properties: {
          itemName: {
            type: "string",
            description: "要拾取的、挂在当前场景锚点上的物品名",
            ...(availableItemNames.length > 0 ? { enum: [...availableItemNames] } : {}),
          },
        },
        required: ["itemName"],
      },
    },
  };
}

export function parsePickup(args: Record<string, unknown>): PickupAction {
  const itemName = typeof args.itemName === "string" ? args.itemName.trim() : "";
  if (itemName.length === 0) {
    throw new GameError("invalid_action", "pickup 需要非空 itemName");
  }
  return { kind: "pickup", itemName };
}

export async function resolvePickup(
  executor: Executor,
  stage: ResolvedPickup["stage"],
  action: PickupAction,
): Promise<ResolvedPickup> {
  const stageItem = await resolveStageItem(executor, stage.id, action.itemName);
  const anchor = stage.anchors.find((candidate) => candidate.key === stageItem.anchorKey);
  if (!anchor) {
    throw new GameError(
      "invalid_state",
      `物品 ${stageItem.name} 没有可用的锚点: ${stageItem.anchorKey}`,
    );
  }
  return { kind: "pickup", action, stage, stageItem, anchorLabel: anchor.label };
}

export async function applyPickup(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedPickup,
  now: Date,
  trace?: TraceContext,
): Promise<string> {
  const actor = { id: actorRow.actor.id, name: actorRow.actor.name };
  const stageItem = resolved.stageItem;

  await moveStageItemToActor(executor, stageItem, actor.id);
  await bumpGameVersion(executor, gameId, now);

  const content = `${actor.name}从${resolved.anchorLabel}上拾取了${stageItem.name}。`;
  await appendPublicMessage(executor, gameId, actor.id, {
    kind: "pickup",
    stageId: resolved.stage.id,
    visibility: "stage",
    content,
  });
  await appendItemObservations(
    executor,
    gameId,
    resolved.stage,
    {
      actor,
      itemName: stageItem.name,
      event: "pickup",
      anchorLabel: resolved.anchorLabel,
    },
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    resolved.stage.id,
    `# 场景事件\n${content}`,
    {
      eventKind: "pickup",
    },
    trace,
  );
  return `# 行动结果\n你从${resolved.anchorLabel}上拾取了${stageItem.name}。`;
}
