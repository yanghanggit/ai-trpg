import {
  type ActionOrder,
  type ActionOrderRound,
  type AdvancePort,
  type TurnJob,
  type TurnRequest,
  unwrap,
  waitForTurnJob,
} from "@ai-trpg/api-client";
import { api } from "../../api/client";

/**
 * 后台的编排端口：规则来自 `@ai-trpg/api-client`（与玩家端同一份），这里只注入做法。
 *
 * 三件事各一条请求：读顺位、读舞台名单、跑一个回合。跑一个回合是「入队 + 轮询到终态」，
 * 因为后台要看的是结果，不是入队回执。
 */

const path = (slug: string) => ({ game: slug });

function versionOf(expectedVersion: number | undefined): { expectedVersion?: number } {
  return expectedVersion === undefined ? {} : { expectedVersion };
}

/** 入队一个回合；返回作业本身，不保证回合已发生。 */
export async function enqueueTurn(slug: string, request: TurnRequest): Promise<TurnJob> {
  switch (request.kind) {
    case "npc":
      return unwrap(
        await api.POST("/api/v1/games/{game}/turns/npc", {
          params: { path: path(slug) },
          body: { actor: request.actor, ...versionOf(request.expectedVersion) },
        }),
      ).job;
    case "player":
      return unwrap(
        await api.POST("/api/v1/games/{game}/actors/{actor}/actions", {
          params: { path: { game: slug, actor: request.actor } },
          body: { action: request.action, ...versionOf(request.expectedVersion) },
        }),
      ).job;
    case "stage":
      return unwrap(
        await api.POST("/api/v1/games/{game}/turns/stage", {
          params: { path: path(slug) },
          body: { stage: request.stage, ...versionOf(request.expectedVersion) },
        }),
      ).job;
    case "world":
      return unwrap(
        await api.POST("/api/v1/games/{game}/turns/world", {
          params: { path: path(slug) },
          body: versionOf(request.expectedVersion),
        }),
      ).job;
  }
}

/** 读一条作业；轮询用的就是它。 */
export async function fetchTurnJob(slug: string, jobId: string): Promise<TurnJob> {
  return unwrap(
    await api.GET("/api/v1/games/{game}/jobs/{job}", {
      params: { path: { game: slug, job: jobId } },
    }),
  ).job;
}

/** 顺位与行动轮一起读：一个回答「该谁了」，一个回答「这一轮推到哪了」。 */
export async function fetchTurnState(
  slug: string,
): Promise<{ order: ActionOrder | null; round: ActionOrderRound | null }> {
  const payload = unwrap(
    await api.GET("/api/v1/games/{game}/action-orders/current", {
      params: { path: path(slug) },
    }),
  );
  return { order: payload.order, round: payload.round };
}

/** 读当前进行中的顺位；只关心「该谁了」的地方用它。 */
export async function fetchOrder(slug: string): Promise<ActionOrder | null> {
  return (await fetchTurnState(slug)).order;
}

/** 舞台名单：名字 → 谁在这个舞台上。舞台回合的目标由它决定。 */
export async function fetchStageMap(slug: string): Promise<Record<string, string[]>> {
  return unwrap(await api.GET("/api/v1/games/{game}/stage-map", { params: { path: path(slug) } }))
    .stages;
}

/** 一个回合在日志里叫什么：三层各一句，不写接口名。 */
export function labelOf(request: TurnRequest): string {
  switch (request.kind) {
    case "npc":
      return `NPC 回合 · ${request.actor}`;
    case "player":
      return `玩家动作 · ${request.actor}`;
    case "stage":
      return `舞台回合 · ${request.stage}`;
    case "world":
      return "world 回合";
  }
}

/**
 * 建一个编排端口。
 *
 * `runTurn` 可以替换：容器传进来的那一版会顺手把每一步记进日志，编排规则本身不关心日志。
 */
export function createAdvancePort(
  slug: string,
  runTurn?: (request: TurnRequest) => Promise<TurnJob>,
): AdvancePort {
  return {
    readOrder: () => fetchOrder(slug),
    readStageMap: () => fetchStageMap(slug),
    runTurn:
      runTurn ??
      (async (request) => {
        const job = await enqueueTurn(slug, request);
        return waitForTurnJob(job, (jobId) => fetchTurnJob(slug, jobId));
      }),
  };
}
