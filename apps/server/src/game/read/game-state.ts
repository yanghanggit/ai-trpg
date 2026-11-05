import assert from "node:assert/strict";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../../db/pool";
import {
  actors,
  gamePlayers,
  type games,
  items,
  knownStages,
  stageConnections,
  stageItems,
  stages,
  stageVisits,
  users,
  worlds,
} from "../../db/schema";
import { GameError } from "../errors";
import { toItemState } from "../items";
import { listSignatureNames } from "../persistence/signature-names";
import { listCurrentSignatureViews } from "../persistence/signatures";
import type {
  ActorState,
  ConnectionState,
  GameState,
  GameStateSlice,
  ItemState,
  KnownStageState,
  PlayerState,
  SignatureNameState,
  StageState,
  StageVisitState,
} from "../types";
import { findGame } from "./find-game";
import { latestMessageSequence, listGameMessages } from "./game-messages";

type GameRow = typeof games.$inferSelect;
type PlayerRow = {
  id: string;
  userId: string;
  role: string;
  username: string;
  displayName: string;
};
type WorldRow = typeof worlds.$inferSelect;
type StageRow = typeof stages.$inferSelect;
type ConnectionRow = typeof stageConnections.$inferSelect;
type ActorRow = typeof actors.$inferSelect;
type VisitRow = typeof stageVisits.$inferSelect;
type KnownStageRow = typeof knownStages.$inferSelect;
type ItemRow = typeof items.$inferSelect;
type StageItemRow = typeof stageItems.$inferSelect;
type SignatureView = Awaited<ReturnType<typeof listCurrentSignatureViews>>[number];
type SignatureNameRow = Awaited<ReturnType<typeof listSignatureNames>>[number];

/** 一次装配需要的全部行：查询与映射分开，映射部分是纯函数。 */
type StateRows = {
  game: GameRow;
  player: PlayerRow;
  world: WorldRow;
  stages: StageRow[];
  connections: ConnectionRow[];
  actors: ActorRow[];
  visits: VisitRow[];
  knownStages: KnownStageRow[];
  items: ItemRow[];
  signatures: SignatureView[];
  stageItems: StageItemRow[];
  signatureNames: SignatureNameRow[];
};

/** 读取一局游戏的完整状态（含公共事件流）；游戏不存在时抛出 GameError。 */
export async function getGameState(db: Database, ref: string): Promise<GameState> {
  const slice = await getGameStateSlice(db, ref);
  return { ...slice, messages: await listGameMessages(db, slice.game.id) };
}

/**
 * 读取活状态：world、stages、actors、items、visits 与签名称呼，不含公共事件流。
 *
 * 判定与提示词渲染只依赖这些字段；公共事件流交给控制面单独取，长局的读取代价才不会
 * 随事件数增长。行之间的依赖只有五层，所以按层并发，不必十二条串行。
 */
export async function getGameStateSlice(db: Database, ref: string): Promise<GameStateSlice> {
  const game = await findGame(db, ref);
  if (!game) {
    throw new GameError("not_found", `游戏不存在: ${ref}`);
  }

  const [[playerRow], [worldRow]] = await Promise.all([
    db
      .select({
        id: gamePlayers.id,
        userId: gamePlayers.userId,
        role: gamePlayers.role,
        username: users.username,
        displayName: users.displayName,
      })
      .from(gamePlayers)
      .innerJoin(users, eq(gamePlayers.userId, users.id))
      .where(eq(gamePlayers.gameId, game.id))
      .limit(1),
    db.select().from(worlds).where(eq(worlds.gameId, game.id)).limit(1),
  ]);
  if (!playerRow) {
    throw new GameError("invalid_state", `游戏缺少 player: ${game.id}`);
  }
  if (!worldRow) {
    throw new GameError("invalid_state", `游戏缺少 world: ${game.id}`);
  }

  const [stageRows, connectionRows, signatureNameRows] = await Promise.all([
    db
      .select()
      .from(stages)
      .where(eq(stages.worldId, worldRow.id))
      .orderBy(asc(stages.ordinal), asc(stages.createdAt)),
    db
      .select()
      .from(stageConnections)
      .where(eq(stageConnections.worldId, worldRow.id))
      .orderBy(asc(stageConnections.createdAt)),
    listSignatureNames(db, game.id),
  ]);
  const stageIds = stageRows.map((stage) => stage.id);

  const actorRows =
    stageIds.length === 0
      ? []
      : await db
          .select()
          .from(actors)
          .where(inArray(actors.stageId, stageIds))
          .orderBy(asc(actors.seq));
  const actorIds = actorRows.map((actor) => actor.id);

  const [visitRows, knownStageRows, itemRows, signatureViews, stageItemRows] = await Promise.all([
    actorIds.length === 0
      ? []
      : db
          .select()
          .from(stageVisits)
          .where(and(eq(stageVisits.gameId, game.id), inArray(stageVisits.actorId, actorIds)))
          .orderBy(asc(stageVisits.firstVisitedAt)),
    actorIds.length === 0
      ? []
      : db
          .select()
          .from(knownStages)
          .where(and(eq(knownStages.gameId, game.id), inArray(knownStages.actorId, actorIds)))
          .orderBy(asc(knownStages.firstLearnedAt)),
    actorIds.length === 0
      ? []
      : db.select().from(items).where(inArray(items.actorId, actorIds)).orderBy(asc(items.seq)),
    // 每个 actor 当前只有一条签名；外观由该签名的当前渲染行提供。
    listCurrentSignatureViews(db, actorIds),
    stageIds.length === 0
      ? []
      : db
          .select()
          .from(stageItems)
          .where(inArray(stageItems.stageId, stageIds))
          .orderBy(asc(stageItems.seq)),
  ]);

  return assembleState({
    game,
    player: playerRow,
    world: worldRow,
    stages: stageRows,
    connections: connectionRows,
    actors: actorRows,
    visits: visitRows,
    knownStages: knownStageRows,
    items: itemRows,
    signatures: signatureViews,
    stageItems: stageItemRows,
    signatureNames: signatureNameRows,
  });
}

/** 行 → 状态；纯函数，不读库也不做业务判定。 */
function assembleState(rows: StateRows): GameStateSlice {
  const visits = assembleVisits(rows.stages, rows.visits);
  // 场景物品挂在锚点上：按 (stage, anchorKey) 分组，读侧还原成树。
  const itemsByAnchor = new Map<string, ItemState[]>();
  for (const item of rows.stageItems) {
    const id = `${item.stageId}:${item.anchorKey}`;
    const list = itemsByAnchor.get(id) ?? [];
    list.push(toItemState(item));
    itemsByAnchor.set(id, list);
  }
  const anchorKeysByStage = new Map(
    rows.stages.map((stage) => [stage.id, new Set(stage.anchors.map((anchor) => anchor.key))]),
  );
  for (const item of rows.stageItems) {
    if (!anchorKeysByStage.get(item.stageId)?.has(item.anchorKey)) {
      throw new GameError(
        "invalid_state",
        `场景物品 ${item.name} 挂在未声明的锚点上: ${item.anchorKey}`,
      );
    }
  }

  const itemsByActor = new Map<string, ItemState[]>();
  for (const item of rows.items) {
    const list = itemsByActor.get(item.actorId) ?? [];
    list.push(toItemState(item));
    itemsByActor.set(item.actorId, list);
  }

  const signatureByActor = new Map(
    rows.signatures.map(({ signature, appearance }) => [
      signature.actorId,
      { signature, appearance },
    ]),
  );

  const actorsByStage = new Map<string, ActorState[]>();
  for (const actor of rows.actors) {
    const view = signatureByActor.get(actor.id);
    if (!view) {
      throw new GameError("invalid_state", `actor 缺少签名: ${actor.name}`);
    }
    const list = actorsByStage.get(actor.stageId) ?? [];
    list.push({
      id: actor.id,
      seq: actor.seq,
      key: actor.key,
      name: actor.name,
      profile: actor.profile,
      appearance: { id: view.appearance.id, text: view.appearance.text },
      signature: {
        id: view.signature.id,
        seq: view.signature.seq,
        form: view.signature.form,
      },
      stats: actor.stats,
      hp: actor.hp,
      isDefaultPlayer: actor.isDefaultPlayer,
      equipment: actor.equipment,
      items: itemsByActor.get(actor.id) ?? [],
      actions: actor.actions,
    });
    actorsByStage.set(actor.stageId, list);
  }

  const stages: StageState[] = rows.stages.map((stage) => ({
    id: stage.id,
    seq: stage.seq,
    key: stage.key ?? stage.name,
    name: stage.name,
    profile: stage.profile,
    environment: stage.environment,
    anchors: stage.anchors.map((anchor) => ({
      key: anchor.key,
      label: anchor.label,
      ...(anchor.description === undefined ? {} : { description: anchor.description }),
      items: itemsByAnchor.get(`${stage.id}:${anchor.key}`) ?? [],
    })),
    ordinal: stage.ordinal,
    teleportBlocked: stage.teleportBlocked,
    actors: actorsByStage.get(stage.id) ?? [],
    actions: stage.actions,
  }));

  const connections: ConnectionState[] = rows.connections.map((connection) => ({
    id: connection.id,
    fromStageId: connection.fromStageId,
    toStageId: connection.toStageId,
    passage: connection.passage,
  }));

  const player: PlayerState = {
    id: rows.player.id,
    userId: rows.player.userId,
    username: rows.player.username,
    displayName: rows.player.displayName,
    role: rows.player.role,
  };

  const signatureNames: SignatureNameState[] = rows.signatureNames.map((row) => ({
    observerActorId: row.observerActorId,
    signatureId: row.signatureId,
    name: row.name,
    source: row.source,
    learnedStageId: row.learnedStageId,
  }));

  return {
    game: {
      id: rows.game.id,
      ownerId: rows.game.ownerId,
      name: rows.game.name,
      slug: rows.game.slug,
      status: rows.game.status,
      outcome: rows.game.outcome ?? null,
      contentVersion: rows.game.contentVersion,
      version: rows.game.version,
      createdAt: rows.game.createdAt.toISOString(),
      updatedAt: rows.game.updatedAt.toISOString(),
    },
    player,
    world: {
      id: rows.world.id,
      seq: rows.world.seq,
      name: rows.world.name,
      contentKey: rows.world.contentKey,
      profile: rows.world.profile,
      campaignSetting: rows.world.campaignSetting,
      globalRules: rows.world.globalRules,
      functionAgents: rows.world.functionAgents,
      actions: rows.world.actions,
      stages,
      connections,
    },
    signatureNames,
    visits,
    knownStages: assembleKnownStages(rows.stages, rows.knownStages),
  };
}

/**
 * 访问历史按首次到访排序。
 *
 * 同一回合的多次到达共享同一个 `now`，时间并列时用场景序号兜底，保证读出的顺序可复现。
 */
function assembleVisits(stages: readonly StageRow[], rows: readonly VisitRow[]): StageVisitState[] {
  const stageOrdinal = new Map(stages.map((stage) => [stage.id, stage.ordinal]));
  const ordinalOf = (stageId: string): number => {
    const ordinal = stageOrdinal.get(stageId);
    // 到访记录由外键指向 stages，actor 又属于本 world，所以这里不可能缺失；
    // 真缺失说明数据被改坏，宁可当场炸，也不排序成 0 悄悄混进列表开头。
    assert(ordinal !== undefined, `访问历史指向了本局之外的场景: ${stageId}`);
    return ordinal;
  };
  return rows
    .map((visit) => ({
      actorId: visit.actorId,
      stageId: visit.stageId,
      firstVisitedAt: visit.firstVisitedAt.toISOString(),
      lastVisitedAt: visit.lastVisitedAt.toISOString(),
    }))
    .sort(
      (left, right) =>
        left.firstVisitedAt.localeCompare(right.firstVisitedAt) ||
        ordinalOf(left.stageId) - ordinalOf(right.stageId) ||
        left.actorId.localeCompare(right.actorId),
    );
}

/** 非到访得知的场景名；与 `assembleVisits` 同一套并列兜底规则。 */
function assembleKnownStages(
  stages: readonly StageRow[],
  rows: readonly KnownStageRow[],
): KnownStageState[] {
  const stageOrdinal = new Map(stages.map((stage) => [stage.id, stage.ordinal]));
  const ordinalOf = (stageId: string): number => {
    const ordinal = stageOrdinal.get(stageId);
    // 与到访同理：外键保证场景属于本 world，缺失说明数据被改坏。
    assert(ordinal !== undefined, `场景知识指向了本局之外的场景: ${stageId}`);
    return ordinal;
  };
  return rows
    .map((row) => ({
      actorId: row.actorId,
      stageId: row.stageId,
      firstLearnedAt: row.firstLearnedAt.toISOString(),
      source: row.source,
      learnedStageId: row.learnedStageId,
    }))
    .sort(
      (left, right) =>
        left.firstLearnedAt.localeCompare(right.firstLearnedAt) ||
        ordinalOf(left.stageId) - ordinalOf(right.stageId) ||
        left.actorId.localeCompare(right.actorId),
    );
}

/**
 * 回合结束时的交付：活状态切片 + 事件流游标，两条查询互不依赖，一起发。
 *
 * 状态与游标各自独立成形，调用方拿游标按 `afterSequence` 增量拉本回合的事件流。
 */
export async function readTurnDelivery(
  db: Database,
  gameId: string,
): Promise<{ state: GameStateSlice; messageCursor: number }> {
  const [state, messageCursor] = await Promise.all([
    getGameStateSlice(db, gameId),
    latestMessageSequence(db, gameId),
  ]);
  return { state, messageCursor };
}
