import type { ActorState, GameState, StageState } from "./types";

/** 这个 actor 去过的场景 id；只用于传送与地图，不参与普通移动权限。 */
export function visitedStageIds(state: GameState, actorId: string): Set<string> {
  return new Set(
    state.visits.filter((visit) => visit.actorId === actorId).map((visit) => visit.stageId),
  );
}

/**
 * actor 当前可传送的目标。
 *
 * 条件是「去过 + 目标未被 teleport_blocked + 自己不在被禁传的场景」。
 * 没有边或路径概念：teleport 一次直接跳到一个已访问节点。
 */
export function teleportTargetsFor(
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
