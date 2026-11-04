import type { ActorState, GameStateSlice, StageState } from "./types";

/**
 * 每份状态快照的「actor → 到访场景」索引。
 *
 * 用 WeakMap 挂在 state 对象上：索引随快照一起被回收，不需要任何失效逻辑，也不可能读到
 * 上一份快照的旧数据。不放进 `GameState`，是因为 `Map` 不可 JSON 序列化，而快照与 CLI
 * 输出都直接把 state 落盘。
 */
const visitIndexCache = new WeakMap<GameStateSlice, Map<string, Set<string>>>();

/** 空集合共享给没有到访记录的 actor；调用方只读。 */
const EMPTY_VISITED: ReadonlySet<string> = new Set<string>();

function visitIndex(state: GameStateSlice): Map<string, Set<string>> {
  const cached = visitIndexCache.get(state);
  if (cached) {
    return cached;
  }
  const index = new Map<string, Set<string>>();
  for (const visit of state.visits) {
    const stages = index.get(visit.actorId);
    if (stages) {
      stages.add(visit.stageId);
    } else {
      index.set(visit.actorId, new Set([visit.stageId]));
    }
  }
  visitIndexCache.set(state, index);
  return index;
}

/** 这个 actor 去过的场景 id；用于已访问候选、地图与 `get_visited_stages`，不参与普通移动权限。 */
export function visitedStageIds(state: GameStateSlice, actorId: string): ReadonlySet<string> {
  return visitIndex(state).get(actorId) ?? EMPTY_VISITED;
}

/**
 * 已去过、未被禁传的候选场景，只用于提示与地图，不是传送权限。
 *
 * teleport 的规则是「知道目标真名」，不要求去过；这个列表只是已知场景的一部分。
 */
export function visitedTeleportTargetsFor(
  state: GameStateSlice,
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
