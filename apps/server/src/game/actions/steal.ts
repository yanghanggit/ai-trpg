import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { type AddressLookup, actionRef, plainEntityName } from "../addressing";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import {
  assertItemNameFree,
  assertNotSelf,
  findActorInStage,
  isAlive,
  resolveActorItem,
} from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedSteal } from "../apply/types";
import { GameError } from "../errors";
import { withoutEquippedItem } from "../items";
import { appendItemObservations, appendStageMemory } from "../observations";
import { setActorEquipment } from "../persistence/actors";
import { transferItemToActor } from "../persistence/items";
import type { StealAction } from "../types";

export function buildStealTool(targetActorHandles: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "steal",
      description:
        "把一次窃取加入计划：从同场景的一个角色身上取走一件物品。目标还活着时只能拿走背包里的东西，已经穿戴在身上的拿不走；目标死亡（尸体）时什么都能拿走。先用 observe_actor 查看对方携带的物品。只有发起者与目标会知道。",
      parameters: {
        type: "object",
        properties: {
          targetActorHandle: {
            type: "string",
            description: "被取走物品的同场景角色的指代（@数字）",
            ...(targetActorHandles.length > 0 ? { enum: [...targetActorHandles] } : {}),
          },
          itemName: { type: "string", description: "要取走的物品名" },
        },
        required: ["targetActorHandle", "itemName"],
      },
    },
  };
}

export function parseSteal(args: Record<string, unknown>): StealAction {
  const targetActorHandle =
    typeof args.targetActorHandle === "string" ? args.targetActorHandle.trim() : "";
  const itemName = typeof args.itemName === "string" ? args.itemName.trim() : "";
  if (targetActorHandle.length === 0 || itemName.length === 0) {
    throw new GameError("invalid_action", "steal 需要非空 targetActorHandle 与 itemName");
  }
  return { kind: "steal", targetActorHandle, itemName };
}

/** 尸体上什么都能拿，所以只有活着目标要挡已穿戴的物品。 */
export async function resolveSteal(
  executor: Executor,
  stage: ResolvedSteal["stage"],
  actorId: string,
  action: StealAction,
): Promise<ResolvedSteal> {
  const target = await findActorInStage(executor, stage.id, action.targetActorHandle);
  assertNotSelf(target, actorId);
  const transferItem = await resolveActorItem(executor, target.id, action.itemName);
  if (isAlive(target) && Object.values(target.equipment).includes(transferItem.name)) {
    throw new GameError(
      "invalid_action",
      `${target.name}还活着，拿不走已装备的物品: ${transferItem.name}`,
    );
  }
  return { kind: "steal", action, stage, target, transferItem };
}

export async function applySteal(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedSteal,
  now: Date,
  address: AddressLookup,
  trace?: TraceContext,
): Promise<string> {
  const thief = { id: actorRow.actor.id, name: actorRow.actor.name };
  const target = { id: resolved.target.id, name: resolved.target.name };
  const item = resolved.transferItem;

  await assertItemNameFree(executor, thief.id, item.name);
  await transferItemToActor(executor, item.id, thief.id);
  await setActorEquipment(
    executor,
    target.id,
    withoutEquippedItem(resolved.target.equipment, item.name),
    now,
  );
  await bumpGameVersion(executor, gameId, now);

  const content = `${thief.name}从${target.name}身上取走了${item.name}。`;
  await appendPublicMessage(executor, gameId, thief.id, {
    kind: "steal",
    stageId: resolved.stage.id,
    targetActorId: target.id,
    visibility: "private",
    content,
  });
  await appendItemObservations(
    executor,
    gameId,
    resolved.stage,
    {
      actor: thief,
      itemName: item.name,
      event: "steal",
      target,
    },
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    resolved.stage.id,
    `# 场景事件\n${content}`,
    {
      eventKind: "steal",
      targetActorId: target.id,
    },
    trace,
  );
  return `# 行动结果\n你从${actionRef(address(target.id))}身上取走了${plainEntityName(item.name)}。`;
}
