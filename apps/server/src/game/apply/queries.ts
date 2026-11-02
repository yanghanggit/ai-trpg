import { and, eq, isNull } from "drizzle-orm";
import {
  actorRecognitions,
  actorSignatures,
  actors,
  appearances,
  items,
  stageConnections,
  stageItems,
  stages,
  worlds,
} from "../../db/schema";
import { type AddressLookup, makeAddressLookup, stripNameRef } from "../addressing";
import { addStats, type Stats } from "../attributes";
import { GameError } from "../errors";
import { EQUIPMENT_SLOTS } from "../types";
import type { ActorRow, Executor, ItemRow, StageItemRow, StageRow, WorldRow } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** 按匿名编号（`#<签名序号>`）在本场景内定位角色。 */
export async function findActorViewByHandleInStage(
  executor: Executor,
  stageId: string,
  handle: string,
): Promise<ActorViewRow | undefined> {
  const seq = Number(handle.slice(1));
  if (!Number.isInteger(seq) || seq <= 0) {
    return undefined;
  }
  const [row] = await executor
    .select({ actor: actors, signature: actorSignatures, appearance: appearances })
    .from(actorSignatures)
    .innerJoin(actors, eq(actorSignatures.actorId, actors.id))
    .innerJoin(appearances, currentAppearance(actorSignatures.id))
    .where(
      and(
        eq(actors.stageId, stageId),
        eq(actorSignatures.seq, seq),
        isNull(actorSignatures.endedAt),
      ),
    )
    .limit(2);
  return row;
}

/** 按句柄在本 world 内定位角色；识别可以在人物离场后补记。 */
export async function findActorViewByHandleInWorld(
  executor: Executor,
  worldId: string,
  handle: string,
): Promise<ActorViewRow | undefined> {
  const seq = Number(handle.slice(1));
  if (!Number.isInteger(seq) || seq <= 0) {
    return undefined;
  }
  const [row] = await executor
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
  return row;
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

/** 观察者认得的签名：认得即知道真名。 */
export async function recognizedSignaturesFor(
  executor: Executor,
  gameId: string,
  observerActorId: string,
): Promise<Set<string>> {
  const rows = await executor
    .select()
    .from(actorRecognitions)
    .where(
      and(
        eq(actorRecognitions.gameId, gameId),
        eq(actorRecognitions.observerActorId, observerActorId),
      ),
    );
  return new Set(rows.map((row) => row.signatureId));
}

/**
 * 某个观察者在当前场景里的引用表。
 *
 * 自己固定解析为「你自己」：自己的名字属于自知，不查名字表。
 */
export async function stageAddressLookup(
  executor: Executor,
  gameId: string,
  observerId: string,
  stageId: string,
): Promise<AddressLookup> {
  const views = await listStageActorViews(executor, stageId);
  const recognized = await recognizedSignaturesFor(executor, gameId, observerId);
  const base = makeAddressLookup(
    recognized,
    new Map(
      views.map(({ actor, signature, appearance }) => [
        actor.id,
        {
          actorId: actor.id,
          name: actor.name,
          signatureId: signature.id,
          signatureSeq: signature.seq,
          appearance: appearance.text,
        },
      ]),
    ),
  );
  const self = views.find((view) => view.actor.id === observerId);
  return (actorId) => {
    if (self && actorId === observerId) {
      return {
        token: `@${self.actor.name}`,
        label: "你自己",
        mention: "你",
        appearance: self.appearance.text,
        known: true,
        isSelf: true,
      };
    }
    return base(actorId);
  };
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
 * 在当前场景内定位角色。
 *
 * 接受 `#12`、`@真名`、纯真名或 id；后三者都按真名 / id 解析，不做观察者识别校验。
 * 感知边界在渲染与写入时执行：名单只会给当前观察者 token，辨认真名也必须是真名；
 * 解析层信任调用方，god-view 入口可以直接用真名或 id。不接受简称，也不做模糊匹配。
 */
export async function findActorInStage(
  executor: Executor,
  stageId: string,
  ref: string,
): Promise<ActorRow> {
  const value = ref.trim();
  if (value.startsWith("#")) {
    const view = await findActorViewByHandleInStage(executor, stageId, value);
    if (!view) {
      throw new GameError("invalid_action", `场景内没有这个编号: ${value}`);
    }
    return view.actor;
  }
  const name = value.startsWith("@") ? value.slice(1) : value;
  // god-view 入口可以直接用 actor id：客户端拿到的稳定身份就是它。
  const matches = UUID_PATTERN.test(name)
    ? await executor
        .select()
        .from(actors)
        .where(and(eq(actors.stageId, stageId), eq(actors.id, name)))
        .limit(2)
    : await executor
        .select()
        .from(actors)
        .where(and(eq(actors.stageId, stageId), eq(actors.name, name)))
        .limit(2);
  const [target] = matches;
  if (matches.length !== 1 || !target) {
    throw new GameError("invalid_action", `当前场景内找不到唯一角色: ${value}`);
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
    .where(
      and(
        eq(stages.worldId, world.id),
        UUID_PATTERN.test(ref) ? eq(stages.id, ref) : eq(stages.name, ref),
      ),
    )
    .limit(1);
  if (!target) {
    throw new GameError("invalid_action", `目标场景不存在（需要 id 或名字）: ${ref}`);
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

/** 在世界内按 id 或名字找场景；用于 teleport 这类非邻接目标。 */
export async function findStageInWorld(
  executor: Executor,
  worldId: string,
  ref: string,
): Promise<StageRow | undefined> {
  const value = stripNameRef(ref.trim());
  const [row] = await executor
    .select()
    .from(stages)
    .where(
      and(
        eq(stages.worldId, worldId),
        UUID_PATTERN.test(value) ? eq(stages.id, value) : eq(stages.name, value),
      ),
    )
    .limit(1);
  return row;
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
