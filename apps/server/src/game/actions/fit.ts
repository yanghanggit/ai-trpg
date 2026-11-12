import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { applyStaticItemAction, type StaticItemActionResult } from "../agents/affixes";
import { GameError } from "../errors";
import type { AddressLookup } from "../kernel/addressing";
import { hasAffixes } from "../kernel/affixes";
import type { FitAction } from "../kernel/types";
import { resolveActorItem } from "../lookup";
import { appendItemObservations, appendStageMemory } from "../observations";
import { appendPublicMessage } from "../persistence/game-messages";
import type { ActorWithStageRow, Executor } from "../persistence/rows";
import type { ResolvedFit } from "../settle/types";

export function buildFitTool(
  availableItemNames: readonly string[],
  availableAnchors: readonly string[] = [],
): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "fit",
      description:
        "把一次动手加入计划：把自己带着的一件道具对上当前舞台的某个锚点，试它配不配、能不能让那处地方动起来。会不会这门手艺看角色，会发生什么看道具。",
      parameters: {
        type: "object",
        properties: {
          itemName: {
            type: "string",
            description: "要拿去对上的道具名；必须是自己带着的",
            // 手艺在人是常驻的，手里的东西可能还没到手：没有候选就不给枚举。
            ...(availableItemNames.length > 0 ? { enum: [...availableItemNames] } : {}),
          },
          targetAnchor: {
            type: "string",
            description: "要对上的锚点标签",
            ...(availableAnchors.length > 0 ? { enum: [...availableAnchors] } : {}),
          },
        },
        required: ["itemName", "targetAnchor"],
      },
    },
  };
}

export function parseFit(args: Record<string, unknown>): FitAction {
  const itemName = typeof args.itemName === "string" ? args.itemName.trim() : "";
  const targetAnchor = typeof args.targetAnchor === "string" ? args.targetAnchor.trim() : "";
  if (itemName.length === 0) {
    throw new GameError("invalid_action", "fit 需要非空 itemName");
  }
  if (targetAnchor.length === 0) {
    throw new GameError("invalid_action", "fit 需要非空 targetAnchor");
  }
  return { kind: "fit", itemName, targetAnchor };
}

export async function resolveFit(
  executor: Executor,
  stage: ResolvedFit["stage"],
  actorRow: ActorWithStageRow,
  action: FitAction,
): Promise<ResolvedFit> {
  const anchor = stage.anchors.find((candidate) => candidate.label === action.targetAnchor);
  if (!anchor) {
    throw new GameError("invalid_action", `当前舞台没有这个可交互锚点: ${action.targetAnchor}`);
  }
  const transferItem = await resolveActorItem(executor, actorRow.actor.id, action.itemName);
  // 配不配得上由内容判断；引擎只要求这件道具声明了对应锚点的词缀。
  if (!hasAffixes(transferItem, "fit")) {
    throw new GameError("invalid_action", `这件道具没有可以拿去对上的词缀: ${transferItem.name}`);
  }
  return { kind: "fit", action, stage, transferItem, anchorLabel: anchor.label };
}

/** 对上的基础事件：引擎行为，不依赖词缀。 */
async function recordFitEvent(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedFit,
  trace?: TraceContext,
): Promise<string> {
  const { stage, transferItem, anchorLabel } = resolved;
  const actor = { id: actorRow.actor.id, name: actorRow.actor.name };
  const content = `${actor.name}把${transferItem.name}对上${anchorLabel}。`;

  await appendPublicMessage(executor, gameId, actor.id, {
    kind: "fit",
    stageId: stage.id,
    visibility: "stage",
    content,
  });
  await appendItemObservations(
    executor,
    gameId,
    stage,
    { actor, itemName: transferItem.name, event: "fit", targetAnchor: anchorLabel },
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    stage.id,
    `# 舞台事件\n${content}`,
    { eventKind: "fit" },
    trace,
  );
  return `你在${stage.name}的${anchorLabel}把${transferItem.name}对上了。`;
}

export async function applyFit(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedFit,
  now: Date,
  address: AddressLookup,
  trace?: TraceContext,
): Promise<StaticItemActionResult> {
  const baseFeedback = await recordFitEvent(executor, gameId, actorRow, resolved, trace);
  const staticResult = await applyStaticItemAction({
    executor,
    gameId,
    actorRow,
    stage: resolved.stage,
    item: resolved.transferItem,
    trigger: "fit",
    action: "fit",
    targetAnchor: resolved.anchorLabel,
    now,
    address,
    ...(trace ? { trace } : {}),
  });
  return {
    ...staticResult,
    feedback: [baseFeedback, staticResult.feedback].filter((line) => line.length > 0).join("\n"),
  };
}
