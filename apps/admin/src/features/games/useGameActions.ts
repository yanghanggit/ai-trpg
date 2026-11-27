import {
  type ActionOrder,
  type components,
  type TurnJob,
  type TurnRequest,
  unwrap,
  waitForTurnJob,
} from "@ai-trpg/api-client";
import { api } from "../../api/client";
import { enqueueTurn, fetchTurnJob } from "./advance";
import type { MemoryOwner } from "./useGameData";
import { useRefreshGame } from "./useRefreshGame";

/** 后台能推的三层回合；world 与另外两层一样是入队，不在请求里同步跑。 */
export type AdvanceKind = "npc" | "stage" | "world";

export type AdvanceInput = {
  kind: AdvanceKind;
  /** npc 要 actor 名，stage 要 stageId 或 stageName，world 不用。 */
  target?: string;
  /** 读到的那份视图的版本；给了就由服务端在执行开始时比对。 */
  expectedVersion?: number;
};

/**
 * 控制面写操作集合。
 *
 * 每一条都只发一个请求、只返回服务端的原始答复；「算不算成功」由调用方重读作业终态判断，
 * 这里的返回值不代表回合已经落地。
 */
export function useGameActions(slug: string) {
  const refresh = useRefreshGame(slug);

  /** 入队一个回合并等到终态；失败按作业留下的错误码抛出。 */
  async function advance(input: AdvanceInput): Promise<TurnJob> {
    const request: TurnRequest =
      input.kind === "npc"
        ? {
            kind: "npc",
            actor: input.target ?? "",
            ...(input.expectedVersion === undefined
              ? {}
              : { expectedVersion: input.expectedVersion }),
          }
        : input.kind === "stage"
          ? {
              kind: "stage",
              stage: input.target ?? "",
              ...(input.expectedVersion === undefined
                ? {}
                : { expectedVersion: input.expectedVersion }),
            }
          : {
              kind: "world",
              ...(input.expectedVersion === undefined
                ? {}
                : { expectedVersion: input.expectedVersion }),
            };
    const job = await enqueueTurn(slug, request);
    const done = await waitForTurnJob(job, (jobId) => fetchTurnJob(slug, jobId));
    await refresh();
    return done;
  }

  /** 开一条顺位：先后由服务端按敏捷现值排。 */
  async function openOrder(): Promise<ActionOrder> {
    const order = unwrap(
      await api.POST("/api/v1/games/{game}/action-orders", { params: { path: { game: slug } } }),
    ).order;
    await refresh();
    return order;
  }

  /** 收工：这条顺位不再挡下一条。 */
  async function completeOrder(orderId: string): Promise<void> {
    unwrap(
      await api.POST("/api/v1/games/{game}/action-orders/{order}/complete", {
        params: { path: { game: slug, order: orderId } },
      }),
    );
    await refresh();
  }

  async function endGame(input: { outcome: string; message?: string }): Promise<void> {
    unwrap(
      await api.POST("/api/v1/games/{game}/end", {
        params: { path: { game: slug } },
        body: {
          outcome: input.outcome,
          ...(input.message === undefined || input.message.length === 0
            ? {}
            : { message: input.message }),
        },
      }),
    );
    await refresh();
  }

  async function compact(input: { owner: MemoryOwner | "all"; name?: string }): Promise<unknown> {
    const payload = unwrap(
      await api.POST("/api/v1/games/{game}/compact", {
        params: { path: { game: slug } },
        body: {
          owner: input.owner,
          ...(input.name === undefined || input.name.length === 0 ? {} : { name: input.name }),
        },
      }),
    );
    await refresh();
    return payload;
  }

  async function probe(input: {
    message: string;
    /** 与记忆读取同一套门牌：问谁就是读谁。 */
    owner: MemoryOwner;
    name?: string;
  }): Promise<components["schemas"]["GameProbe"]> {
    return unwrap(
      await api.POST("/api/v1/games/{game}/probe", {
        params: { path: { game: slug } },
        body: {
          owner: input.owner,
          ...(input.name === undefined || input.name.length === 0 ? {} : { name: input.name }),
          message: input.message,
        },
      }),
    );
  }

  async function snapshot(): Promise<unknown> {
    return unwrap(
      await api.POST("/api/v1/games/{game}/snapshot", {
        params: { path: { game: slug } },
        body: {},
      }),
    );
  }

  async function story(): Promise<unknown> {
    return unwrap(
      await api.POST("/api/v1/games/{game}/story", { params: { path: { game: slug } } }),
    );
  }

  return {
    advance,
    openOrder,
    completeOrder,
    endGame,
    compact,
    probe,
    snapshot,
    story,
    refresh,
  };
}
