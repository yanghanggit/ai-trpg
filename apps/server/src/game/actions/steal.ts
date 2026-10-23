import { eq } from "drizzle-orm";
import { items } from "../../db/schema";
import type { ToolDefinition } from "../../llm/types";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import {
  assertItemNameFree,
  assertNotSelf,
  findActorInStage,
  resolveActorItem,
} from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedSteal } from "../apply/types";
import { GameError } from "../errors";
import { appendItemObservations, appendStageEvent } from "../observations";
import type { StealAction } from "../types";

/** 构造 steal 工具：从同场景角色身上取走一件物品；目标可以已经死亡。 */
export function buildStealTool(targetActorNames: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "steal",
      description:
        "把一次窃取加入计划：从同场景的一个角色身上取走一件物品；目标可以是尸体。先用 get_actor 查看对方持有的物品。只有发起者与目标会知道。",
      parameters: {
        type: "object",
        properties: {
          targetActorName: {
            type: "string",
            description: "被取走物品的同场景角色",
            ...(targetActorNames.length > 0 ? { enum: [...targetActorNames] } : {}),
          },
          itemName: { type: "string", description: "要取走的物品名" },
        },
        required: ["targetActorName", "itemName"],
      },
    },
  };
}

/** 把 steal 工具参数转成动作；只检查形状。 */
export function parseSteal(args: Record<string, unknown>): StealAction {
  const targetActorName =
    typeof args.targetActorName === "string" ? args.targetActorName.trim() : "";
  const itemName = typeof args.itemName === "string" ? args.itemName.trim() : "";
  if (targetActorName.length === 0 || itemName.length === 0) {
    throw new GameError("invalid_action", "steal 需要非空 targetActorName 与 itemName");
  }
  return { kind: "steal", targetActorName, itemName };
}

/** 校验 steal：目标不是自己，且确实持有该物品。 */
export async function resolveSteal(
  executor: Executor,
  stage: ResolvedSteal["stage"],
  actorId: string,
  action: StealAction,
): Promise<ResolvedSteal> {
  const target = await findActorInStage(executor, stage.id, action.targetActorName);
  assertNotSelf(target, actorId);
  const transferItem = await resolveActorItem(executor, target.id, action.itemName);
  return { kind: "steal", action, stage, target, transferItem };
}

/** 应用 steal：把物品转给发起者，事件为 private。 */
export async function applySteal(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedSteal,
  now: Date,
): Promise<string> {
  const thief = { id: actorRow.actor.id, name: actorRow.actor.name };
  const target = { id: resolved.target.id, name: resolved.target.name };
  const item = resolved.transferItem;

  await assertItemNameFree(executor, thief.id, item.name);
  await executor.update(items).set({ actorId: thief.id }).where(eq(items.id, item.id));
  await bumpGameVersion(executor, gameId, now);

  const content = `${thief.name}从${target.name}身上取走了${item.name}。`;
  await appendPublicMessage(executor, gameId, thief.id, {
    kind: "steal",
    stageId: resolved.stage.id,
    targetActorId: target.id,
    visibility: "private",
    content,
  });
  await appendItemObservations(executor, gameId, resolved.stage, thief, "steal", item.name, {
    target,
    broadcast: "private",
  });
  await appendStageEvent(executor, gameId, resolved.stage.id, `# 场景事件\n${content}`, {
    eventKind: "steal",
    targetActorId: target.id,
  });
  return `# 行动结果\n你从${target.name}身上取走了${item.name}。`;
}
