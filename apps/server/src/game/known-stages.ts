import type { Database } from "../db/pool";
import { findActorByRef, requireStageName, stageOfActor } from "./actors";
import { applyActorPlan } from "./apply";
import { GameError } from "./errors";
import { getGameStateSlice } from "./read/game-state";
import { knownStageIds } from "./teleport";
import type { ActorState, GameStateSlice, StageState } from "./types";

export type LearnedStage = {
  actorId: string;
  actorName: string;
  stageId: string;
  stageName: string;
  /** 之前就知道（到访或已记录）时为 false，此时不写库也不 bump 版本。 */
  created: boolean;
  /** 写入后的游戏版本号；没有写入时是原版本。 */
  version: number;
};

/**
 * 场景知识的授予：认一个场景真名，写 `known_stages` 并留一条「编号 → 名字」的认知。
 *
 * 只接受真名：望远镜、地图这类玩法给的就是名字，`#序号` 不是知识也不该被授予。
 * 当前场景名始终可见，不需要记录，所以直接拒绝，避免知识表里堆无意义行。
 *
 * 写入走计划通道（`ActorPlan.learnedStages`），和记名字、回忆路线同一个事务：
 * 授予与这次落账同生共死，版本由计划 bump 一次。这里只是不要求玩家接管的入口，
 * 供开发期 CLI 与测试使用；回合内的望远镜应当把场景 id 放进计划，不要另开事务。
 */
export async function learnStageName(
  db: Database,
  gameRef: string,
  actorRef: string,
  stageRef: string,
): Promise<LearnedStage> {
  const state = await getGameStateSlice(db, gameRef);
  const actor = findActorByRef(state, actorRef);
  const stage = resolveLearnableStage(state, actor, stageRef);
  const result = {
    actorId: actor.id,
    actorName: actor.name,
    stageId: stage.id,
    stageName: stage.name,
  };
  if (knownStageIds(state, actor.id).has(stage.id)) {
    return { ...result, created: false, version: state.game.version };
  }
  const turn = await applyActorPlan(
    db,
    state.game.id,
    actor.id,
    { actions: [], learnedStages: [stage.id] },
    true,
  );
  if (!turn.ok) {
    throw new GameError("invalid_action", turn.rejection ?? "授予被拒绝");
  }
  const after = await getGameStateSlice(db, gameRef);
  return { ...result, created: true, version: after.game.version };
}

/**
 * 把引用解析成「可以授予的场景」：必须是真名、不能是当前场景。
 *
 * 授予入口与玩家命令共用这一份判断，免得两处各写一遍允许什么。
 */
export function resolveLearnableStage(
  state: GameStateSlice,
  actor: ActorState,
  ref: string,
): StageState {
  const stage = requireStageName(state, ref);
  const { stage: current } = stageOfActor(state, actor.id);
  if (current.id === stage.id) {
    throw new GameError("invalid_action", `当前场景名始终可见，不需要记录: ${stage.name}`);
  }
  return stage;
}
