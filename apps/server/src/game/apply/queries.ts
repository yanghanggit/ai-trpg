import { and, eq, isNull } from "drizzle-orm";
import {
  actorSignatures,
  actors,
  appearances,
  items,
  knownStages,
  stageConnections,
  stageItems,
  stages,
  stageVisits,
  worlds,
} from "../../db/schema";
import { type AddressLookup, makeAddressLookup, stripNameRef } from "../addressing";
import { addStats, type Stats } from "../attributes";
import { GameError } from "../errors";
import { signatureNamesFor } from "../persistence/signature-names";
import type { RouteWorld } from "../route";
import { EQUIPMENT_SLOTS } from "../types";
import type {
  ActorRow,
  ActorWithStageRow,
  Executor,
  ItemRow,
  StageItemRow,
  StageRow,
  WorldRow,
} from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNATURE_HANDLE_PATTERN = /^#([1-9]\d*)$/;
const STAGE_HANDLE_PATTERN = /^#([1-9]\d*)$/;

/** 场景 ref：id、名字或实体编号；编号与签名共用实体序号，按调用上下文区分。 */
function stageRefCondition(ref: string) {
  const handle = STAGE_HANDLE_PATTERN.exec(ref);
  if (handle) {
    return eq(stages.seq, Number(handle[1]));
  }
  return UUID_PATTERN.test(ref) ? eq(stages.id, ref) : eq(stages.name, ref);
}

export type SignatureRow = typeof actorSignatures.$inferSelect;
export type AppearanceRow = typeof appearances.$inferSelect;
export type ActorViewRow = { actor: ActorRow; signature: SignatureRow; appearance: AppearanceRow };

/** 连接当前外观行：每个签名至多一条 `superseded_at is null` 的记录。 */
function currentAppearance(signatureIdColumn: typeof actorSignatures.id) {
  return and(eq(appearances.signatureId, signatureIdColumn), isNull(appearances.supersededAt));
}

/** 当前签名的读取条件：同一 actor 至多一条未结束的签名。 */
function currentSignature(actorIdColumn: typeof actors.id) {
  return and(eq(actorSignatures.actorId, actorIdColumn), isNull(actorSignatures.endedAt));
}

/** 本场景全部角色及其当前签名。 */
export async function listStageActorViews(
  executor: Executor,
  stageId: string,
): Promise<ActorViewRow[]> {
  return executor
    .select({ actor: actors, signature: actorSignatures, appearance: appearances })
    .from(actors)
    .innerJoin(actorSignatures, currentSignature(actors.id))
    .innerJoin(appearances, currentAppearance(actorSignatures.id))
    .where(eq(actors.stageId, stageId))
    .orderBy(actors.seq);
}

/** 按签名编号在本 world 内定位角色；只用于名字补记，不用于 actor-facing 目标解析。 */
export async function findSignatureByHandleInWorld(
  executor: Executor,
  worldId: string,
  handle: string,
): Promise<ActorViewRow | undefined> {
  const match = SIGNATURE_HANDLE_PATTERN.exec(handle);
  if (!match) {
    return undefined;
  }
  const seq = Number(match[1]);
  const rows = await executor
    .select({ actor: actors, signature: actorSignatures, appearance: appearances })
    .from(actorSignatures)
    .innerJoin(actors, eq(actorSignatures.actorId, actors.id))
    .innerJoin(stages, eq(actors.stageId, stages.id))
    .innerJoin(worlds, eq(stages.worldId, worlds.id))
    .innerJoin(appearances, currentAppearance(actorSignatures.id))
    .where(
      and(eq(worlds.id, worldId), eq(actorSignatures.seq, seq), isNull(actorSignatures.endedAt)),
    )
    .limit(2);
  return rows.length === 1 ? rows[0] : undefined;
}

/** 本 world 内全部 actor 的 id 与名字；用于 god-view 查询与提示词。 */
export async function listActorNamesInWorld(
  executor: Executor,
  worldId: string,
): Promise<{ id: string; name: string; stageId: string }[]> {
  return executor
    .select({ id: actors.id, name: actors.name, stageId: actors.stageId })
    .from(actors)
    .innerJoin(stages, eq(actors.stageId, stages.id))
    .where(eq(stages.worldId, worldId));
}

/** 按签名编号在本场景内定位当前签名；只做签名查找，不查名字。 */
export async function resolveSignatureInStage(
  executor: Executor,
  stageId: string,
  handle: string,
): Promise<ActorViewRow | undefined> {
  const match = SIGNATURE_HANDLE_PATTERN.exec(handle);
  if (!match) {
    return undefined;
  }
  const seq = Number(match[1]);
  const views = await listStageActorViews(executor, stageId);
  const matches = views.filter((view) => view.signature.seq === seq);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * 某个观察者在当前场景里的引用表。
 *
 * 自己固定解析为「你自己」：自己的名字属于自知，不查名字表。
 * actor-facing 的目标解析不直接用这张表查名字，而是走签名 / 名字两个入口，
 * 见 `resolveSignatureInStage` 与 `resolveVisibleActor`。
 */
export async function stageAddressLookup(
  executor: Executor,
  gameId: string,
  observerId: string,
  stageId: string,
): Promise<AddressLookup> {
  const views = await listStageActorViews(executor, stageId);
  const names = await signatureNamesFor(executor, gameId, observerId);
  const self = views.find((view) => view.actor.id === observerId);
  const base = makeAddressLookup(
    names,
    new Map(
      views.map(({ actor, signature, appearance }) => [
        actor.id,
        {
          signatureId: signature.id,
          signatureSeq: signature.seq,
          appearance: appearance.text,
        },
      ]),
    ),
    self ? [self.actor.name] : [],
  );
  return (actorId) => {
    if (self && actorId === observerId) {
      return {
        token: `@${self.actor.name}`,
        appearance: self.appearance.text,
        isSelf: true,
      };
    }
    return base(actorId);
  };
}

/**
 * actor-facing 的唯一目标入口，只允许两条路：
 *
 * - `#编号`：在本场景按签名查，永远不需要先知道名字；
 * - `@名字`：查观察者当前给本场景签名起的名字；自己按真名匹配。
 *
 * 裸名字与 id 属于控制面，不从这里进入。
 */
export async function resolveVisibleActor(
  executor: Executor,
  input: {
    gameId: string;
    observerId: string;
    stageId: string;
    ref: string;
  },
): Promise<ActorRow> {
  const value = input.ref.trim();

  // 签名入口：#编号只按当前签名查，不需要先知道名字。
  if (value.startsWith("#")) {
    const view = await resolveSignatureInStage(executor, input.stageId, value);
    if (!view) {
      throw new GameError("invalid_action", `当前场景内找不到这个编号: ${value}`);
    }
    return view.actor;
  }

  if (!value.startsWith("@")) {
    throw new GameError("invalid_action", `引用必须使用 @名字 或 #编号: ${value}`);
  }
  const name = value.slice(1);
  const [views, names] = await Promise.all([
    listStageActorViews(executor, input.stageId),
    signatureNamesFor(executor, input.gameId, input.observerId),
  ]);
  const matches = views.filter((view) =>
    view.actor.id === input.observerId
      ? view.actor.name === name
      : names.get(view.signature.id) === name,
  );
  if (matches.length !== 1 || !matches[0]) {
    throw new GameError("invalid_action", `当前场景内找不到唯一引用: ${value}`);
  }
  return matches[0].actor;
}

/** 本场景角色的 id 与名字；文本脱敏只需要这两项。 */
export async function listStageActorRefs(
  executor: Executor,
  stageId: string,
): Promise<{ id: string; name: string }[]> {
  return executor
    .select({ id: actors.id, name: actors.name })
    .from(actors)
    .where(eq(actors.stageId, stageId))
    .orderBy(actors.seq);
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
  const rows = await executor.select().from(items).where(eq(items.actorId, actorId));
  const matches = rows.filter((row) => row.name === itemName);
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
  const rows = await executor.select().from(stageItems).where(eq(stageItems.stageId, stageId));
  const matches = rows.filter((row) => row.name === itemName);
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
  targetStageRef: string,
): Promise<StageRow> {
  const ref = stripNameRef(targetStageRef.trim());
  const [target] = await executor
    .select()
    .from(stages)
    .where(and(eq(stages.worldId, world.id), stageRefCondition(ref)))
    .limit(1);
  if (!target) {
    throw new GameError("invalid_action", `目标场景不存在（需要 id、名字或 #编号）: ${ref}`);
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

/**
 * 在本 world 内按真名定位 actor 及其场景。
 *
 * 只给控制面/测试动作使用：actor-facing 目标不能走裸真名。
 */
export async function resolveActorByNameInWorld(
  executor: Executor,
  worldId: string,
  name: string,
): Promise<ActorWithStageRow> {
  const rows = await executor
    .select({ actor: actors, stage: stages })
    .from(actors)
    .innerJoin(stages, eq(actors.stageId, stages.id))
    .where(and(eq(stages.worldId, worldId), eq(actors.name, name)))
    .limit(2);
  const [row] = rows;
  if (!row) {
    throw new GameError("invalid_action", `真名不存在: ${name}`);
  }
  if (rows.length > 1) {
    throw new GameError("invalid_action", `真名不唯一: ${name}`);
  }
  return row;
}

/** 在世界内按 id、名字或实体编号找场景；用于 teleport 这类非邻接目标。 */
export async function findStageInWorld(
  executor: Executor,
  worldId: string,
  ref: string,
): Promise<StageRow | undefined> {
  const value = stripNameRef(ref.trim());
  const [row] = await executor
    .select()
    .from(stages)
    .where(and(eq(stages.worldId, worldId), stageRefCondition(value)))
    .limit(1);
  return row;
}

/**
 * 路线回忆需要的最小图：场景、边、以及观察者知道真名的场景。
 *
 * `apply` 里装配整份状态太重，这里只读这四张表的最小列，与 `getGameState` 的三层读互不依赖。
 */
export async function loadRouteWorld(
  executor: Executor,
  input: { gameId: string; worldId: string; actorId: string; currentStageId: string },
): Promise<RouteWorld> {
  const [stageRows, edges, visits, learned] = await Promise.all([
    executor
      .select({
        id: stages.id,
        seq: stages.seq,
        name: stages.name,
        ordinal: stages.ordinal,
      })
      .from(stages)
      .where(eq(stages.worldId, input.worldId)),
    executor
      .select({
        fromStageId: stageConnections.fromStageId,
        toStageId: stageConnections.toStageId,
        passage: stageConnections.passage,
      })
      .from(stageConnections)
      .where(eq(stageConnections.worldId, input.worldId)),
    executor
      .select({ stageId: stageVisits.stageId })
      .from(stageVisits)
      .where(and(eq(stageVisits.gameId, input.gameId), eq(stageVisits.actorId, input.actorId))),
    executor
      .select({ stageId: knownStages.stageId })
      .from(knownStages)
      .where(and(eq(knownStages.gameId, input.gameId), eq(knownStages.actorId, input.actorId))),
  ]);
  const known = new Set([...visits, ...learned].map((row) => row.stageId));
  known.add(input.currentStageId);
  return { stages: stageRows, connections: edges, known };
}

/**
 * 目标场景是否在 actor 的知识账上：到访 ∪ 听说。
 *
 * 这是传送的底层约束：不是「引擎相信调用方」，而是这个 actor 确实知道这个地方。
 * 与 `knownStageIds` 同一份语义，只是走一次窄查询，不装配状态。
 */
export async function isStageKnownToActor(
  executor: Executor,
  input: { gameId: string; actorId: string; stageId: string },
): Promise<boolean> {
  const [visit] = await executor
    .select({ id: stageVisits.id })
    .from(stageVisits)
    .where(
      and(
        eq(stageVisits.gameId, input.gameId),
        eq(stageVisits.actorId, input.actorId),
        eq(stageVisits.stageId, input.stageId),
      ),
    )
    .limit(1);
  if (visit) {
    return true;
  }
  const [learned] = await executor
    .select({ id: knownStages.id })
    .from(knownStages)
    .where(
      and(
        eq(knownStages.gameId, input.gameId),
        eq(knownStages.actorId, input.actorId),
        eq(knownStages.stageId, input.stageId),
      ),
    )
    .limit(1);
  return learned !== undefined;
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
