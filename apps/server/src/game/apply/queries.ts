import { and, asc, eq, isNull } from "drizzle-orm";
import {
  actorSignatures,
  actors,
  appearances,
  items,
  stageConnections,
  stageItems,
  stages,
  stageVisits,
  worlds,
} from "../../db/schema";
import { type AddressLookup, makeAddressLookup, withSelf } from "../addressing";
import { addStats, type Stats } from "../attributes";
import { GameError } from "../errors";
import { signatureNamesFor } from "../persistence/signature-names";
import { handleOf, isHandleRef, parseHandle, stripNameRef } from "../reference";
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

/** 场景 ref：id、名字或实体编号；编号与签名共用实体序号，按调用上下文区分。 */
function stageRefCondition(ref: string) {
  const seq = parseHandle(ref);
  if (seq !== null) {
    return eq(stages.seq, seq);
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
  const seq = parseHandle(handle);
  if (seq === null) {
    return undefined;
  }
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
  const seq = parseHandle(handle);
  if (seq === null) {
    return undefined;
  }
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
  return self
    ? withSelf(base, {
        id: self.actor.id,
        name: self.actor.name,
        appearance: self.appearance.text,
      })
    : base;
}

/**
 * actor-facing 的唯一目标入口，只允许两条路：
 *
 * - `#编号`：在本场景按签名查，永远不需要先知道名字；
 * - 名字：查观察者当前给本场景签名起的名字；自己按真名匹配。
 *
 * id 属于控制面，不从这里进入。名字就是地址，所以没有第二套写法。
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
  if (isHandleRef(value)) {
    const view = await resolveSignatureInStage(executor, input.stageId, value);
    if (!view) {
      throw new GameError("invalid_action", `当前场景内找不到这个编号: ${value}`);
    }
    return view.actor;
  }

  const name = stripNameRef(value);
  if (name.length === 0) {
    throw new GameError("invalid_action", `引用不能为空: ${value}`);
  }
  const [views, names] = await Promise.all([
    listStageActorViews(executor, input.stageId),
    signatureNamesFor(executor, input.gameId, input.observerId),
  ]);
  const matches = views.filter((view) =>
    view.actor.id === input.observerId
      ? view.actor.name === name
      : names.get(view.signature.id) === name,
  );
  const [match] = matches;
  if (matches.length > 1) {
    // 同一个称呼指向多个对象：地址退化为编号，这里必须说清楚可以改用哪几个。
    const candidates = matches.map((view) => handleOf(view.signature.seq)).join("、");
    throw new GameError(
      "invalid_action",
      `「${name}」在当前场景里对应多个对象（${candidates}）；用编号指认其中一个: ${value}`,
    );
  }
  if (!match) {
    throw new GameError("invalid_action", `当前场景内找不到这个引用: ${value}`);
  }
  return match.actor;
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
  const rows = await executor
    .select()
    .from(items)
    .where(eq(items.actorId, actor.id))
    .orderBy(asc(items.seq));
  const byName = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!byName.has(row.name)) {
      byName.set(row.name, row);
    }
  }
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

/**
 * 敏捷比较用的现值：自身属性 + 穿戴物品加成，与防御同一条「现读」规则。
 *
 * 偷取与查看都拿它和目标比，避免「面板一个数、结算另一个数」。
 */
export async function effectiveAgility(executor: Executor, actor: ActorRow): Promise<number> {
  return addStats(actor.stats, await resolveEquippedStats(executor, actor)).agility;
}

/**
 * 按名字取 actor 名下的一件物品。
 *
 * 一个名字在一个作用域里只有一行，由写入侧保证（等价的并入 `count`，不等价的拒绝）。
 * 历史数据若仍有重复，取序号最早的那一行——名字是唯一的地址，读取不该因为脏数据
 * 把整回合卡死。
 */
export async function resolveActorItem(
  executor: Executor,
  actorId: string,
  itemName: string,
): Promise<ItemRow> {
  const [item] = await executor
    .select()
    .from(items)
    .where(and(eq(items.actorId, actorId), eq(items.name, itemName)))
    .orderBy(asc(items.seq))
    .limit(1);
  if (!item) {
    throw new GameError("invalid_action", `actor 没有这件物品: ${itemName}`);
  }
  return item;
}

/** 某个角色名下的全部物品；搜刮尸体要用整份清单，按序号稳定排序。 */
export async function listActorItems(executor: Executor, actorId: string): Promise<ItemRow[]> {
  return executor.select().from(items).where(eq(items.actorId, actorId)).orderBy(asc(items.seq));
}

/** 场景物品按 (场景, 锚点, 名字) 定位：锚点内名字唯一由写入侧保证。 */
export async function resolveStageItem(
  executor: Executor,
  stageId: string,
  anchor: { key: string; label: string },
  itemName: string,
): Promise<StageItemRow> {
  const [item] = await executor
    .select()
    .from(stageItems)
    .where(
      and(
        eq(stageItems.stageId, stageId),
        eq(stageItems.anchorKey, anchor.key),
        eq(stageItems.name, itemName),
      ),
    )
    .orderBy(asc(stageItems.seq))
    .limit(1);
  if (!item) {
    throw new GameError("invalid_action", `「${anchor.label}」上没有「${itemName}」。`);
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
    // 回显调用方给的引用，不回显解析出的真名：`#7` 不该被翻译成那个地方的名字。
    throw new GameError("invalid_action", `没有从 ${stage.name} 到 ${ref} 的通道`);
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

/**
 * 只按真名定位场景。
 *
 * 传送只认名字：`#编号` 是「看得见还没命名」的站位，id 是控制面身份，两者都不该
 * 变成传送地址——否则知识门槛会被一个编号绕过去，拒绝文案也会把名字泄出来。
 */
export async function findStageByNameInWorld(
  executor: Executor,
  worldId: string,
  name: string,
): Promise<StageRow | undefined> {
  const [row] = await executor
    .select()
    .from(stages)
    .where(and(eq(stages.worldId, worldId), eq(stages.name, stripNameRef(name.trim()))))
    .limit(1);
  return row;
}

/**
 * 路线回忆需要的最小图：场景、边、以及观察者走过去哪些地方。
 *
 * `apply` 里装配整份状态太重，这里只读三张表的最小列，与 `getGameState` 的三层读互不依赖。
 */
export async function loadRouteWorld(
  executor: Executor,
  input: { gameId: string; worldId: string; actorId: string; currentStageId: string },
): Promise<RouteWorld> {
  const [stageRows, edges, visits] = await Promise.all([
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
  ]);
  const visited = new Set(visits.map((row) => row.stageId));
  visited.add(input.currentStageId);
  return { stages: stageRows, connections: edges, visited };
}
