import { and, asc, eq, isNull } from "drizzle-orm";
import {
  actorSignatures,
  actors,
  appearances,
  items,
  stageConnections,
  stageItems,
  stages,
  worlds,
} from "../../db/schema";
import { carriedActionsForKind, isSlotActionKind } from "../actions";
import { GameError } from "../errors";
import type { Wearer } from "../gameplay";
import {
  type AddressLookup,
  handleOf,
  isHandleRef,
  makeAddressLookup,
  parseHandle,
  withSelf,
} from "../kernel/addressing";
import { hasAffixes } from "../kernel/affixes";
import type { HeldActionKind, SlotActionKind } from "../kernel/types";
import { EQUIPMENT_SLOTS } from "../kernel/types";
import type {
  ActorRow,
  Executor,
  ItemRow,
  StageItemRow,
  StageRow,
  WorldRow,
} from "../persistence/rows";
import { signatureNamesFor } from "../persistence/signature-names";

/**
 * 玩法侧带策略的只读查询：解析动作与守卫要回答「谁看得见、身上有什么、能不能到哪里」。
 *
 * 全部只读——写原语在 `persistence/`。共用的行级完整性规则（例如按真名定位 actor）
 * 跟着表走、在 `persistence/` 的 `resolve*`；这里只放动作语义需要的解析与判定。
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 舞台 ref：id、名字或实体编号；编号与签名共用实体序号，按调用上下文区分。 */
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

/** 本舞台全部角色及其当前签名。 */
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

/** 按签名编号在本舞台内定位当前签名；只做签名查找，不查名字。 */
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
 * 某个观察者在当前舞台里的引用表。
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
  const perceived = views.filter((view) => view.actor.id === observerId || !view.actor.concealed);
  const base = makeAddressLookup(
    names,
    new Map(
      perceived.map(({ actor, signature, appearance }) => [
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
 * - `#编号`：在本舞台按签名查，永远不需要先知道名字；
 * - 名字：查观察者当前给本舞台签名起的名字；自己按真名匹配。
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

  // 签名入口：#编号只按当前签名查，不需要先知道名字；隐匿者不算可见。
  if (isHandleRef(value)) {
    const view = await resolveSignatureInStage(executor, input.stageId, value);
    if (!view || (view.actor.concealed && view.actor.id !== input.observerId)) {
      throw new GameError("invalid_action", `当前舞台内找不到这个编号: ${value}`);
    }
    return view.actor;
  }

  const name = value;
  if (name.length === 0) {
    throw new GameError("invalid_action", `引用不能为空: ${value}`);
  }
  const [views, names] = await Promise.all([
    listStageActorViews(executor, input.stageId),
    signatureNamesFor(executor, input.gameId, input.observerId),
  ]);
  const perceived = views.filter(
    (view) => view.actor.id === input.observerId || !view.actor.concealed,
  );
  const matches = perceived.filter((view) =>
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
      `「${name}」在当前舞台里对应多个对象（${candidates}）；用编号指认其中一个: ${value}`,
    );
  }
  if (!match) {
    throw new GameError("invalid_action", `当前舞台内找不到这个引用: ${value}`);
  }
  return match.actor;
}

/** 本舞台角色的 id 与名字；文本脱敏只需要这两项。 */
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

/** actor 名下的全部道具行，按名字建索引：同名只留最早一行（名字是唯一地址）。 */
async function loadOwnedItemRows(
  executor: Executor,
  actorId: string,
): Promise<Map<string, ItemRow>> {
  const rows = await executor
    .select()
    .from(items)
    .where(eq(items.actorId, actorId))
    .orderBy(asc(items.seq));
  const byName = new Map<string, ItemRow>();
  for (const row of rows) {
    if (!byName.has(row.name)) {
      byName.set(row.name, row);
    }
  }
  return byName;
}

/** 按槽位索引解析出穿戴中的道具行；指向不存在道具的悬空索引直接跳过。 */
export async function resolveEquippedItems(
  executor: Executor,
  actor: ActorRow,
): Promise<ItemRow[]> {
  const byName = await loadOwnedItemRows(executor, actor.id);
  return EQUIPMENT_SLOTS.flatMap((slot) => {
    const name = actor.equipment[slot];
    const item = name === undefined ? undefined : byName.get(name);
    return item ? [item] : [];
  });
}

/** 结算期的动作来源：从行重算，与 `item-state` 的派生同构。 */
export async function resolveActionSources(
  executor: Executor,
  actor: ActorRow,
): Promise<{ slot: SlotActionKind[]; held: HeldActionKind[] }> {
  const byName = await loadOwnedItemRows(executor, actor.id);
  const slot: SlotActionKind[] = EQUIPMENT_SLOTS.flatMap((equippedSlot) => {
    const name = actor.equipment[equippedSlot];
    const row = name === undefined ? undefined : byName.get(name);
    if (!row) {
      return [];
    }
    // 与 `carriedActions` 同口径：动作还要在该大类可授予的范围内。
    const grantable = carriedActionsForKind(row.kind);
    return row.actions.filter(
      (kind): kind is SlotActionKind => isSlotActionKind(kind) && grantable.includes(kind),
    );
  });
  const held: HeldActionKind[] = [...byName.values()].some((row) => hasAffixes(row, "use"))
    ? ["use"]
    : [];
  return { slot, held };
}

/**
 * 现值计算的输入：本体属性、穿戴槽与在穿的道具行。
 *
 * 怎么分「源属性」与「终值」归玩法层（`gameplay/effective.ts`）；这里只负责把行取齐，
 * 面板与结算因此永远读同一份来源。
 */
export async function wearerView(executor: Executor, actor: ActorRow): Promise<Wearer> {
  return {
    stats: actor.stats,
    equipment: actor.equipment,
    items: await resolveEquippedItems(executor, actor),
  };
}

/**
 * 按名字取 actor 名下的一件道具。
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
    throw new GameError("invalid_action", `actor 没有这件道具: ${itemName}`);
  }
  return item;
}

/** 某个角色名下的全部道具；搜刮尸体要用整份清单，按序号稳定排序。 */
export async function listActorItems(executor: Executor, actorId: string): Promise<ItemRow[]> {
  return executor.select().from(items).where(eq(items.actorId, actorId)).orderBy(asc(items.seq));
}

/** 舞台道具按 (舞台, 锚点, 名字) 定位：锚点内名字唯一由写入侧保证。 */
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

/** 读取与当前舞台相邻的目标舞台；必须存在**已通行**的连接。 */
export async function resolveAdjacentStage(
  executor: Executor,
  world: WorldRow,
  stage: StageRow,
  targetStageRef: string,
): Promise<StageRow> {
  const ref = targetStageRef.trim();
  const [target] = await executor
    .select()
    .from(stages)
    .where(and(eq(stages.worldId, world.id), stageRefCondition(ref)))
    .limit(1);
  if (!target) {
    throw new GameError("invalid_action", `目标舞台不存在（需要 id、名字或 #编号）: ${ref}`);
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
 * 只按真名定位舞台。
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
    .where(and(eq(stages.worldId, worldId), eq(stages.name, name.trim())))
    .limit(1);
  return row;
}
