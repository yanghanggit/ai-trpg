import type { TraceContext } from "../../debug/trace";
import type { ToolDefinition } from "../../llm/types";
import type { AddressLookup } from "../addressing";
import { assertNotSelf, findActorInStage } from "../apply/queries";
import type { ActorWithStageRow, Executor, ResolvedBrawl } from "../apply/types";
import { GameError } from "../errors";
import { applyItemEffect } from "../item-effects";
import type { BrawlAction } from "../types";

/**
 * 身体动作：不读任何物品，伤害只来自行动者自身 stats。
 *
 * 与 `strike` 分开是因为触发条件不同：挥击要求 `weapon` 槽有提供 strike 的武器，
 * 肉搏只要求角色自己的 actions 里有 `brawl`。
 */
export function buildBrawlTool(targetActorHandles: readonly string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "brawl",
      description:
        "把一次肉搏加入计划：用身体（拳脚、牙爪）攻击同场景的一个角色。不使用任何物品，武器数值不参与结算。先用 look_stage 确认目标是否在同场景。",
      parameters: {
        type: "object",
        properties: {
          targetActorHandle: {
            type: "string",
            description: "要攻击的同场景角色的指代（@数字）；尸体也可以（伤害结算会空转）",
            ...(targetActorHandles.length > 0 ? { enum: [...targetActorHandles] } : {}),
          },
        },
        required: ["targetActorHandle"],
      },
    },
  };
}

export function parseBrawl(args: Record<string, unknown>): BrawlAction {
  const targetActorHandle =
    typeof args.targetActorHandle === "string" ? args.targetActorHandle.trim() : "";
  if (targetActorHandle.length === 0) {
    throw new GameError("invalid_action", "brawl 需要非空 targetActorHandle");
  }
  return { kind: "brawl", targetActorHandle };
}

/** 目标不要求存活：尸体也能被攻击，伤害结算会在 `isAlive` 处空转。 */
export async function resolveBrawl(
  executor: Executor,
  stage: ResolvedBrawl["stage"],
  actorRow: ActorWithStageRow,
  action: BrawlAction,
): Promise<ResolvedBrawl> {
  const target = await findActorInStage(executor, stage.id, action.targetActorHandle);
  assertNotSelf(target, actorRow.actor.id);
  return { kind: "brawl", action, stage, target };
}

/** 应用 brawl：不带物品，直接交给 damage effect 结算。 */
export async function applyBrawl(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedBrawl,
  now: Date,
  address: AddressLookup,
  trace?: TraceContext,
): Promise<string> {
  return applyItemEffect({
    executor,
    gameId,
    actorRow,
    stage: resolved.stage,
    actionKind: "brawl",
    effect: { type: "damage" },
    target: resolved.target,
    address,
    now,
    ...(trace ? { trace } : {}),
  });
}
