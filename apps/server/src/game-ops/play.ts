/**
 * 服务端可驱动的操作：建局、读状态、接管、玩家动作、回合推进。
 *
 * CLI 与 HTTP 共用这一层，只有参数形状与输出封装不同。这里刻意不含文件落盘
 * （快照 / 记忆导出 / 故事落盘），那是调试产物的入口，见 `game-ops/artifacts.ts`。
 */

import type { Database } from "../db/pool";
import {
  createGame,
  findActorByName,
  findActorByRef,
  getGameMeta,
  isAlive,
  latestMessageSequence,
  listGameMessages,
  listPlayerControlledActorIds,
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
  rebuildAppearance,
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
  ActorPlan,
  ActorTurnResult,
  DeathSettlement,
  GameState,
  GameStateSlice,
  MessageState,
  StageTurnResult,
  WorldTurnResult,
} from "../game/kernel/types";
import { listActorsForAppearance } from "../game/persistence/actors";
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
  death?: DeathSettlement[];
};

/** 玩家动作的统一输出：计划、结算后的活状态，死亡阶段有结果时一并带出。 */
export function playerActionOutput(result: ActorTurnResult): PlayerActionOutput {
  return {
    plan: result.plan,
    state: result.state,
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
 */
export async function submitPlayerAction(
  db: Database,
  gameRef: string,
  actorRef: string,
  action: PlayerActionRequest,
  services: TurnServices,
): Promise<PlayerActionOutput> {
  const result = await dispatchPlayerAction(db, gameRef, actorRef, action, services);
  return playerActionOutput(result);
}

async function dispatchPlayerAction(
  db: Database,
  gameRef: string,
  actorRef: string,
  action: PlayerActionRequest,
  services: TurnServices,
): Promise<ActorTurnResult> {
  switch (action.kind) {
    case "say":
      return playerSay(db, gameRef, actorRef, {
        message: action.message,
        targetActorRef: action.target,
        ...reasonOf(action),
      });
    case "whisper":
      return playerWhisper(db, gameRef, actorRef, {
        message: action.message,
        targetActorRef: action.target,
        ...reasonOf(action),
      });
    case "call":
      return playerCall(db, gameRef, actorRef, {
        message: action.message,
        targetActorName: action.target,
        ...reasonOf(action),
      });
    case "announce":
      return playerAnnounce(db, gameRef, actorRef, {
        message: action.message,
        ...reasonOf(action),
      });
    case "move":
      return playerMove(db, gameRef, actorRef, { targetStageRef: action.to });
    case "teleport":
      return playerTeleport(db, gameRef, actorRef, { targetStageRef: action.to });
    case "wait":
      return playerWait(db, gameRef, actorRef);
    case "hide":
      return playerHide(db, gameRef, actorRef);
    case "reveal":
      return playerReveal(db, gameRef, actorRef);
    case "strike":
      return playerStrike(
        db,
        gameRef,
        actorRef,
        { targetActorRef: action.target },
        { service: services.service, inferenceService: services.inferenceService },
      );
    case "brawl":
      return playerBrawl(
        db,
        gameRef,
        actorRef,
        { targetActorRef: action.target },
        { inferenceService: services.inferenceService },
      );
    case "steal":
      return playerSteal(db, gameRef, actorRef, {
        targetActorRef: action.target,
        itemName: action.item,
      });
    case "inspect":
      return playerInspect(db, gameRef, actorRef, { targetActorRef: action.target });
    case "loot":
      return playerLoot(db, gameRef, actorRef, {
        targetActorRef: action.target,
        ...(action.items === undefined ? {} : { itemNames: action.items }),
      });
    case "give":
      return playerGive(
        db,
        gameRef,
        actorRef,
        { targetActorRef: action.target, itemName: action.item },
        { inferenceService: services.inferenceService },
      );
    case "pickup":
      return playerPickup(db, gameRef, actorRef, {
        targetAnchor: action.anchor,
        itemName: action.item,
      });
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
        { service: services.service, inferenceService: services.inferenceService },
      );
    case "fit":
      return playerFit(
        db,
        gameRef,
        actorRef,
        { itemName: action.item, targetAnchor: action.anchor },
        { service: services.service, inferenceService: services.inferenceService },
      );
    case "equip":
      return playerEquip(
        db,
        gameRef,
        actorRef,
        { itemName: action.item, slot: action.slot },
        { inferenceService: services.inferenceService },
      );
    case "unequip":
      return playerUnequip(
        db,
        gameRef,
        actorRef,
        { slot: action.slot },
        { inferenceService: services.inferenceService },
      );
    case "recognize-identity":
      return playerRecognizeIdentity(db, gameRef, actorRef, {
        targetActorRef: action.target,
        name: action.name,
      });
    case "ask-route":
      return playerRecallRoute(db, gameRef, actorRef, {
        ...(action.from === undefined ? {} : { fromStageRef: action.from }),
        toStageRef: action.to,
      });
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

export type NpcAdvanceInput = { actor?: string; all?: boolean };

/** 推进模型决策的 actor 回合：点名一个，或按顺序遍历所有未被接管的活人。 */
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
  };
  if (!input.all && input.actor !== undefined) {
    return { results: [actorTurnOutput(await runActorTurn(db, gameRef, input.actor, options))] };
  }
  const state = await getGameState(db, gameRef);
  const controlled = new Set(await listPlayerControlledActorIds(db, state.game.id));
  const actors = state.world.stages
    .flatMap((stage) => stage.actors.filter(isAlive))
    .filter((actor) => !controlled.has(actor.id));
  const results: ActorTurnOutput[] = [];
  for (const actor of actors) {
    results.push(actorTurnOutput(await runActorTurn(db, gameRef, actor.name, options)));
  }
  return { results };
}

export type StageAdvanceInput = { stage?: string; all?: boolean };

/** 舞台回合：一次只推进一层，`all` 不级联到 world。 */
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
  if (!input.all && input.stage !== undefined) {
    return {
      results: [stageTurnOutput(await runStageTurn(db, gameRef, input.stage, options))],
    };
  }
  const state = await getGameState(db, gameRef);
  const results: StageTurnOutput[] = [];
  for (const stage of state.world.stages) {
    results.push(stageTurnOutput(await runStageTurn(db, gameRef, stage.id, options)));
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

export type AppearanceInput = { actor?: string; all?: boolean };

export type AppearanceRefreshResult = {
  /** 本次重推了外观的活人。 */
  refreshed: string[];
  /** 跳过的尸体：它们的外观由死亡阶段负责。 */
  skippedCorpses: string[];
};

/**
 * 批量重推外观：活人各推一次，尸体一律跳过。
 *
 * 与 `agent-game appearance --all` 同一份语义：跳过是刻意的，尸体外观属于死亡阶段。
 */
export async function refreshAppearances(
  db: Database,
  gameId: string,
  services: LlmServices,
): Promise<AppearanceRefreshResult> {
  const result: AppearanceRefreshResult = { refreshed: [], skippedCorpses: [] };
  for (const row of await listActorsForAppearance(db, gameId)) {
    if (row.hp <= 0) {
      result.skippedCorpses.push(row.name);
      continue;
    }
    const appearance = await rebuildAppearance(db, gameId, row.name, {
      service: services.service,
      ...(services.logger === undefined ? {} : { logger: services.logger }),
    });
    if (appearance.ok) {
      result.refreshed.push(row.name);
    } else {
      services.logger?.warn(`外观重推失败: ${row.name}`);
    }
  }
  return result;
}

export async function advanceAppearance(
  db: Database,
  gameRef: string,
  input: AppearanceInput,
  services: LlmServices,
): Promise<
  | (AppearanceRefreshResult & { deaths: DeathSettlement[] })
  | { ok: boolean; actor: string; appearance: unknown }
> {
  if (input.all || input.actor === undefined) {
    const state = await getGameState(db, gameRef);
    const refreshed = await refreshAppearances(db, state.game.id, services);
    const deaths: DeathSettlement[] = [];
    for (const actor of await scanDeathsToSettle(db, state.game.id)) {
      deaths.push(await settleDeath(db, state.game.id, actor, { service: services.service }));
    }
    return { ...refreshed, deaths };
  }
  const actorRef = input.actor;
  const state = await getGameState(db, gameRef);
  const target = findActorByName(state, actorRef).actor;
  const options = { service: services.service };
  const result = isAlive(target)
    ? await updateAppearance(db, gameRef, actorRef, options)
    : await refreshCorpseAppearance(db, gameRef, actorRef, options);
  return { ok: result.ok, actor: actorRef, appearance: result.appearance };
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
