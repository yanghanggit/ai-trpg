import type { ActorState, GameState, StageState } from "./types";

/** 这个 actor 去过的场景 id；用于已访问候选、地图与 `get_visited_stages`，不参与普通移动权限。 */
export function visitedStageIds(state: GameState, actorId: string): Set<string> {
  return new Set(
    state.visits.filter((visit) => visit.actorId === actorId).map((visit) => visit.stageId),
  );
}

/**
 * 已去过、未被禁传的候选场景，只用于提示与地图，不是传送权限。
 *
 * teleport 的规则是「知道目标真名」，不要求去过；这个列表只是已知场景的一部分。
 */
export function visitedTeleportTargetsFor(
  state: GameState,
  actor: ActorState,
  stage: StageState | undefined,
): StageState[] {
  if (!actor.actions.includes("teleport")) {
    return [];
  }
  const current =
    stage ??
    state.world.stages.find((candidate) => candidate.actors.some((entry) => entry.id === actor.id));
  if (!current || current.teleportBlocked) {
    return [];
  }
  const visited = visitedStageIds(state, actor.id);
  return state.world.stages.filter(
    (candidate) =>
      candidate.id !== current.id && !candidate.teleportBlocked && visited.has(candidate.id),
  );
}
