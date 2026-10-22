import { and, eq } from "drizzle-orm";
import { actors, items, stageConnections, stageItems, stages } from "../../db/schema";
import { GameError } from "../errors";
import type { CommunicationIntent, MovementIntent } from "../types";
import type { ActorRow, Executor, ItemRow, StageItemRow, StageRow, WorldRow } from "./types";

export async function resolveCommunicationTarget(
  executor: Executor,
  stageId: string,
  actorId: string,
  intent: CommunicationIntent,
): Promise<ActorRow | undefined> {
  if (intent.message.trim().length === 0) {
    throw new GameError("invalid_action", `${intent.mode} 需要非空 message`);
  }
  if (intent.mode === "announce") {
    return undefined;
  }
  if (!intent.targetActorName) {
    throw new GameError("invalid_action", `${intent.mode} 需要 targetActorName`);
  }
  const targets = await executor
    .select()
    .from(actors)
    .where(and(eq(actors.stageId, stageId), eq(actors.name, intent.targetActorName)))
    .limit(2);
  if (targets.length !== 1) {
    throw new GameError(
      "invalid_action",
      `当前场景内找不到唯一的目标角色: ${intent.targetActorName}`,
    );
  }
  const target = targets[0];
  if (target?.id === actorId) {
    throw new GameError("invalid_action", `不能把 ${intent.mode} 的目标指定为自己`);
  }
  return target;
}

export async function resolveMovementTarget(
  executor: Executor,
  world: WorldRow,
  stage: StageRow,
  intent: MovementIntent,
): Promise<StageRow | undefined> {
  if (intent.mode === "wait") {
    return undefined;
  }
  const [target] = await executor
    .select()
    .from(stages)
    .where(and(eq(stages.worldId, world.id), eq(stages.name, intent.targetStageName ?? "")))
    .limit(1);
  if (!target) {
    throw new GameError("invalid_action", `目标 stage 不存在: ${intent.targetStageName ?? ""}`);
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

export async function resolveDamageTarget(
  executor: Executor,
  stageId: string,
  actorId: string,
  targetActorName: string,
): Promise<ActorRow> {
  const targets = await executor
    .select()
    .from(actors)
    .where(and(eq(actors.stageId, stageId), eq(actors.name, targetActorName)))
    .limit(2);
  const [target] = targets;
  if (targets.length !== 1 || !target) {
    throw new GameError("invalid_action", `当前场景内找不到唯一的技能目标: ${targetActorName}`);
  }
  if (target.id === actorId) {
    throw new GameError("invalid_action", "技能目标不能是自己");
  }
  if (target.death || target.hp <= 0) {
    throw new GameError("invalid_action", `技能目标已经死亡: ${target.name}`);
  }
  return target;
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

export async function resolveActorTarget(
  executor: Executor,
  stageId: string,
  actorId: string,
  targetActorName: string,
  options: { allowSelf: boolean; allowDead: boolean },
): Promise<ActorRow> {
  const matches = await executor
    .select()
    .from(actors)
    .where(and(eq(actors.stageId, stageId), eq(actors.name, targetActorName)))
    .limit(2);
  const [target] = matches;
  if (matches.length !== 1 || !target) {
    throw new GameError("invalid_action", `当前场景内找不到唯一目标: ${targetActorName}`);
  }
  if (!options.allowSelf && target.id === actorId) {
    throw new GameError("invalid_action", "技能目标不能是自己");
  }
  if (!options.allowDead && (target.death || target.hp <= 0)) {
    throw new GameError("invalid_action", `技能目标已经死亡: ${target.name}`);
  }
  return target;
}

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
    throw new GameError("invalid_action", `目标背包已有同名物品: ${itemName}`);
  }
}
