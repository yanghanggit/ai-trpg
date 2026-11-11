import {
  effectiveSourcesOf,
  equipmentFinalsOf,
  guardPower,
  mitigatedDamage,
  unarmedAttackPower,
} from "../gameplay";
import type { AddressLookup } from "../kernel/addressing";
import { wearerView } from "../lookup";
import type { ActorRow, ActorWithStageRow, Executor, StageRow } from "../persistence/rows";
import { applyHit } from "./hit";

/**
 * 肉搏：不读任何物品，攻击力只取源属性算出的 `damage`，减伤只减目标的装备格挡。
 *
 * 这是引擎原生的攻击路径：不借用物品、词缀或 `actions` 的任何概念。
 * 数值全部来自玩法层，这里只负责把结果交给落账。
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
  const [attacker, defender] = await Promise.all([
    wearerView(executor, actorRow.actor),
    wearerView(executor, target),
  ]);
  const damage = mitigatedDamage(
    unarmedAttackPower(effectiveSourcesOf(attacker)),
    guardPower(equipmentFinalsOf(defender)),
  );
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
