import type { AddressLookup } from "../addressing";
import type { ActorRow, ActorWithStageRow, Executor, StageRow } from "../apply/types";
import { mitigatedAttackDamage } from "./attack";
import { applyHit } from "./hit";

/**
 * 肉搏：不读任何物品，伤害只来自行动者自身 `damage`，减伤只减目标的 `block`。
 *
 * 这是引擎原生的攻击路径：不借用物品、词缀或 `actions` 的任何概念。
 */
export async function applyUnarmedHit(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  stage: StageRow,
  target: ActorRow,
  now: Date,
  address?: AddressLookup,
  trace?: Parameters<typeof applyHit>[0]["trace"],
): Promise<string> {
  const damage = await mitigatedAttackDamage(executor, actorRow.actor.stats, undefined, target);
  const outcome = await applyHit({
    executor,
    gameId,
    actorRow,
    stage,
    target,
    damage,
    action: "brawl",
    now,
    ...(address ? { address } : {}),
    ...(trace ? { trace } : {}),
  });
  return outcome.feedback;
}
