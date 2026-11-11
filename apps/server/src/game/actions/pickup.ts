import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { GameError } from "../errors";
import type { PickupAction } from "../kernel/types";
import { resolveStageItem } from "../lookup";
import { appendItemObservations, appendStageMemory } from "../observations";
import { appendPublicMessage } from "../persistence/game-messages";
import { bumpGameVersion } from "../persistence/games";
import { moveStageItemToActor } from "../persistence/items";
import type { ActorWithStageRow, Executor } from "../persistence/rows";
import type { ResolvedPickup } from "../settle/types";

export function buildPickupTool(
  availableAnchors: readonly string[] = [],
  availableItemNames: readonly string[] = [],
): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "pickup",
      description:
        "把一次拾取加入计划：从当前场景的某个锚点上取下一件物品，放进自己的背包。锚点与物品必须匹配。",
      parameters: {
        type: "object",
        properties: {
          targetAnchor: {
            type: "string",
            description: "物品所在的锚点标签",
            ...(availableAnchors.length > 0 ? { enum: [...availableAnchors] } : {}),
          },
          itemName: {
            type: "string",
            description: "要拾取的、挂在该锚点上的物品名",
            ...(availableItemNames.length > 0 ? { enum: [...new Set(availableItemNames)] } : {}),
          },
        },
        required: ["targetAnchor", "itemName"],
      },
    },
  };
}

export function parsePickup(args: Record<string, unknown>): PickupAction {
  const targetAnchor = typeof args.targetAnchor === "string" ? args.targetAnchor.trim() : "";
  const itemName = typeof args.itemName === "string" ? args.itemName.trim() : "";
  if (targetAnchor.length === 0) {
    throw new GameError("invalid_action", "pickup 需要非空 targetAnchor");
  }
  if (itemName.length === 0) {
    throw new GameError("invalid_action", "pickup 需要非空 itemName");
  }
  return { kind: "pickup", targetAnchor, itemName };
}

export async function resolvePickup(
  executor: Executor,
  stage: ResolvedPickup["stage"],
  action: PickupAction,
): Promise<ResolvedPickup> {
  const anchor = stage.anchors.find((candidate) => candidate.label === action.targetAnchor);
  if (!anchor) {
    throw new GameError("invalid_action", `当前场景没有这个可交互锚点: ${action.targetAnchor}`);
  }
  const stageItem = await resolveStageItem(executor, stage.id, anchor, action.itemName);
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
