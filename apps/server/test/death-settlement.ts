import type { Database } from "../src/db/pool";
import { type DeathSettlementOptions, scanDeathsToSettle, settleDeath } from "../src/game";
import type { DeathSettlement } from "../src/game/kernel/types";

/**
 * 用例侧的收尾推进：按调用方（行动落账、CLI）的方式取名单再逐个推进。
 *
 * 生产代码里没有「批量收尾」函数——名单是 `scanDeathsToSettle`，推进是 `settleDeath`，
 * 循环留在边界。这里只把同一步骤给用例复用，不参与生产逻辑。
 */
export async function settleAllDeaths(
  db: Database,
  gameId: string,
  options: DeathSettlementOptions = {},
): Promise<DeathSettlement[]> {
  const settlements: DeathSettlement[] = [];
  for (const actor of await scanDeathsToSettle(db, gameId)) {
    settlements.push(await settleDeath(db, gameId, actor, options));
  }
  return settlements;
}

/** 认领并宣布成功的死者名。 */
export function declaredNames(settlements: readonly DeathSettlement[]): string[] {
  return settlements.filter((settlement) => settlement.declared).map(({ actorName }) => actorName);
}

/** 各段没做成的死者与原因，供用例断言「这一具在哪一段失败」。 */
export function failureReasons(
  settlements: readonly DeathSettlement[],
  phase: "announce" | "appearance" | "drop",
): { actorName: string; reason: string }[] {
  const field =
    phase === "announce" ? "failure" : phase === "appearance" ? "appearanceFailure" : "dropFailure";
  return settlements.flatMap((settlement) => {
    const reason = settlement[field];
    return reason === undefined ? [] : [{ actorName: settlement.actorName, reason }];
  });
}
