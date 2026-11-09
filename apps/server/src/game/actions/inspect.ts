import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { type AddressLookup, actionRef } from "../addressing";
import { appendPublicMessage, bumpGameVersion } from "../apply/messages";
import { assertNotSelf, listActorItems } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedInspect } from "../apply/types";
import { GameError } from "../errors";
import { toItemState } from "../items";
import { appendInspectObservations, appendStageMemory } from "../observations";
import { describeItems } from "../plan/describe";
import type { InspectAction } from "../types";

/**
 * 查看他人随身携带的物品：与 `steal` / `loot` 同组的动作，不是免费读取。
 *
 * 理由：背包清单是对方的私有信息，白拿清单等于让窃取没有风险。把它做成动作之后，
 * 一次查看要占掉本轮唯一的行动，而且在场的角色都看得见有人在打量行囊——
 * 先侦察再动手的代价被摆回台面上。清单本身只有查看者自己知道。
 *
 * 动作名不带对象：`targetActorHandle` 已经说明这次看的是角色，以后要看锚点或场景，
 * 在参数里加对应的 target 即可，不需要再添一个 `inspect_xxx` 动作。
 */
export function buildInspectTool(targetActorHandles: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "inspect",
      description:
        "把一次查看加入计划：看同场景目标随身携带的全部物品（含已穿戴的），活人与尸体都能看。清单只有你自己知道，但这是一次公开动作，在场的人都看得见；它占本轮行动名额。",
      parameters: {
        type: "object",
        properties: {
          targetActorHandle: {
            type: "string",
            description: "被查看的同场景角色的引用（名字 或 #编号）",
            ...(targetActorHandles.length > 0 ? { enum: [...targetActorHandles] } : {}),
          },
        },
        required: ["targetActorHandle"],
      },
    },
  };
}

export function parseInspect(args: Record<string, unknown>): InspectAction {
  const targetActorHandle =
    typeof args.targetActorHandle === "string" ? args.targetActorHandle.trim() : "";
  if (targetActorHandle.length === 0) {
    throw new GameError("invalid_action", "inspect 需要非空 targetActorHandle");
  }
  return { kind: "inspect", targetActorHandle };
}

/** 目标可以活着也可以死了：尸体上有什么，正是搜刮前要知道的。 */
export function resolveInspect(
  stage: ResolvedInspect["stage"],
  actorId: string,
  action: InspectAction,
  target: ResolvedInspect["target"],
): ResolvedInspect {
  assertNotSelf(target, actorId);
  return { kind: "inspect", action, stage, target };
}

export async function applyInspect(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedInspect,
  now: Date,
  address: AddressLookup,
  trace?: TraceContext,
): Promise<string> {
  const inspector = { id: actorRow.actor.id, name: actorRow.actor.name };
  const target = { id: resolved.target.id, name: resolved.target.name };

  // 查看不改物品归属，但它是发生过的事：公共事件流与场景记忆都记一笔，
  // 目标与旁观者也因此知道有人翻看过行囊。
  await bumpGameVersion(executor, gameId, now);
  const content = `${inspector.name}查看了${target.name}随身携带的东西。`;
  await appendPublicMessage(executor, gameId, inspector.id, {
    kind: "inspect",
    stageId: resolved.stage.id,
    targetActorId: target.id,
    visibility: "stage",
    content,
  });
  await appendInspectObservations(
    executor,
    gameId,
    resolved.stage,
    { actor: inspector, target },
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    resolved.stage.id,
    `# 场景事件\n${content}`,
    { eventKind: "inspect", targetActorId: target.id },
    trace,
  );

  // 清单只回给查看者；它随行动事实写进记忆，下一轮仍然记得对方身上有什么。
  const items = await listActorItems(executor, target.id);
  return `# 行动结果\n你查看了${actionRef(address(target.id))}随身携带的东西。\n${describeItems({
    items: items.map(toItemState),
    equipment: resolved.target.equipment,
  })}`;
}
