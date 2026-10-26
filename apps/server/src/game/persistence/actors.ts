import { and, eq } from "drizzle-orm";
import { actors, stages, worlds } from "../../db/schema";
import type { ActorRow, ActorWithStageRow, Executor } from "../apply/types";

/**
 * actor 的持久化原语（读与写）。
 *
 * 玩法层（`actions/`、`item-effects/`、`stage`/`world` 回合、死亡与外观）只调用这里的
 * 具名函数，不出现表名、列名或 SQL：规则与存储格式解耦。
 * 「必须存在、必须唯一」这类带校验的读取仍在 `apply/queries.ts`；这里是不带策略的读与写。
 * 命名约定：`load*` 是数据库读，`list*` 是数据库集合读，`set*` / `move*` / `mark*` 是写；
 * `find*` 留给 `actors.ts` 里对 `GameState` 的内存查找，避免两套东西同名。
 * 所有函数都接受 `Executor`，在事务里传 `tx` 即可。
 */

/** 读一个 actor 及其所在场景，并限定在该 world 内。 */
export async function loadActorWithStage(
  executor: Executor,
  actorId: string,
  worldId: string,
): Promise<ActorWithStageRow | undefined> {
  const [row] = await executor
    .select({ actor: actors, stage: stages })
    .from(actors)
    .innerJoin(stages, eq(actors.stageId, stages.id))
    .where(and(eq(actors.id, actorId), eq(stages.worldId, worldId)))
    .limit(1);
  return row;
}

/**
 * 按名字读同场景角色；找不到或名字不唯一时返回 undefined。
 *
 * 与 `apply/queries.ts` 的 `findActorInStage` 区别在这里不抛错：词缀落账是尽力而为，
 * 目标在计划提交与落账之间离开场景时应当跳过，而不是让整次结算失败。
 */
export async function loadActorByNameInStage(
  executor: Executor,
  stageId: string,
  name: string,
): Promise<ActorRow | undefined> {
  const matches = await executor
    .select()
    .from(actors)
    .where(and(eq(actors.stageId, stageId), eq(actors.name, name)))
    .limit(2);
  return matches.length === 1 ? matches[0] : undefined;
}

/** 读一个场景里的全部 actor（含尸体）。 */
export async function listStageActors(executor: Executor, stageId: string): Promise<ActorRow[]> {
  return executor.select().from(actors).where(eq(actors.stageId, stageId));
}

/** 本局全部 actor 的生命与收尾标记：批量外观维护据此决定谁要重推。 */
export async function listActorsForAppearance(
  executor: Executor,
  gameId: string,
): Promise<{ id: string; name: string; hp: number; deathSettledAt: Date | null }[]> {
  return executor
    .select({
      id: actors.id,
      name: actors.name,
      hp: actors.hp,
      deathSettledAt: actors.deathSettledAt,
    })
    .from(actors)
    .innerJoin(stages, eq(actors.stageId, stages.id))
    .innerJoin(worlds, eq(stages.worldId, worlds.id))
    .where(eq(worlds.gameId, gameId))
    .orderBy(actors.name);
}

/** 覆盖穿戴索引（槽位 → 物品名）。 */
export async function setActorEquipment(
  executor: Executor,
  actorId: string,
  equipment: ActorRow["equipment"],
  now: Date,
): Promise<void> {
  await executor.update(actors).set({ equipment, updatedAt: now }).where(eq(actors.id, actorId));
}

/** 改变 actor 所在场景。 */
export async function moveActorToStage(
  executor: Executor,
  actorId: string,
  stageId: string,
  now: Date,
): Promise<void> {
  await executor.update(actors).set({ stageId, updatedAt: now }).where(eq(actors.id, actorId));
}

/** 写外观快照。 */
export async function setActorAppearance(
  executor: Executor,
  actorId: string,
  appearance: string,
  now: Date,
): Promise<void> {
  await executor.update(actors).set({ appearance, updatedAt: now }).where(eq(actors.id, actorId));
}

export type DamageOutcome =
  | { status: "applied"; row: ActorRow; remainingHp: number }
  | { status: "already-dead"; row: ActorRow }
  | { status: "missing" };

/**
 * 扣血：读-改-写必须在同一次带行锁的访问里完成。
 *
 * 调用方手里可能握着旧快照（默认效果与 affix 会连续结算同一个目标），所以这里不接收
 * 快照、只接收 actorId，`for update` 读当前 HP 再写，避免用旧值覆盖。
 * 返回写后的行与剩余 HP，调用方据此写消息，不需要再查一次。
 */
export async function damageActor(
  executor: Executor,
  actorId: string,
  amount: number,
  now: Date,
): Promise<DamageOutcome> {
  const [row] = await executor
    .select()
    .from(actors)
    .where(eq(actors.id, actorId))
    .limit(1)
    .for("update");
  if (!row) {
    return { status: "missing" };
  }
  if (row.hp <= 0) {
    return { status: "already-dead", row };
  }
  const remainingHp = Math.max(0, row.hp - amount);
  await executor
    .update(actors)
    .set({ hp: remainingHp, updatedAt: now })
    .where(eq(actors.id, actorId));
  return { status: "applied", row, remainingHp };
}
