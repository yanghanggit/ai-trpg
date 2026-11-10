import { listConnectionsOfWorld } from "../persistence/edges";
import type { Executor } from "../persistence/rows";
import { listStagesOfWorld } from "../persistence/stages";
import { listVisitedStageIds } from "../persistence/visits";
import { routeWorldOf } from "./build";
import type { RouteWorld } from "./types";

/**
 * 结算事务里的窄读：只取路线需要的最小列，不装配整份状态。
 *
 * 读原语在 `persistence/`，装配规则与状态入口（`routeWorldFromState`）共用 `routeWorldOf`。
 * 同一个事务 executor 上不能并发查询，所以三个读按顺序来。
 */
export async function loadRouteWorld(
  executor: Executor,
  input: { gameId: string; worldId: string; actorId: string; currentStageId: string },
): Promise<RouteWorld> {
  const stages = await listStagesOfWorld(executor, input.worldId);
  const connections = await listConnectionsOfWorld(executor, input.worldId);
  const visited = await listVisitedStageIds(executor, input.gameId, input.actorId);
  return routeWorldOf({
    stages,
    connections,
    visitedStageIds: visited,
    currentStageId: input.currentStageId,
  });
}
