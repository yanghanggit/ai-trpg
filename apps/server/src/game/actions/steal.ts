import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { GameError } from "../errors";
import { withoutEquippedItem } from "../item-state";
import { type AddressLookup, actionRef } from "../kernel/addressing";
import type { StealAction } from "../kernel/types";
import { assertNotSelf, effectiveAgility, isAlive, resolveActorItem } from "../lookup";
import { appendItemObservations, appendStageMemory } from "../observations";
import { setActorEquipment } from "../persistence/actors";
import { appendPublicMessage } from "../persistence/game-messages";
import { bumpGameVersion } from "../persistence/games";
import { transferItemToActor } from "../persistence/items";
import type { ActorWithStageRow, Executor } from "../persistence/rows";
import type { ResolvedSteal } from "../settle/types";

export function buildStealTool(targetActorHandles: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "steal",
      description:
        "把一次窃取加入计划：从同场景的活人身上取走一件背包里的物品。你比目标敏捷时无人察觉；持平也能得手，但对方会察觉；不如目标敏捷时一定失手。",
      parameters: {
        type: "object",
        properties: {
          targetActorHandle: {
            type: "string",
            description: "被取走物品的同场景角色的引用（名字 或 #编号）",
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

/**
 * 偷窃只看活人：死者的东西走 loot，两边的拒绝文案互相指路。
 *
 * 敏捷决定成败与痕迹：不如目标敏捷时摸不到东西（整份计划被拒）；
 * 比目标敏捷时不写对方的观察，持平则照常通知。
 */
export async function resolveSteal(
  executor: Executor,
  stage: ResolvedSteal["stage"],
  actorRow: ActorWithStageRow,
  action: StealAction,
  target: ResolvedSteal["target"],
): Promise<ResolvedSteal> {
  assertNotSelf(target, actorRow.actor.id);
  if (!isAlive(target)) {
    throw new GameError("invalid_action", `${target.name}已经死了，搜刮尸体用 loot`);
  }
  const [thiefAgility, targetAgility] = await Promise.all([
    effectiveAgility(executor, actorRow.actor),
    effectiveAgility(executor, target),
  ]);
  if (thiefAgility < targetAgility) {
    throw new GameError("invalid_action", `${target.name}比你敏捷，你没能得手`);
  }
  const transferItem = await resolveActorItem(executor, target.id, action.itemName);
  if (Object.values(target.equipment).includes(transferItem.name)) {
    throw new GameError(
      "invalid_action",
      `${target.name}还活着，拿不走已装备的物品: ${transferItem.name}`,
    );
  }
  return {
    kind: "steal",
    action,
    stage,
    target,
    transferItem,
    noticed: thiefAgility === targetAgility,
  };
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

  await transferItemToActor(executor, item, thief.id);
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
  // 不被察觉的窃取不写对方的观察：受害者记忆里没有这一笔，公共流仍是上帝视角。
  if (resolved.noticed) {
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
  }
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
  const noticedNote = resolved.noticed
    ? `${actionRef(address(target.id))}察觉到了`
    : "没有惊动对方";
  return `# 行动结果\n你从${actionRef(address(target.id))}身上取走了${item.name}；${noticedNote}。`;
}
