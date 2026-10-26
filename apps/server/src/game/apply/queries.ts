import { and, eq } from "drizzle-orm";
import { actors, items, stageConnections, stageItems, stages } from "../../db/schema";
import { addStats, type Stats } from "../attributes";
import { GameError } from "../errors";
import { EQUIPMENT_SLOTS } from "../types";
import type { ActorRow, Executor, ItemRow, StageItemRow, StageRow, WorldRow } from "./types";

/** 在当前场景内按名字找唯一角色；不判断存活与自我，由调用方决定。 */
export async function findActorInStage(
  executor: Executor,
  stageId: string,
  name: string,
): Promise<ActorRow> {
  const matches = await executor
    .select()
    .from(actors)
    .where(and(eq(actors.stageId, stageId), eq(actors.name, name)))
    .limit(2);
  const [target] = matches;
  if (matches.length !== 1 || !target) {
    throw new GameError("invalid_action", `当前场景内找不到唯一角色: ${name}`);
  }
  return target;
}

/**
 * 生命只用来判断「能不能自主行动」与展示，**不**用来限制目标：
 * 尸体可以被攻击、给予、使用、偷窃，这是给复活类玩法留的口子。
 */
export function isAlive(target: { hp: number }): boolean {
  return target.hp > 0;
}

export function assertNotSelf(target: ActorRow, actorId: string): void {
  if (target.id === actorId) {
    throw new GameError("invalid_action", "目标不能是自己");
  }
}

/** 按槽位索引解析出穿戴中的物品行；指向不存在物品的悬空索引直接跳过。 */
export async function resolveEquippedItems(
  executor: Executor,
  actor: ActorRow,
): Promise<ItemRow[]> {
  const rows = await executor.select().from(items).where(eq(items.actorId, actor.id));
  const byName = new Map(rows.map((row) => [row.name, row]));
  return EQUIPMENT_SLOTS.flatMap((slot) => {
    const name = actor.equipment[slot];
    const item = name === undefined ? undefined : byName.get(name);
    return item ? [item] : [];
  });
}

/** 装备加成只有这一条来源。 */
export async function resolveEquippedStats(executor: Executor, actor: ActorRow): Promise<Stats> {
  const worn = await resolveEquippedItems(executor, actor);
  return addStats(...worn.map((item) => item.stats));
}

export async function resolveActorItem(
  executor: Executor,
  actorId: string,
  itemName: string,
): Promise<ItemRow> {
  const matches = await executor
    .select()
    .from(items)
    .where(and(eq(items.actorId, actorId), eq(items.name, itemName)))
    .limit(2);
  const [item] = matches;
  if (matches.length !== 1 || !item) {
    throw new GameError("invalid_action", `actor 没有唯一物品: ${itemName}`);
  }
  return item;
}

export async function resolveStageItem(
  executor: Executor,
  stageId: string,
  itemName: string,
): Promise<StageItemRow> {
  const matches = await executor
    .select()
    .from(stageItems)
    .where(and(eq(stageItems.stageId, stageId), eq(stageItems.name, itemName)))
    .limit(2);
  const [item] = matches;
  if (matches.length !== 1 || !item) {
    throw new GameError("invalid_action", `场景内没有唯一物品: ${itemName}`);
  }
  return item;
}

/** 读取与当前场景相邻的目标场景；必须存在**已通行**的连接。 */
export async function resolveAdjacentStage(
  executor: Executor,
  world: WorldRow,
  stage: StageRow,
  targetStageName: string,
): Promise<StageRow> {
  const [target] = await executor
    .select()
    .from(stages)
    .where(and(eq(stages.worldId, world.id), eq(stages.name, targetStageName)))
    .limit(1);
  if (!target) {
    throw new GameError("invalid_action", `目标场景不存在: ${targetStageName}`);
  }
  const [connection] = await executor
    .select()
    .from(stageConnections)
    .where(
      and(
        eq(stageConnections.worldId, world.id),
        eq(stageConnections.fromStageId, stage.id),
        eq(stageConnections.toStageId, target.id),
        eq(stageConnections.passage, "open"),
      ),
    )
    .limit(1);
  if (!connection) {
    throw new GameError("invalid_action", `没有从 ${stage.name} 到 ${target.name} 的通道`);
  }
  return target;
}

/** 物品转移后同一 actor 不能出现重名物品。 */
export async function assertItemNameFree(
  executor: Executor,
  actorId: string,
  itemName: string,
): Promise<void> {
  const [existing] = await executor
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.actorId, actorId), eq(items.name, itemName)))
    .limit(1);
  if (existing) {
    throw new GameError("invalid_action", `目标已持有同名物品: ${itemName}`);
  }
}
