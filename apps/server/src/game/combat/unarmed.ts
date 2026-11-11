import type { AddressLookup } from "../kernel/addressing";
import type { ActorRow, ActorWithStageRow, Executor, StageRow } from "../persistence/rows";
import { mitigatedDamage, unarmedDamage } from "./attack";
import { applyHit } from "./hit";

/**
 * 肉搏：不读任何物品，攻击力只取行动者自身的 `damage`，减伤只减目标的格挡。
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
  const damage = await mitigatedDamage(executor, unarmedDamage(actorRow.actor.stats), target);
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
