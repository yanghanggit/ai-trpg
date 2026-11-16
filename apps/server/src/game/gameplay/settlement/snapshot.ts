import type { Stats } from "../../kernel/attributes";
import { wearerView } from "../../lookup";
import type { ActorRow, Executor } from "../../persistence/rows";
import { attackPower, guardPower, unarmedAttackPower } from "../combat";
import { effectiveSourcesOf, equipmentFinalsOf } from "../effective";
import type { ActorSnapshot, ItemSnapshot, SettlementRole } from "./types";

/**
 * 全仓唯一同时读 `wearerView` 与 `actor.hp` 的地方。
 *
 * 生成规则只有一处差异：`mode` 决定攻击力吃不吃装备终值。`armed` 用
 * `attackPower`，`unarmed` 用 `unarmedAttackPower`——形态相同，下游不 care。
 */

export type SnapshotMode = "armed" | "unarmed";

export type BuildActorSnapshotInput = {
  executor: Executor;
  actor: ActorRow;
  role: SettlementRole;
  mode: SnapshotMode;
  /** 动作发生前的隐匿状态；必须在现身之前取值。 */
  concealed: boolean;
  /** 本次拿来动手的道具；`armed` 且未在槽里时才补它的终值。 */
  instrument?: ItemSnapshot;
};

export async function buildActorSnapshot(input: BuildActorSnapshotInput): Promise<ActorSnapshot> {
  const wearer = await wearerView(input.executor, input.actor);
  const sources = effectiveSourcesOf(wearer);
  const instrument =
    input.mode === "armed" && input.instrument
      ? { name: input.instrument.name, stats: input.instrument.stats }
      : undefined;
  const finals = equipmentFinalsOf(wearer, instrument);

  const stats: Stats = {
    ...sources,
    // 装备的 maxHp 加成没有读取点：上限恒取角色行原值。
    maxHp: input.actor.stats.maxHp,
    damage: input.mode === "unarmed" ? unarmedAttackPower(sources) : attackPower(sources, finals),
    block: guardPower(finals),
  };

  return {
    role: input.role,
    actorId: input.actor.id,
    name: input.actor.name,
    stats,
    hp: input.actor.hp,
    concealed: input.concealed,
    deathFinalized: input.actor.deathSettledAt !== null,
  };
}
