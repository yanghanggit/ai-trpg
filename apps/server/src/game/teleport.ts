import type { ActorState, GameStateSlice, StageState } from "./types";

type StageIdIndex = Map<string, Set<string>>;

/** 每份快照的两份索引：到访过、以及已知（到访 ∪ 只听过名字）。 */
type StageIndex = {
  visited: StageIdIndex;
  known: StageIdIndex;
};

/**
 * 每份状态快照的「actor → 场景」索引。
 *
 * 用 WeakMap 挂在 state 对象上：索引随快照一起被回收，不需要任何失效逻辑，也不可能读到
 * 上一份快照的旧数据。不放进 `GameState`，是因为 `Map` 不可 JSON 序列化，而快照与 CLI
 * 输出都直接把 state 落盘。
 */
const stageIndexCache = new WeakMap<GameStateSlice, StageIndex>();

/** 空集合共享给没有任何记录的 actor；调用方只读。 */
const EMPTY_STAGES: ReadonlySet<string> = new Set<string>();

function addTo(index: StageIdIndex, actorId: string, stageId: string): void {
  const stages = index.get(actorId);
  if (stages) {
    stages.add(stageId);
  } else {
    index.set(actorId, new Set([stageId]));
  }
}

function stageIndex(state: GameStateSlice): StageIndex {
  const cached = stageIndexCache.get(state);
  if (cached) {
    return cached;
  }
  const index: StageIndex = { visited: new Map(), known: new Map() };
  for (const visit of state.visits) {
    addTo(index.visited, visit.actorId, visit.stageId);
    addTo(index.known, visit.actorId, visit.stageId);
  }
  // 场景名可以在到访之前就知道（先听说、后走到），两边都要进 known。
  for (const record of state.knownStages) {
    addTo(index.known, record.actorId, record.stageId);
  }
  stageIndexCache.set(state, index);
  return index;
}

/** 这个 actor 去过的场景 id；用于已访问候选、地图与查看，不参与普通移动权限。 */
export function visitedStageIds(state: GameStateSlice, actorId: string): ReadonlySet<string> {
  return stageIndex(state).visited.get(actorId) ?? EMPTY_STAGES;
}

/**
 * 这个 actor 知道真名的场景 id：去过的 ∪ 只听过名字的。
 *
 * 用于地图、方向名显示与提示词；传送规则本身仍然是「知道真名」，但这个集合不扩传送候选。
 */
export function knownStageIds(state: GameStateSlice, actorId: string): ReadonlySet<string> {
  return stageIndex(state).known.get(actorId) ?? EMPTY_STAGES;
}

/**
 * actor 已知的场景，按「去过 / 只知名」分段，段内沿用状态里的顺序。
 *
 * 到访过的场景即使也有知识行，也只出现在 `visited` 里；地图、提示词与 viewer 共用这一份规则。
 */
export function knownStagesForActor(
  state: GameStateSlice,
  actorId: string,
): { visited: StageState[]; learned: StageState[] } {
  const byId = new Map(state.world.stages.map((stage) => [stage.id, stage]));
  const visited = state.visits
    .filter((visit) => visit.actorId === actorId)
    .flatMap((visit) => {
      const stage = byId.get(visit.stageId);
      return stage ? [stage] : [];
    });
  const visitedIds = new Set(visited.map((stage) => stage.id));
  const learned = state.knownStages
    .filter((record) => record.actorId === actorId && !visitedIds.has(record.stageId))
    .flatMap((record) => {
      const stage = byId.get(record.stageId);
      return stage ? [stage] : [];
    });
  return { visited, learned };
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
