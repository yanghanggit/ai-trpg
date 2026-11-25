import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { actionOrderEntries, actionOrders, actorControls, actors } from "../../db/schema";
import type { ActionOrderControl, ActionOrderStatus } from "../kernel/types";
import type { Executor } from "./rows";

/**
 * 行动顺位行的读写。
 *
 * 一局最多一条 `active`（部分唯一索引兜住），所以当前顺位是单行读取；计数用
 * `turns_taken + 1` 原子自增，排队读再写会丢并发的一次推进。排序规则不在这里。
 */

export type ActionOrderRow = typeof actionOrders.$inferSelect;
export type ActionOrderEntryRow = typeof actionOrderEntries.$inferSelect;
export type ActionOrderEntryDraft = {
  actorId: string;
  position: number;
  agility: number;
};

/** 当前进行中的顺位；没有就返回 undefined，不抛错——「还没开顺位」是正常状态。 */
export async function findActiveActionOrder(
  executor: Executor,
  gameId: string,
): Promise<ActionOrderRow | undefined> {
  const rows = await executor
    .select()
    .from(actionOrders)
    .where(and(eq(actionOrders.gameId, gameId), eq(actionOrders.status, "active")))
    .limit(1);
  return rows[0];
}

/** 按 id 读一行，并确认它属于这一局。 */
export async function findActionOrder(
  executor: Executor,
  gameId: string,
  orderId: string,
): Promise<ActionOrderRow | undefined> {
  const rows = await executor
    .select()
    .from(actionOrders)
    .where(and(eq(actionOrders.id, orderId), eq(actionOrders.gameId, gameId)))
    .limit(1);
  return rows[0];
}

/** 开顺位：头与条目要在同一个事务里落；空名单由调用方先拦掉（至少一个名次）。 */
export async function insertActionOrder(
  executor: Executor,
  input: { gameId: string; entries: readonly ActionOrderEntryDraft[] },
  now: Date = new Date(),
): Promise<string> {
  const orderId = randomUUID();
  await executor.insert(actionOrders).values({
    id: orderId,
    gameId: input.gameId,
    status: "active",
    createdAt: now,
  });
  await executor.insert(actionOrderEntries).values(
    input.entries.map((entry) => ({
      id: randomUUID(),
      orderId,
      actorId: entry.actorId,
      position: entry.position,
      agility: entry.agility,
    })),
  );
  return orderId;
}

/** 条目按顺位读出；`actorName` 只是投影，身份仍用 `actorId`。 */
export async function listActionOrderEntries(
  executor: Executor,
  orderId: string,
): Promise<
  { actorId: string; actorName: string; position: number; agility: number; turnsTaken: number }[]
> {
  return executor
    .select({
      actorId: actionOrderEntries.actorId,
      actorName: actors.name,
      position: actionOrderEntries.position,
      agility: actionOrderEntries.agility,
      turnsTaken: actionOrderEntries.turnsTaken,
    })
    .from(actionOrderEntries)
    .innerJoin(actors, eq(actors.id, actionOrderEntries.actorId))
    .where(eq(actionOrderEntries.orderId, orderId))
    .orderBy(asc(actionOrderEntries.position));
}

/** 名次之外的两个当下事实：还能不能轮到他，这一回合由谁执行。 */
export type OrderParticipant = { alive: boolean; control: ActionOrderControl };

/**
 * 顺位上每个人此刻的生死与执行方，一次往返取齐。
 *
 * 接管了就是 `player`，否则 `agent`——主角在被接管前也算 `agent`，因为玩家入口要求先
 * 接管。两者都是读出时的事实，不落库：快照记名次与敏捷，生死与接管会变。
 */
export async function listOrderParticipants(
  executor: Executor,
  orderId: string,
): Promise<Map<string, OrderParticipant>> {
  const rows = await executor
    .select({
      actorId: actionOrderEntries.actorId,
      hp: actors.hp,
      controlledBy: actorControls.actorId,
    })
    .from(actionOrderEntries)
    .innerJoin(actors, eq(actors.id, actionOrderEntries.actorId))
    .leftJoin(
      actorControls,
      and(
        eq(actorControls.actorId, actionOrderEntries.actorId),
        eq(actorControls.controllerType, "player"),
      ),
    )
    .where(eq(actionOrderEntries.orderId, orderId));
  return new Map(
    rows.map((row) => [
      row.actorId,
      { alive: row.hp > 0, control: row.controlledBy === null ? "agent" : "player" },
    ]),
  );
}

/**
 * 记一次推进：原子自增，返回这条顺位是否被加过。
 *
 * 名单是快照，所以「这个人不在顺位上」（开顺位后才加入世界）与「没有进行中的顺位」都只是
 * 没记上，不是错误——调用方不必为它中断回合。
 */
export async function incrementActionOrderEntry(
  executor: Executor,
  orderId: string,
  actorId: string,
): Promise<boolean> {
  const updated = await executor
    .update(actionOrderEntries)
    .set({ turnsTaken: sql`${actionOrderEntries.turnsTaken} + 1` })
    .where(and(eq(actionOrderEntries.orderId, orderId), eq(actionOrderEntries.actorId, actorId)))
    .returning({ id: actionOrderEntries.id });
  return updated.length > 0;
}

/** 完成是打标记；只在 `active` 上生效，返回是否真的从进行中转成了完成。 */
export async function markActionOrderCompleted(
  executor: Executor,
  orderId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const updated = await executor
    .update(actionOrders)
    .set({ status: "completed" satisfies ActionOrderStatus, completedAt: now })
    .where(and(eq(actionOrders.id, orderId), eq(actionOrders.status, "active")))
    .returning({ id: actionOrders.id });
  return updated.length > 0;
}

/** 移除是删行；条目靠外键级联，不留归档。 */
export async function deleteActionOrderRow(executor: Executor, orderId: string): Promise<boolean> {
  const deleted = await executor
    .delete(actionOrders)
    .where(eq(actionOrders.id, orderId))
    .returning({ id: actionOrders.id });
  return deleted.length > 0;
}
