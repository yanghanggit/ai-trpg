import type { ToolDefinition } from "../../llm/types";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import { assertItemNameFree, resolveStageItem } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedPickup } from "../apply/types";
import { GameError } from "../errors";
import { appendItemObservations, appendStageEvent } from "../observations";
import { moveStageItemToActor } from "../persistence/items";
import type { PickupAction } from "../types";

export function buildPickupTool(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "pickup",
      description:
        "把一次拾取加入计划：拾起当前场景中的一件物品，放进自己的背包。物品名来自 look_stage。",
      parameters: {
        type: "object",
        properties: {
          itemName: { type: "string", description: "要拾取的当前场景物品名" },
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
  return { kind: "pickup", action, stage, stageItem };
}

export async function applyPickup(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedPickup,
  now: Date,
): Promise<string> {
  const actor = { id: actorRow.actor.id, name: actorRow.actor.name };
  const stageItem = resolved.stageItem;

  await assertItemNameFree(executor, actor.id, stageItem.name);
  await moveStageItemToActor(executor, stageItem, actor.id);
  await bumpGameVersion(executor, gameId, now);

  const content = `${actor.name}拾取了${stageItem.name}。`;
  await appendPublicMessage(executor, gameId, actor.id, {
    kind: "pickup",
    stageId: resolved.stage.id,
    visibility: "stage",
    content,
  });
  await appendItemObservations(executor, gameId, resolved.stage, actor, "pickup", stageItem.name, {
    broadcast: "stage",
  });
  await appendStageEvent(executor, gameId, resolved.stage.id, `# 场景事件\n${content}`, {
    eventKind: "pickup",
  });
  return `# 行动结果\n你拾取了${stageItem.name}。`;
}
