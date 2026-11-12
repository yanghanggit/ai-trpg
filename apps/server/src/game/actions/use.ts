import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import { applyStaticItemAction, type StaticItemActionResult } from "../agents/affixes";
import { GameError } from "../errors";
import { type AddressLookup, actionRef } from "../kernel/addressing";
import { hasAffixes, staticAffixes } from "../kernel/affixes";
import type { AffixTriggers, UseAction } from "../kernel/types";
import { resolveActorItem } from "../lookup";
import { appendItemObservations, appendStageMemory } from "../observations";
import { appendPublicMessage } from "../persistence/game-messages";
import type { ActorWithStageRow, Executor } from "../persistence/rows";
import type { ResolvedUse } from "../settle/types";

export function buildUseTool(
  availableItemNames: readonly string[],
  targetActorHandles: readonly string[],
  currentStageName: string,
  stageAnchors: readonly string[] = [],
): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "use",
      description:
        "把一次使用道具加入计划：使用一件自己带在身上的道具，作用于一个角色或当前舞台（二选一）。",
      parameters: {
        type: "object",
        properties: {
          itemName: {
            type: "string",
            description: "要使用的自己持有的道具名",
            // 工具只在有可用道具时装配（`use` 由道具授予），所以枚举永远非空。
            enum: [...availableItemNames],
          },
          targetActorHandle: {
            type: "string",
            description: "道具作用的对象角色的引用（名字 或 #编号）；可以是自己，也可以是尸体",
            ...(targetActorHandles.length > 0 ? { enum: [...targetActorHandles] } : {}),
          },
          targetStageName: {
            type: "string",
            description: "道具作用的舞台",
            enum: [currentStageName],
          },
          ...(stageAnchors.length > 0
            ? {
                targetAnchor: {
                  type: "string",
                  description: "当前舞台的可交互锚点（仅配合 targetStageName）",
                  enum: [...stageAnchors],
                },
              }
            : {}),
        },
        required: ["itemName"],
      },
    },
  };
}

export function parseUse(args: Record<string, unknown>): UseAction {
  const itemName = typeof args.itemName === "string" ? args.itemName.trim() : "";
  const targetActorHandle =
    typeof args.targetActorHandle === "string" ? args.targetActorHandle.trim() : "";
  const targetStageName =
    typeof args.targetStageName === "string" ? args.targetStageName.trim() : "";
  const targetAnchor = typeof args.targetAnchor === "string" ? args.targetAnchor.trim() : "";
  if (itemName.length === 0) {
    throw new GameError("invalid_action", "use 需要非空 itemName");
  }
  if ((targetActorHandle.length === 0) === (targetStageName.length === 0)) {
    throw new GameError("invalid_action", "use 需要 targetActorHandle 或 targetStageName 二选一");
  }
  if (targetAnchor.length > 0 && targetStageName.length === 0) {
    throw new GameError("invalid_action", "targetAnchor 只能与 targetStageName 一起使用");
  }
  return {
    kind: "use",
    itemName,
    ...(targetActorHandle.length > 0 ? { targetActorHandle } : {}),
    ...(targetStageName.length > 0 ? { targetStageName } : {}),
    ...(targetAnchor.length > 0 ? { targetAnchor } : {}),
  };
}

/** 静态词缀里是否有 damage op；`use` 指向舞台时不成立。 */
function hasDamageOp(item: { affixes: AffixTriggers }): boolean {
  return staticAffixes(item, "use").some((affix) =>
    (affix.ops ?? []).some((op) => op.kind === "damage"),
  );
}

export async function resolveUse(
  executor: Executor,
  stage: ResolvedUse["stage"],
  actorRow: ActorWithStageRow,
  action: UseAction,
  targetActor?: ResolvedUse["target"],
): Promise<ResolvedUse> {
  const transferItem = await resolveActorItem(executor, actorRow.actor.id, action.itemName);
  // 在不在槽里不影响：只认那件道具自己的词缀。
  if (!hasAffixes(transferItem, "use")) {
    throw new GameError("invalid_action", `道具没有可用的使用词缀: ${transferItem.name}`);
  }
  const targetAnchor = action.targetAnchor?.trim();
  if (targetAnchor && action.targetStageName === undefined) {
    throw new GameError("invalid_action", "targetAnchor 只能与 targetStageName 一起使用");
  }

  let target: ResolvedUse["target"];
  let targetStage: ResolvedUse["targetStage"];

  if (action.targetStageName !== undefined) {
    if (action.targetStageName !== stage.name) {
      throw new GameError("invalid_action", "只能对当前所在舞台使用道具");
    }
    if (
      targetAnchor !== undefined &&
      !stage.anchors.some((anchor) => anchor.label === targetAnchor)
    ) {
      throw new GameError("invalid_action", "当前舞台没有这个可交互锚点");
    }
    if (hasDamageOp(transferItem)) {
      throw new GameError("invalid_action", "伤害词缀需要角色目标，不能作用于舞台或锚点");
    }
    targetStage = stage;
  } else {
    if (!targetActor) {
      throw new GameError("invalid_action", "use 缺少目标");
    }
    // 目标不要求存活：对尸体使用道具同样合法（例如未来的复活类玩法）。
    target = targetActor;
  }

  return {
    kind: "use",
    action,
    stage,
    transferItem,
    ...(target ? { target } : {}),
    ...(targetStage ? { targetStage } : {}),
    ...(targetAnchor ? { targetAnchor } : {}),
  };
}

/**
 * `use` 的基础事件：引擎行为，不依赖词缀。
 *
 * 没有词缀的道具也可能被“使用”（例如把钟舌放回祭坛），这条记录保证动作在世界里
 * 留下痕迹；可见后果由 witness 额外追加。
 */
async function recordUseEvent(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedUse,
  address: AddressLookup,
  trace?: TraceContext,
): Promise<string> {
  const { stage, transferItem, target, targetStage } = resolved;
  const targetAnchor = targetStage ? resolved.targetAnchor : undefined;
  const actor = { id: actorRow.actor.id, name: actorRow.actor.name };
  const targetRef = target ? actionRef(address(target.id)) : undefined;
  const targetLabel = targetStage ? targetStage.name : (targetRef ?? target?.name ?? "目标");
  const stageAnchorText = targetAnchor ? `的${targetAnchor}` : "";
  const content = targetStage
    ? `${actor.name}在${targetStage.name}${stageAnchorText}使用了${transferItem.name}。`
    : `${actor.name}对${targetLabel}使用了${transferItem.name}。`;

  await appendPublicMessage(executor, gameId, actor.id, {
    kind: "use",
    stageId: stage.id,
    ...(target ? { targetActorId: target.id } : {}),
    visibility: "stage",
    content,
  });
  await appendItemObservations(
    executor,
    gameId,
    stage,
    {
      actor,
      itemName: transferItem.name,
      event: "use",
      ...(target ? { target: { id: target.id } } : {}),
      ...(targetStage ? { targetStageName: targetStage.name } : {}),
      ...(targetAnchor ? { targetAnchor } : {}),
    },
    trace,
  );
  await appendStageMemory(
    executor,
    gameId,
    stage.id,
    `# 舞台事件\n${content}`,
    {
      eventKind: "use",
      ...(target ? { targetActorId: target.id } : {}),
      ...(targetStage ? { targetStageId: targetStage.id } : {}),
    },
    trace,
  );

  return targetStage
    ? `你在${targetLabel}${stageAnchorText}使用了${transferItem.name}。`
    : `你对${targetLabel}使用了${transferItem.name}。`;
}

export async function applyUse(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedUse,
  now: Date,
  address: AddressLookup,
  trace?: TraceContext,
): Promise<StaticItemActionResult> {
  const targetAnchor = resolved.targetStage ? resolved.targetAnchor : undefined;
  const baseFeedback = await recordUseEvent(executor, gameId, actorRow, resolved, address, trace);
  const staticResult = await applyStaticItemAction({
    executor,
    gameId,
    actorRow,
    stage: resolved.stage,
    item: resolved.transferItem,
    trigger: "use",
    action: "use",
    ...(resolved.target ? { target: resolved.target } : {}),
    ...(targetAnchor ? { targetAnchor } : {}),
    now,
    address,
    ...(trace ? { trace } : {}),
  });
  return {
    ...staticResult,
    feedback: [baseFeedback, staticResult.feedback].filter((line) => line.length > 0).join("\n"),
  };
}
