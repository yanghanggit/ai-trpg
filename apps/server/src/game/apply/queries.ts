import { and, eq } from "drizzle-orm";
import { actors, items, stageConnections, stageItems, stages } from "../../db/schema";
import { GameError } from "../errors";
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

/** 拒绝已死亡的目标。 */
export function assertAlive(target: ActorRow): void {
  if (target.death || target.hp <= 0) {
    throw new GameError("invalid_action", `目标已经死亡: ${target.name}`);
  }
}

/** 拒绝把自己当成目标。 */
export function assertNotSelf(target: ActorRow, actorId: string): void {
  if (target.id === actorId) {
    throw new GameError("invalid_action", "目标不能是自己");
  }
}

/** 读取 actor 持有的一件物品；名字必须唯一。 */
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

/** 读取 actor 持有的多件物品；用于攻击时搭配的武器。 */
export async function resolveActorItems(
  executor: Executor,
  actorId: string,
  itemNames: readonly string[],
): Promise<ItemRow[]> {
  const resolved: ItemRow[] = [];
  for (const itemName of itemNames) {
    resolved.push(await resolveActorItem(executor, actorId, itemName));
  }
  return resolved;
}

/** 读取当前场景中的一件物品。 */
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

/** 读取与当前场景相邻的目标场景；必须存在连接。 */
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
      ),
    )
    .limit(1);
  if (!connection) {
    throw new GameError("invalid_action", `没有从 ${stage.name} 到 ${target.name} 的连接`);
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
