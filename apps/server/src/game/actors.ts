import { buildEdgeIndex, openNeighborIds, sealedNeighborIds } from "./edges";
import { GameError } from "./errors";
import type { ActorState, GameState, StageState } from "./types";

export type ActorWithStage = {
  actor: ActorState;
  stage: StageState;
};

export function allActors(state: GameState): ActorWithStage[] {
  return state.world.stages.flatMap((stage) => stage.actors.map((actor) => ({ actor, stage })));
}

/** 名称重复时直接拒绝，避免按名字定位到错误的角色。 */
export function findActorWithStage(state: GameState, ref: string): ActorWithStage {
  const matches = allActors(state).filter(({ actor }) => actor.id === ref || actor.name === ref);
  if (matches.length === 0) {
    throw new GameError("not_found", `actor 不存在: ${ref}`);
  }
  if (matches.length > 1) {
    throw new GameError("invalid_action", `actor 名称不唯一，请使用 id: ${ref}`);
  }
  return matches[0] as ActorWithStage;
}

export function findActor(state: GameState, ref: string): ActorState {
  return findActorWithStage(state, ref).actor;
}

export function otherActorsInStage(stage: StageState, actorId: string): ActorState[] {
  return stage.actors.filter((actor) => actor.id !== actorId);
}

/** 只走已通行的边。 */
export function adjacentStages(state: GameState, stageId: string): StageState[] {
  const byId = new Map(state.world.stages.map((stage) => [stage.id, stage]));
  const edges = buildEdgeIndex(state.world.connections);
  return openNeighborIds(edges, stageId)
    .map((id) => byId.get(id))
    .filter((stage): stage is StageState => stage !== undefined);
}

/** 返回从指定场景可直接到达的场景名。 */
export function adjacentStageNames(state: GameState, stageId: string): string[] {
  return adjacentStages(state, stageId).map((stage) => stage.name);
}

/** 剧情上相连、但当前不可通过的场景；供 stage 小 GM 判断能否 open_passage。 */
export function sealedStageNames(state: GameState, stageId: string): string[] {
  const byId = new Map(state.world.stages.map((stage) => [stage.id, stage]));
  const edges = buildEdgeIndex(state.world.connections);
  return sealedNeighborIds(edges, stageId).flatMap((id) => {
    const stage = byId.get(id);
    return stage ? [stage.name] : [];
  });
}

export function findStage(state: GameState, ref: string): StageState {
  const matches = state.world.stages.filter((stage) => stage.id === ref || stage.name === ref);
  if (matches.length === 0) {
    throw new GameError("not_found", `场景不存在: ${ref}`);
  }
  if (matches.length > 1) {
    throw new GameError("invalid_action", `场景名称不唯一，请使用 id: ${ref}`);
  }
  return matches[0] as StageState;
}

export function findStageByName(state: GameState, name: string): StageState | undefined {
  return state.world.stages.find((stage) => stage.name === name);
}
