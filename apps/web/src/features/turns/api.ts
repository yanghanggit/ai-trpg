import type { TurnRequest } from "@ai-trpg/api-client";
import { unwrap } from "@ai-trpg/api-client";
import { api } from "../../api/client";
import type { TurnJob } from "./turnJob";

export type {
  PlayerAction,
  TurnRequest,
} from "@ai-trpg/api-client";

function versionOf(expectedVersion: number | undefined): { expectedVersion?: number } {
  return expectedVersion === undefined ? {} : { expectedVersion };
}

/**
 * 入队一个回合；返回作业本身，执行在服务端之外。
 *
 * 入队成功不代表回合发生过——结果只认作业终态，所以这里只回作业，不回世界状态。
 */
export async function enqueueTurn(game: string, request: TurnRequest): Promise<TurnJob> {
  switch (request.kind) {
    case "npc":
      return unwrap(
        await api.POST("/api/v1/games/{game}/turns/npc", {
          params: { path: { game } },
          body: { actor: request.actor, ...versionOf(request.expectedVersion) },
        }),
      ).job;
    case "player":
      return unwrap(
        await api.POST("/api/v1/games/{game}/actors/{actor}/actions", {
          params: { path: { game, actor: request.actor } },
          body: { action: request.action, ...versionOf(request.expectedVersion) },
        }),
      ).job;
    case "stage":
      return unwrap(
        await api.POST("/api/v1/games/{game}/turns/stage", {
          params: { path: { game } },
          body: { stage: request.stage, ...versionOf(request.expectedVersion) },
        }),
      ).job;
    case "world":
      return unwrap(
        await api.POST("/api/v1/games/{game}/turns/world", {
          params: { path: { game } },
          body: versionOf(request.expectedVersion),
        }),
      ).job;
  }
}

/** 读一条作业；轮询用的就是它。 */
export async function fetchTurnJob(game: string, jobId: string): Promise<TurnJob> {
  return unwrap(
    await api.GET("/api/v1/games/{game}/jobs/{job}", {
      params: { path: { game, job: jobId } },
    }),
  ).job;
}

/** 这一局的活跃作业：重载后靠它接上「正在跑的那一个」。 */
export async function fetchActiveTurnJobs(game: string): Promise<TurnJob[]> {
  return unwrap(
    await api.GET("/api/v1/games/{game}/jobs", {
      params: { path: { game }, query: { status: "active" } },
    }),
  ).jobs;
}

/**
 * 空回合：这一回合过去了，但没有动作落账，计数照加。
 *
 * 玩家席位待机时用它跳过自己的回合——否则那个人会一直卡在队首。它不跑模型，
 * 所以是同步调用，不产生作业。
 */
export async function passTurn(game: string, actors: readonly string[]): Promise<void> {
  unwrap(
    await api.POST("/api/v1/games/{game}/turns/pass", {
      params: { path: { game } },
      body: { actors: [...actors] },
    }),
  );
}
