import type { ActorState, GameStateSlice, StageState } from "../kernel/types";
import { sealedStages } from "../stage-state";
import type { ActorWithStage } from "./locate";

type StageIdIndex = Map<string, Set<string>>;

/**
 * 到访的状态层视图：谁去过哪些舞台，以及由此派生出的舞台认知。
 *
 * 与行级读写（`persistence/visits.ts`）分开：这里只读已装载的 `state.visits`，不碰数据库。
 * 它跟 `locate.ts` 同属 actor 的状态层：那边认人，这边认「这个人认得哪些地方」。
 * 到访记录是舞台认知的唯一来源——名字、地图、传送候选提示都从这里取；但它不是通行证，
 * 各自的权限规则留在各自的行动里（`move` 看邻接边，`teleport` 只看真名能否对应到舞台）。
 */

/**
 * 每份状态快照的「actor → 去过哪些舞台」索引。
 *
 * 用 WeakMap 挂在 state 对象上：索引随快照一起被回收，不需要任何失效逻辑，也不可能读到
 * 上一份快照的旧数据。不放进 `GameState`，是因为 `Map` 不可 JSON 序列化，而快照与 CLI
 * 输出都直接把 state 落盘。
 */
const visitedIndexCache = new WeakMap<GameStateSlice, StageIdIndex>();

/** 空集合共享给没有任何记录的 actor；调用方只读。 */
const EMPTY_STAGES: ReadonlySet<string> = new Set<string>();

function visitedIndex(state: GameStateSlice): StageIdIndex {
  const cached = visitedIndexCache.get(state);
  if (cached) {
    return cached;
  }
  const index: StageIdIndex = new Map();
  for (const visit of state.visits) {
    const stages = index.get(visit.actorId);
    if (stages) {
      stages.add(visit.stageId);
    } else {
      index.set(visit.actorId, new Set([visit.stageId]));
    }
  }
  visitedIndexCache.set(state, index);
  return index;
}

/**
 * 这个 actor 去过的舞台 id。
 *
 * 到访是舞台认知的唯一来源：名字、地图与传送候选提示都从这里取；没走过的地方对 actor
 * 而言只有 `#序号`。它不是通行证——`move` 的权限在邻接边，`teleport` 只要求真名能对应到舞台。
 */
export function visitedStageIds(state: GameStateSlice, actorId: string): ReadonlySet<string> {
  return visitedIndex(state).get(actorId) ?? EMPTY_STAGES;
}

/** actor 去过的舞台，顺序沿用 `state.visits`（并列时已按舞台序号兜底）。 */
export function visitedStagesForActor(state: GameStateSlice, actorId: string): StageState[] {
  const byId = new Map(state.world.stages.map((stage) => [stage.id, stage]));
  return state.visits
    .filter((visit) => visit.actorId === actorId)
    .flatMap((visit) => {
      const stage = byId.get(visit.stageId);
      return stage ? [stage] : [];
    });
}

/**
 * 封着、但自己去过的出口：记忆里的一道门。
 *
 * 到访是记忆，不是通行证：去过的地方即使现在过不去，也认得出它在哪儿；没走过的门
 * 连名字都不知道，自然也无从记得。
 *
 * 名字从 `visitedStageIds` 推，封没封从地形推：这是「舞台认知」跨到地形上的一次组合，
 * 所以落在认知这一层，而不是 `stage-state`。
 */
export function sealedVisitedStagesForActor(
  state: GameStateSlice,
  current: ActorWithStage,
): StageState[] {
  const visited = visitedStageIds(state, current.actor.id);
  return sealedStages(state, current.stage.id).filter((stage) => visited.has(stage.id));
}

/**
 * 已去过、未被禁传的候选舞台，只用于提示与地图，不是传送权限。
 *
 * teleport 的规则是「真名能对应到一个舞台」，不要求去过；这个列表只是提示里可省事
 * 抄的近处目标，写别的真名同样成立。
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
