import { type StageRoster, unwrap, waitForTurnJob } from "@ai-trpg/api-client";
import { api } from "../../api/client";
import { enqueueTurn, fetchTurnJob, type TurnRequest } from "./api";

/**
 * 玩家端的编排端口：编排规则在 `@ai-trpg/api-client`，这里只注入这一局的三个读法。
 *
 * 规则与后台共用同一份（`advanceOnce`），端上只负责「怎么读、怎么跑」。
 */
export type { AdvancePort, AdvanceResult } from "@ai-trpg/api-client";
export { advanceOnce, roundComplete, stageOfActor } from "@ai-trpg/api-client";

async function readStageMap(game: string): Promise<StageRoster[]> {
  return unwrap(await api.GET("/api/v1/games/{game}/stage-map", { params: { path: { game } } }))
    .stages;
}

/** 入队一个回合并等到终态；失败按作业留下的错误码抛出。 */
export async function runTurnAndWait(
  game: string,
  request: TurnRequest,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<Awaited<ReturnType<typeof waitForTurnJob>>> {
  const job = await enqueueTurn(game, request);
  return waitForTurnJob(job, (jobId) => fetchTurnJob(game, jobId), options);
}

/** 把 `game` 注进上面的三个读法，得到一次编排真正用的端口。 */
export function createAdvancePort(game: string) {
  return {
    readOrder: async () =>
      unwrap(
        await api.GET("/api/v1/games/{game}/action-orders/current", {
          params: { path: { game } },
        }),
      ).order,
    readStageMap: () => readStageMap(game),
    runTurn: (request: TurnRequest) => runTurnAndWait(game, request),
  };
}
