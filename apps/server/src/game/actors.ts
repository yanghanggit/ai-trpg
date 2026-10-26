import { buildEdgeIndex, openNeighborIds, sealedNeighborIds } from "./edges";
import { GameError } from "./errors";
import type { ActorState, GameState, StageState } from "./types";

export type ActorWithStage = {
  actor: ActorState;
  stage: StageState;
};

/** 返回世界中所有 actor 及其所在场景。 */
export function allActors(state: GameState): ActorWithStage[] {
  return state.world.stages.flatMap((stage) => stage.actors.map((actor) => ({ actor, stage })));
}

/** 按 id 或唯一名称查找 actor；名称重复时要求调用方改用 id。 */
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

/** 按 id 或唯一名称查找 actor。 */
export function findActor(state: GameState, ref: string): ActorState {
  return findActorWithStage(state, ref).actor;
}

/** 返回指定场景中除 actorId 之外的角色。 */
export function otherActorsInStage(stage: StageState, actorId: string): ActorState[] {
  return stage.actors.filter((actor) => actor.id !== actorId);
}

/** 返回从指定场景可直接到达的场景；只走已通行的边。 */
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

/** 返回与本场景相连、但仍未开启的场景名。 */
export function sealedStageNames(state: GameState, stageId: string): string[] {
  const byId = new Map(state.world.stages.map((stage) => [stage.id, stage]));
  const edges = buildEdgeIndex(state.world.connections);
  return sealedNeighborIds(edges, stageId).flatMap((id) => {
    const stage = byId.get(id);
    return stage ? [stage.name] : [];
  });
}

/** 按 id 或唯一名称查找场景。 */
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

/** 按名称查找场景；不存在时返回 undefined。 */
export function findStageByName(state: GameState, name: string): StageState | undefined {
  return state.world.stages.find((stage) => stage.name === name);
}
