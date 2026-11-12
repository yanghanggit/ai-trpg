import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { GameError } from "../errors";
import { awarenessRuleText, effectiveSourcesOf, inspectNoticed } from "../gameplay";
import { toItemState } from "../item-state";
import { describeItems } from "../item-state/describe";
import { type AddressLookup, actionRef } from "../kernel/addressing";
import type { InspectAction } from "../kernel/types";
import { assertNotSelf, isAlive, listActorItems, wearerView } from "../lookup";
import { appendInspectObservations, appendStageMemory } from "../observations";
import { appendPublicMessage } from "../persistence/game-messages";
import type { ActorWithStageRow, Executor } from "../persistence/rows";
import type { ResolvedInspect } from "../settle/types";

/**
 * 查看他人随身携带的道具：与 `steal` / `loot` 同组的动作，不是免费读取。
 *
 * 理由：背包清单是对方的私有信息，白拿清单等于让窃取没有风险。把它做成动作之后，
 * 一次查看要占掉本轮唯一的行动，而且能不能不被察觉要看敏捷——
 * 先侦察再动手的代价被摆回台面上。清单本身只有查看者自己知道。
 *
 * 动作名不带对象：`targetActorHandle` 已经说明这次看的是角色，以后要看锚点或舞台，
 * 在参数里加对应的 target 即可，不需要再添一个 `inspect_xxx` 动作。
 */
export function buildInspectTool(targetActorHandles: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "inspect",
      description: `把一次查看加入计划：看同舞台目标随身携带的全部道具（含已穿戴的），活人与尸体都能看。${awarenessRuleText("inspect")}它占本轮行动名额。`,
      parameters: {
        type: "object",
        properties: {
          targetActorHandle: {
            type: "string",
            description: "被查看的同舞台角色的引用（名字 或 #编号）",
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

/**
 * 目标可以活着也可以死了：尸体上有什么，正是搜刮前要知道的。
 *
 * 察觉与否由玩法层判定（`gameplay/awareness.ts`）：尸体不会察觉，活人那一眼算不算
 * 痕迹不在这个动作里定。
 */
export async function resolveInspect(
  executor: Executor,
  stage: ResolvedInspect["stage"],
  actorRow: ActorWithStageRow,
  action: InspectAction,
  target: ResolvedInspect["target"],
): Promise<ResolvedInspect> {
  assertNotSelf(target, actorRow.actor.id);
  const [inspector, targetView] = await Promise.all([
    wearerView(executor, actorRow.actor),
    wearerView(executor, target),
  ]);
  const [inspectorSources, targetSources] = [
    effectiveSourcesOf(inspector),
    effectiveSourcesOf(targetView),
  ];
  return {
    kind: "inspect",
    action,
    stage,
    target,
    noticed: inspectNoticed(
      { self: inspectorSources.agility, target: targetSources.agility },
      isAlive(target),
    ),
  };
}

export async function applyInspect(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedInspect,
  address: AddressLookup,
  trace?: TraceContext,
): Promise<string> {
  const inspector = { id: actorRow.actor.id, name: actorRow.actor.name };
  const target = { id: resolved.target.id, name: resolved.target.name };

  // 查看不改道具归属，但它是发生过的事：公共事件流与舞台记忆都记一笔，
  // 目标与旁观者也因此知道有人翻看过行囊。
  const content = `${inspector.name}查看了${target.name}随身携带的东西。`;
  await appendPublicMessage(executor, gameId, inspector.id, {
    kind: "inspect",
    stageId: resolved.stage.id,
    targetActorId: target.id,
    visibility: "stage",
    content,
  });
  // 不被察觉的查看不写任何观察；公共流与舞台记忆仍是上帝视角。
  if (resolved.noticed) {
    await appendInspectObservations(
      executor,
      gameId,
      resolved.stage,
      { actor: inspector, target },
      trace,
    );
  }
  await appendStageMemory(
    executor,
    gameId,
    resolved.stage.id,
    `# 舞台事件\n${content}`,
    { eventKind: "inspect", targetActorId: target.id },
    trace,
  );

  // 清单只回给查看者；它随行动事实写进记忆，下一轮仍然记得对方身上有什么。
  const items = await listActorItems(executor, target.id);
  const noticedNote = resolved.noticed
    ? `${actionRef(address(target.id))}察觉到了`
    : "对方没有察觉";
  return `你查看了${actionRef(address(target.id))}随身携带的东西；${noticedNote}。\n${describeItems(
    {
      items: items.map(toItemState),
      equipment: resolved.target.equipment,
    },
  )}`;
}
