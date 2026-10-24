import type { ToolDefinition } from "../../llm/types";
import {
  assertAlive,
  assertNotSelf,
  findActorInStage,
  resolveEquippedItems,
} from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedAttack } from "../apply/types";
import { GameError } from "../errors";
import { applyItemEffect, UNARMED_EFFECT } from "../item-effects";
import type { AttackAction } from "../types";

/** 构造 attack 工具：攻击同场景一个角色；武器由装备决定，不作为参数。 */
export function buildAttackTool(targetActorNames: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "attack",
      description:
        "把一次攻击加入计划：对同场景的一个角色造成伤害。攻击固定使用你当前装备的武器（weapon 槽）；武器没有伤害效果或没有装备武器时按空手结算。武器由装备决定，不能临时指定其他物品；要使用背包里的其他物品请用 use。先用 look_stage 确认目标是否在同场景。",
      parameters: {
        type: "object",
        properties: {
          targetActorName: {
            type: "string",
            description: "要攻击的同场景角色",
            ...(targetActorNames.length > 0 ? { enum: [...targetActorNames] } : {}),
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
  return { kind: "attack", targetActorName };
}

/** 校验 attack：目标存活且不是自己。 */
export async function resolveAttack(
  executor: Executor,
  stage: ResolvedAttack["stage"],
  actorRow: ActorWithStageRow,
  action: AttackAction,
): Promise<ResolvedAttack> {
  const target = await findActorInStage(executor, stage.id, action.targetActorName);
  assertNotSelf(target, actorRow.actor.id);
  assertAlive(target);
  // 武器只来自装备：weapon 槽里的物品，且必须声明 damage 效果。其余情况按空手。
  const weaponName = actorRow.actor.equipment.weapon;
  const item =
    weaponName === undefined
      ? undefined
      : (await resolveEquippedItems(executor, actorRow.actor)).find(
          (row) => row.name === weaponName && row.effect.type === "damage",
        );
  return { kind: "attack", action, stage, target, ...(item ? { item } : {}) };
}

/** 应用 attack：只选择武器并分派 effect；伤害公式在 damage effect 中。 */
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
