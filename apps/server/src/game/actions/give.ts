import type { ToolDefinition } from "../../llm/types";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import {
  assertItemNameFree,
  assertNotSelf,
  findActorInStage,
  resolveActorItem,
} from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedGive } from "../apply/types";
import { GameError } from "../errors";
import { withoutEquippedItem } from "../items";
import { appendItemObservations, appendStageMemory } from "../observations";
import { setActorEquipment } from "../persistence/actors";
import { transferItemToActor } from "../persistence/items";
import type { GiveAction } from "../types";

export function buildGiveTool(targetActorNames: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "give",
      description:
        "把一次给予加入计划：把自己持有的一件物品交给同场景的一个角色，场景内其他角色也能看见。",
      parameters: {
        type: "object",
        properties: {
          targetActorName: {
            type: "string",
            description: "接收物品的同场景角色；尸体也可以",
            ...(targetActorNames.length > 0 ? { enum: [...targetActorNames] } : {}),
          },
          itemName: {
            type: "string",
            description: "要交出的自己持有的物品名",
          },
        },
        required: ["targetActorName", "itemName"],
      },
    },
  };
}

export function parseGive(args: Record<string, unknown>): GiveAction {
  const targetActorName =
    typeof args.targetActorName === "string" ? args.targetActorName.trim() : "";
  const itemName = typeof args.itemName === "string" ? args.itemName.trim() : "";
  if (targetActorName.length === 0 || itemName.length === 0) {
    throw new GameError("invalid_action", "give 需要非空 targetActorName 与 itemName");
  }
  return { kind: "give", targetActorName, itemName };
}

/** 校验 give：目标不是自己，自己确实持有该物品；尸体也可以是接收方。 */
export async function resolveGive(
  executor: Executor,
  stage: ResolvedGive["stage"],
  actorId: string,
  action: GiveAction,
): Promise<ResolvedGive> {
  const target = await findActorInStage(executor, stage.id, action.targetActorName);
  assertNotSelf(target, actorId);
  const transferItem = await resolveActorItem(executor, actorId, action.itemName);
  return { kind: "give", action, stage, target, transferItem };
}

export async function applyGive(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedGive,
  now: Date,
): Promise<string> {
  const giver = { id: actorRow.actor.id, name: actorRow.actor.name };
  const target = { id: resolved.target.id, name: resolved.target.name };
  const item = resolved.transferItem;

  await assertItemNameFree(executor, target.id, item.name);
  await transferItemToActor(executor, item.id, target.id);
  await setActorEquipment(
    executor,
    giver.id,
    withoutEquippedItem(actorRow.actor.equipment, item.name),
    now,
  );
  await bumpGameVersion(executor, gameId, now);

  const content = `${giver.name}把${item.name}交给了${target.name}。`;
  await appendPublicMessage(executor, gameId, giver.id, {
    kind: "give",
    stageId: resolved.stage.id,
    targetActorId: target.id,
    visibility: "stage",
    content,
  });
  await appendItemObservations(executor, gameId, resolved.stage, {
    actor: giver,
    itemName: item.name,
    event: "give",
    target,
  });
  await appendStageMemory(executor, gameId, resolved.stage.id, `# 场景事件\n${content}`, {
    eventKind: "give",
    targetActorId: target.id,
  });
  return `# 行动结果\n你把${item.name}交给了${target.name}。`;
}
