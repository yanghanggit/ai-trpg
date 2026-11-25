/**
 * 服务端可驱动的操作：建局、读状态、接管、玩家动作、回合推进。
 *
 * CLI 与 HTTP 共用这一层，只有参数形状与输出封装不同。这里刻意不含文件落盘
 * （快照 / 记忆导出 / 故事落盘），那是调试产物的入口，见 `game-ops/artifacts.ts`。
 */

import type { Database } from "../db/pool";
import { createTurnTrace, type TraceContext, traceEvent } from "../debug/trace";
import {
  type AppearanceOutcome,
  createGame,
  deleteGameRow,
  endGame,
  findActorByName,
  findActorByRef,
  GameError,
  getGameMeta,
  isAlive,
  latestMessageSequence,
  listGameMessages,
  type PlayerActionOptions,
  playerAnnounce,
  playerBrawl,
  playerCall,
  playerEquip,
  playerFit,
  playerGive,
  playerHide,
  playerInspect,
  playerLoot,
  playerMove,
  playerPickup,
  playerRecallRoute,
  playerRecognizeIdentity,
  playerReveal,
  playerSay,
  playerSteal,
  playerStrike,
  playerTeleport,
  playerUnequip,
  playerUse,
  playerWait,
  playerWhisper,
  readActionOrder,
  recordTurnTaken,
  refreshCorpseAppearance,
  releaseActorControl,
  runActorTurn,
  runStageTurn,
  runWorldTurn,
  scanDeathsToSettle,
  settleDeath,
  takeActorControl,
  updateAppearance,
} from "../game";
import { visitedStagesForActor } from "../game/actor-state";
import { getGameState, getGameStateSlice } from "../game/game-state";
import type {
  ActionOrderState,
  ActorPlan,
  ActorTurnResult,
  DeathSettlement,
  GameState,
  GameStateSlice,
  MessageState,
  StageTurnResult,
  WorldTurnResult,
} from "../game/kernel/types";
import type { World } from "../game/world-definition";
import type { Logger } from "../logging";
import type { PlayerActionRequest } from "./player-action";
import type { LlmServices, TurnServices } from "./services";

// ---------------------------------------------------------------- 建局与读取

export type CreateGameOpInput = {
  username: string;
  world: World;
  name?: string;
  slug?: string;
};

/** 建局：内容来源由调用方解析成 `World`，这里只管落库与导出 system prompt。 */
export async function createGameOp(
  db: Database,
  input: CreateGameOpInput,
  options: { logger?: Logger } = {},
): Promise<{ state: GameState }> {
  const state = await createGame(
    db,
    {
      username: input.username,
      world: input.world,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.slug === undefined ? {} : { slug: input.slug }),
    },
    options,
  );
  return { state };
}

export async function readGameState(db: Database, gameRef: string): Promise<{ state: GameState }> {
  return { state: await getGameState(db, gameRef) };
}

export type EndGameOpInput = {
  outcome: string;
  message?: string;
};

/**
 * 结束一局：客户端叫停与 world 裁决走同一个转移点。
 *
 * 放在控制面而不是回合里：它不推进世界，只标记「这一局到此为止」。
 * 句子给不给可选——不给就只翻状态，引擎不替调用方编结局。
 */
export async function endGameOp(
  db: Database,
  gameRef: string,
  input: EndGameOpInput,
): Promise<{ ended: boolean }> {
  const game = await getGameMeta(db, gameRef);
  return endGame(db, game.id, {
    outcome: input.outcome,
    ...(input.message === undefined ? {} : { message: input.message }),
  });
}

/** 删局：一行级联清场，不留归档。owner 之外的人在路由层就被挡下。 */
export async function deleteGameOp(
  db: Database,
  gameRef: string,
): Promise<{ deleted: string; slug: string }> {
  const game = await getGameMeta(db, gameRef);
  if (!(await deleteGameRow(db, game.id))) {
    throw new GameError("invalid_state", `游戏状态已变，请重读: ${gameRef}`);
  }
  return { deleted: game.id, slug: game.slug };
}

/** 事件流：只给游标与新消息，不带活状态。 */
export async function readGameMessages(
  db: Database,
  gameRef: string,
  query: { after?: number; limit?: number } = {},
): Promise<{ messages: MessageState[]; messageCursor: number }> {
  const game = await getGameMeta(db, gameRef);
  const [messages, messageCursor] = await Promise.all([
    listGameMessages(db, game.id, { afterSequence: query.after, limit: query.limit }),
    latestMessageSequence(db, game.id),
  ]);
  return { messages, messageCursor };
}

/** 按舞台列 actor 名字：只读投影，不装配事件流。 */
export async function readStageMap(
  db: Database,
  gameRef: string,
): Promise<{ stages: Record<string, string[]> }> {
  const state = await getGameState(db, gameRef);
  const stages = Object.fromEntries(
    state.world.stages.map((stage) => [stage.name, stage.actors.map((actor) => actor.name)]),
  );
  return { stages };
}

export async function readVisitedStages(
  db: Database,
  gameRef: string,
  actorRef: string,
): Promise<{
  actor: { id: string; name: string };
  visited: { stageId: string; name: string }[];
}> {
  const state = await getGameStateSlice(db, gameRef);
  const actor = findActorByRef(state, actorRef);
  return {
    actor: { id: actor.id, name: actor.name },
    visited: visitedStagesForActor(state, actor.id).map((stage) => ({
      stageId: stage.id,
      name: stage.name,
    })),
  };
}

// ---------------------------------------------------------------- 接管与玩家动作

export async function takeControlOp(
  db: Database,
  gameRef: string,
  actorRef: string,
): Promise<Record<string, unknown>> {
  return { result: await takeActorControl(db, gameRef, actorRef) };
}

export async function releaseControlOp(
  db: Database,
  gameRef: string,
  actorRef: string,
): Promise<Record<string, unknown>> {
  await releaseActorControl(db, gameRef, actorRef);
  return { result: { released: true } };
}

export type PlayerActionOutput = {
  plan: ActorPlan | null;
  state: ActorTurnResult["state"];
  /** 回合结束时公共事件流里最大的序号；客户端从这里往后拉新事件。 */
  messageCursor: number;
  death?: DeathSettlement[];
};

/** 玩家动作的统一输出：计划、结算后的活状态，死亡阶段有结果时一并带出。 */
export function playerActionOutput(result: ActorTurnResult): PlayerActionOutput {
  return {
    plan: result.plan,
    state: result.state,
    messageCursor: result.messageCursor,
    ...(result.death === undefined ? {} : { death: result.death }),
  };
}

function reasonOf(action: { reason?: string }): { reason?: string } {
  return action.reason === undefined ? {} : { reason: action.reason };
}

/**
 * 一个已决定的动作走同一份落账路径。
 *
 * 服务注入与 `agent-game` 保持一致：计划阶段用 `service`，结算后的增量阶段用
 * `inferenceService`；不需要推理的动作不传，免得白付一次模型调用。
 *
 * 一次提交就是一个动作、一个回合，成功就在顺位上 +1——玩家与 NPC 同样计数。玩家入口
 * 没有「一份计划里连做几件事」的形状，连打这个入口就是几个回合。
 */
export async function submitPlayerAction(
  db: Database,
  gameRef: string,
  actorRef: string,
  action: PlayerActionRequest,
  services: TurnServices,
): Promise<PlayerActionOutput> {
  // 与点名推进占同一个位置：玩家动作同样整回合跑在写事务之外，两发并发会多记一次数。
  const state = await getGameStateSlice(db, gameRef);
  const actor = findActorByRef(state, actorRef);
  // 期望名次要在回合之前读：推进之后计数已经变了，事后再读就不是这一刻的判断。
  const order = await readActionOrder(db, state.game.id);
  const claims = claimAdvances(state.game.id, [actor]);
  const trace = createTurnTrace({ game: state.game, turnKind: "player" });
  try {
    const result = await dispatchPlayerAction(db, gameRef, actorRef, action, services, trace);
    // 被拒的动作走不到这里（落账层直接抛错），所以「回来且 ok」就是「发生过」。
    if (result.ok) {
      await recordTurnTaken(db, result.state.game.id, actor.id);
    }
    return playerActionOutput(result);
  } finally {
    // 被拒也记：推了谁、该轮到谁，是客户端这一次决定的事实，不因为落账失败而消失。
    if (order !== null) {
      await recordDispatch({ trace, order, actorId: actor.id, actorName: actor.name });
    }
    releaseAdvances(claims);
  }
}

async function dispatchPlayerAction(
  db: Database,
  gameRef: string,
  actorRef: string,
  action: PlayerActionRequest,
  services: TurnServices,
  trace: TraceContext | undefined,
): Promise<ActorTurnResult> {
  // 轨迹跟着回合一整条走：每个 case 只挑自己需要的服务，轨迹统一在这里补上。
  const turnOptions = (needed: PlayerActionOptions = {}): PlayerActionOptions => ({
    ...needed,
    ...(trace === undefined ? {} : { trace }),
  });
  switch (action.kind) {
    case "say":
      return playerSay(
        db,
        gameRef,
        actorRef,
        {
          message: action.message,
          targetActorRef: action.target,
          ...reasonOf(action),
        },
        turnOptions(),
      );
    case "whisper":
      return playerWhisper(
        db,
        gameRef,
        actorRef,
        {
          message: action.message,
          targetActorRef: action.target,
          ...reasonOf(action),
        },
        turnOptions(),
      );
    case "call":
      return playerCall(
        db,
        gameRef,
        actorRef,
        {
          message: action.message,
          targetActorName: action.target,
          ...reasonOf(action),
        },
        turnOptions(),
      );
    case "announce":
      return playerAnnounce(
        db,
        gameRef,
        actorRef,
        {
          message: action.message,
          ...reasonOf(action),
        },
        turnOptions(),
      );
    case "move":
      return playerMove(db, gameRef, actorRef, { targetStageRef: action.to }, turnOptions());
    case "teleport":
      return playerTeleport(db, gameRef, actorRef, { targetStageRef: action.to }, turnOptions());
    case "wait":
      return playerWait(db, gameRef, actorRef, turnOptions());
    case "hide":
      return playerHide(db, gameRef, actorRef, turnOptions());
    case "reveal":
      return playerReveal(db, gameRef, actorRef, turnOptions());
    case "strike":
      return playerStrike(
        db,
        gameRef,
        actorRef,
        { targetActorRef: action.target },
        turnOptions({
          service: services.service,
          inferenceService: services.inferenceService,
        }),
      );
    case "brawl":
      return playerBrawl(
        db,
        gameRef,
        actorRef,
        { targetActorRef: action.target },
        turnOptions({ inferenceService: services.inferenceService }),
      );
    case "steal":
      return playerSteal(
        db,
        gameRef,
        actorRef,
        {
          targetActorRef: action.target,
          itemName: action.item,
        },
        turnOptions(),
      );
    case "inspect":
      return playerInspect(db, gameRef, actorRef, { targetActorRef: action.target }, turnOptions());
    case "loot":
      return playerLoot(
        db,
        gameRef,
        actorRef,
        {
          targetActorRef: action.target,
          ...(action.items === undefined ? {} : { itemNames: action.items }),
        },
        turnOptions(),
      );
    case "give":
      return playerGive(
        db,
        gameRef,
        actorRef,
        { targetActorRef: action.target, itemName: action.item },
        turnOptions({ inferenceService: services.inferenceService }),
      );
    case "pickup":
      return playerPickup(
        db,
        gameRef,
        actorRef,
        {
          targetAnchor: action.anchor,
          itemName: action.item,
        },
        turnOptions(),
      );
    case "use":
      return playerUse(
        db,
        gameRef,
        actorRef,
        {
          itemName: action.item,
          ...(action.target === undefined ? {} : { targetActorRef: action.target }),
          ...(action.stage === undefined ? {} : { targetStageName: action.stage }),
          ...(action.anchor === undefined ? {} : { targetAnchor: action.anchor }),
        },
        turnOptions({
          service: services.service,
          inferenceService: services.inferenceService,
        }),
      );
    case "fit":
      return playerFit(
        db,
        gameRef,
        actorRef,
        { itemName: action.item, targetAnchor: action.anchor },
        turnOptions({
          service: services.service,
          inferenceService: services.inferenceService,
        }),
      );
    case "equip":
      return playerEquip(
        db,
        gameRef,
        actorRef,
        { itemName: action.item, slot: action.slot },
        turnOptions({ inferenceService: services.inferenceService }),
      );
    case "unequip":
      return playerUnequip(
        db,
        gameRef,
        actorRef,
        { slot: action.slot },
        turnOptions({ inferenceService: services.inferenceService }),
      );
    case "recognize-identity":
      return playerRecognizeIdentity(
        db,
        gameRef,
        actorRef,
        {
          targetActorRef: action.target,
          name: action.name,
        },
        turnOptions(),
      );
    case "ask-route":
      return playerRecallRoute(
        db,
        gameRef,
        actorRef,
        {
          ...(action.from === undefined ? {} : { fromStageRef: action.from }),
          toStageRef: action.to,
        },
        turnOptions(),
      );
  }
}

// ---------------------------------------------------------------- 回合推进

export type ActorTurnOutput = {
  ok: boolean;
  plan: ActorPlan | null;
  loopSuccess: boolean;
  state: GameStateSlice;
  messageCursor: number;
  death?: DeathSettlement[];
};

export type StageTurnOutput = {
  ok: boolean;
  plan: StageTurnResult["plan"] | WorldTurnResult["plan"];
  loopSuccess: boolean;
  state: GameStateSlice;
  messageCursor: number;
};

/** 回合输出不内联整份事件流：只给活状态与游标，需要事件时再拉 `messages`。 */
function actorTurnOutput(result: ActorTurnResult): ActorTurnOutput {
  return {
    ok: result.ok,
    plan: result.plan,
    loopSuccess: result.loopSuccess,
    state: result.state,
    messageCursor: result.messageCursor,
    ...(result.death === undefined ? {} : { death: result.death }),
  };
}

function stageTurnOutput(result: StageTurnResult): StageTurnOutput {
  return {
    ok: result.ok,
    plan: result.plan,
    loopSuccess: result.loopSuccess,
    state: result.state,
    messageCursor: result.messageCursor,
  };
}

function worldTurnOutput(result: WorldTurnResult): StageTurnOutput {
  return {
    ok: result.ok,
    plan: result.plan,
    loopSuccess: result.loopSuccess,
    state: result.state,
    messageCursor: result.messageCursor,
  };
}

export type NpcAdvanceInput = {
  actors: readonly string[];
  /**
   * 客户端组出这次推进时读到世界版本；给了就比对，不一致直接拒。
   *
   * 不是权限检查，而是「别拿旧视图做决定」：推谁由客户端自己算，旧视图算出来的决定
   * 往往是错的——与其让它落账后再纠正，不如在这里打回，让它重读重算。
   */
  expectedVersion?: number;
};

/**
 * 视图过期守卫：客户端读到的那份视图变过就拒，要求重读后再推进。
 *
 * 不是权限，而是「别拿旧视图做决定」。回合作业在**执行开始时**比一次，而不是入队时：
 * 作业可能排队，入队时的版本证明不了执行时还成立。
 */
export async function assertExpectedVersion(
  db: Database,
  gameRef: string,
  expectedVersion: number | undefined,
): Promise<void> {
  if (expectedVersion === undefined) {
    return;
  }
  const game = await getGameMeta(db, gameRef);
  if (expectedVersion !== game.version) {
    throw new GameError(
      "invalid_state",
      `视图已过期: 读到的是 version ${expectedVersion}，当前 ${game.version}，重读后再推进`,
    );
  }
}

/** 正在跑的那几个推进：键是「局 + actor id」，同一进程内互斥。 */
const ADVANCING = new Set<string>();

/**
 * 占住这一批推进；任何一个已在跑就直接拒，一个都不占。
 *
 * 模型调用在写事务之外，两发并发都会跑完整个回合：白烧一次调用，还会多记一次数。
 * 两条跑回合的入口共用这份互斥：点名推进与玩家动作，键取 actor 实体而不是名字。
 * 空回合不占位——它只加一，不跑循环。
 * 这里的互斥只在单进程内有效——多进程部署前要换成带过期的租约（落在顺位条目上）。
 */
function claimAdvances(
  gameId: string,
  actors: readonly { readonly id: string; readonly name: string }[],
): string[] {
  const busy = actors.find((actor) => ADVANCING.has(`${gameId}:${actor.id}`));
  if (busy !== undefined) {
    throw new GameError("invalid_state", `actor 正在推进中，稍后重试: ${busy.name}`);
  }
  const keys = actors.map((actor) => `${gameId}:${actor.id}`);
  for (const key of keys) {
    ADVANCING.add(key);
  }
  return keys;
}

function releaseAdvances(keys: readonly string[]): void {
  for (const key of keys) {
    ADVANCING.delete(key);
  }
}

/**
 * 记一条推进：这一回合顺位算出的期望名次、实际推的名次、两者是否一致。
 *
 * 只记录、不判罚：判据还没定，先把事实攒在过程轨迹里。推的人不在顺位上（开顺位后才加入
 * 世界）时“是否一致”无从谈起，记成空，不假装它是偏离。
 */
async function recordDispatch(input: {
  trace: TraceContext | undefined;
  order: ActionOrderState;
  actorId: string;
  actorName: string;
}): Promise<void> {
  const actual = input.order.entries.find((entry) => entry.actorId === input.actorId);
  const expected = input.order.nextActor;
  await traceEvent(input.trace, {
    event: "dispatch",
    actorId: input.actorId,
    actorName: input.actorName,
    orderId: input.order.id,
    expectedPosition: expected === null ? null : expected.position,
    actualPosition: actual === undefined ? null : actual.position,
    followed:
      expected === null || actual === undefined ? null : expected.position === actual.position,
  });
}

/**
 * 按给定名单逐个推进模型决策的 actor 回合。
 *
 * 不代选目标也没有「全部」开关：顺序、每人一次模型调用、撞上已死或被接管的 actor
 * 直接失败，都由调用方承担；重名去重，其余不筛。落账成功后在顺位上 +1，没有进行中
 * 的顺位就不记——顺位是记录，不影响这一回合能不能跑。
 */
export async function advanceNpc(
  db: Database,
  gameRef: string,
  input: NpcAdvanceInput,
  services: TurnServices,
): Promise<{ results: ActorTurnOutput[] }> {
  const options = {
    service: services.service,
    inferenceService: services.inferenceService,
    ...(services.logger === undefined ? {} : { logger: services.logger }),
    ...(services.onStep === undefined ? {} : { onStep: services.onStep }),
  };
  const game = await getGameMeta(db, gameRef);
  await assertExpectedVersion(db, gameRef, input.expectedVersion);
  const names = [...new Set(input.actors)];
  // 占位要用 actor 实体而不是名字：玩家动作那条路用的是同一把锁。
  const state = await getGameStateSlice(db, gameRef);
  const claims = claimAdvances(
    game.id,
    names.map((name) => findActorByName(state, name).actor),
  );
  try {
    const results: ActorTurnOutput[] = [];
    for (const name of names) {
      const order = await readActionOrder(db, game.id);
      // 轨迹由这里开、交给回合：推进对账要挂在同一个回合上，而不是自成一条孤立记录。
      const trace = createTurnTrace({ game, turnKind: "actor" });
      const result = await runActorTurn(db, gameRef, name, {
        ...options,
        ...(trace === undefined ? {} : { trace }),
      });
      results.push(actorTurnOutput(result));
      const { actor } = findActorByName(result.state, name);
      if (result.ok) {
        await recordTurnTaken(db, game.id, actor.id);
      }
      if (order !== null) {
        await recordDispatch({ trace, order, actorId: actor.id, actorName: actor.name });
      }
    }
    return { results };
  } finally {
    releaseAdvances(claims);
  }
}

export type PassTurnInput = { actors: readonly string[] };

/**
 * 空回合：这一回合过去了，但没有动作落账，计数照加。
 *
 * 客户端用它跳过失败的一轮（否则那个人会永远卡在队首）、或记下玩家席位这一趟没动手。
 * 记的是一条事实——「轮到过他，他没动」——不是替谁编动作。
 */
export async function passTurn(
  db: Database,
  gameRef: string,
  input: PassTurnInput,
): Promise<{ results: { actorName: string; counted: boolean }[] }> {
  const state = await getGameStateSlice(db, gameRef);
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  const results: { actorName: string; counted: boolean }[] = [];
  for (const name of new Set(input.actors)) {
    const actor = findActorByName(state, name).actor;
    results.push({
      actorName: actor.name,
      counted: await recordTurnTaken(db, state.game.id, actor.id),
    });
  }
  return { results };
}

export type StageAdvanceInput = { stages: readonly string[] };

/**
 * 按给定名单逐个推进舞台回合。
 *
 * 与 `advanceNpc` 同一套取舍：舞台由名单决定，引擎不代选，也没有「全部」开关；
 * 重复名字去重，名单里每个舞台都真的跑一个回合。一次调用仍然只推这一层，不级联到 world。
 */
export async function advanceStage(
  db: Database,
  gameRef: string,
  input: StageAdvanceInput,
  services: LlmServices,
): Promise<{ results: StageTurnOutput[] }> {
  const options = {
    service: services.service,
    ...(services.logger === undefined ? {} : { logger: services.logger }),
  };
  const results: StageTurnOutput[] = [];
  for (const stage of new Set(input.stages)) {
    results.push(stageTurnOutput(await runStageTurn(db, gameRef, stage, options)));
  }
  return { results };
}

export async function advanceWorld(
  db: Database,
  gameRef: string,
  services: LlmServices,
): Promise<StageTurnOutput> {
  const result = await runWorldTurn(db, gameRef, {
    service: services.service,
    ...(services.logger === undefined ? {} : { logger: services.logger }),
  });
  return worldTurnOutput(result);
}

export type AppearanceInput = { actors: readonly string[] };

export type AppearanceResult = AppearanceOutcome & { actor: string };

/**
 * 按给定名单逐个重推外观：名字决定走哪条路径——活人重算，尸体刷新尸体外观。
 *
 * 名单由调用方给，引擎不代选，也没有隐式的「跳过尸体」：点名一具尸体就真的会重推它。
 * 这里也不顺手做死亡收尾——hp 归零后的掉活与宣布属于 `deaths`，两个入口刻意分开，
 * 谁都不替对方多做一步。
 */
export async function advanceAppearance(
  db: Database,
  gameRef: string,
  input: AppearanceInput,
  services: LlmServices,
): Promise<{ results: AppearanceResult[] }> {
  // 一次快照判生死：外观任务不改 hp，名单里每一条看的是同一份状态。
  const state = await getGameState(db, gameRef);
  const options = { service: services.service };
  const results: AppearanceResult[] = [];
  for (const actorRef of new Set(input.actors)) {
    const target = findActorByName(state, actorRef).actor;
    const result = isAlive(target)
      ? await updateAppearance(db, gameRef, actorRef, options)
      : await refreshCorpseAppearance(db, gameRef, actorRef, options);
    results.push({ actor: actorRef, ...result });
  }
  return { results };
}

/** 对每个 hp 归零且未收尾的 actor 跑一次死亡阶段。 */
export async function settleDeaths(
  db: Database,
  gameRef: string,
  services: LlmServices,
): Promise<{ deaths: DeathSettlement[] }> {
  const state = await getGameState(db, gameRef);
  const deaths: DeathSettlement[] = [];
  for (const actor of await scanDeathsToSettle(db, state.game.id)) {
    deaths.push(await settleDeath(db, state.game.id, actor, { service: services.service }));
  }
  return { deaths };
}
