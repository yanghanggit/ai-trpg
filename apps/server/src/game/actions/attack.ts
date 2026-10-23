import type { ToolDefinition } from "../../llm/types";
import { assertAlive, assertNotSelf, findActorInStage, resolveActorItem } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedAttack } from "../apply/types";
import { GameError } from "../errors";
import { applyItemEffect, UNARMED_EFFECT } from "../item-effects";
import type { AttackAction } from "../types";

/** 构造 attack 工具：攻击同场景一个角色，可引用一件带 attack effect 的物品。 */
export function buildAttackTool(
  targetActorNames: readonly string[],
  availableItemNames: readonly string[],
): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "attack",
      description:
        "把一次攻击加入计划：对同场景的一个角色造成伤害；可以引用一件支持 attack 效果的自身物品，也可以空手。物品只声明效果，攻击本身只负责分派。先用 look_stage 确认目标是否在同场景。",
      parameters: {
        type: "object",
        properties: {
          targetActorName: {
            type: "string",
            description: "要攻击的同场景角色",
            ...(targetActorNames.length > 0 ? { enum: [...targetActorNames] } : {}),
          },
          itemName: {
            type: "string",
            ...(availableItemNames.length > 0 ? { enum: [...availableItemNames] } : {}),
            description: "本次攻击引用的一件自身物品；省略表示空手",
          },
        },
        required: ["targetActorName"],
      },
    },
  };
}

/** 把 attack 工具参数转成动作；只检查形状。 */
export function parseAttack(args: Record<string, unknown>): AttackAction {
  const targetActorName =
    typeof args.targetActorName === "string" ? args.targetActorName.trim() : "";
  if (targetActorName.length === 0) {
    throw new GameError("invalid_action", "attack 需要非空 targetActorName");
  }
  const itemName = typeof args.itemName === "string" ? args.itemName.trim() : "";
  return {
    kind: "attack",
    targetActorName,
    ...(itemName.length > 0 ? { itemName } : {}),
  };
}

/** 校验 attack：目标存活且不是自己；引用物品时必须是 damage effect。 */
export async function resolveAttack(
  executor: Executor,
  stage: ResolvedAttack["stage"],
  actorId: string,
  action: AttackAction,
): Promise<ResolvedAttack> {
  const target = await findActorInStage(executor, stage.id, action.targetActorName);
  assertNotSelf(target, actorId);
  assertAlive(target);
  const item =
    action.itemName !== undefined
      ? await resolveActorItem(executor, actorId, action.itemName)
      : undefined;
  if (item && item.effect.type !== "damage") {
    throw new GameError("invalid_action", `attack 需要 damage effect: ${item.name}`);
  }
  return { kind: "attack", action, stage, target, ...(item ? { item } : {}) };
}

/** 应用 attack：只选择物品并分派 effect；伤害公式在 damage effect 中。 */
export async function applyAttack(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedAttack,
  now: Date,
): Promise<string> {
  return applyItemEffect({
    executor,
    gameId,
    actorRow,
    stage: resolved.stage,
    actionKind: "attack",
    effect: resolved.item?.effect ?? UNARMED_EFFECT,
    ...(resolved.item ? { item: resolved.item } : {}),
    target: resolved.target,
    now,
  });
}
