import { unwrap } from "@ai-trpg/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { JobView, MemoryOwner } from "./useGameData";

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
  const queryClient = useQueryClient();

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["games", slug] });
    await queryClient.invalidateQueries({ queryKey: ["traces"] });
  }

  async function advance(input: AdvanceInput): Promise<JobView> {
    const path = { game: slug };
    const body =
      input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion };

    const job =
      input.kind === "npc"
        ? unwrap(
            await api.POST("/api/v1/games/{game}/turns/npc", {
              params: { path },
              body: { actor: input.target ?? "", ...body },
            }),
          ).job
        : input.kind === "stage"
          ? unwrap(
              await api.POST("/api/v1/games/{game}/turns/stage", {
                params: { path },
                body: { stage: input.target ?? "", ...body },
              }),
            ).job
          : unwrap(await api.POST("/api/v1/games/{game}/turns/world", { params: { path }, body }))
              .job;

    await refresh();
    return job;
  }

  async function pass(actors: string[]): Promise<void> {
    unwrap(
      await api.POST("/api/v1/games/{game}/turns/pass", {
        params: { path: { game: slug } },
        body: { actors },
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

  async function deleteGame(): Promise<void> {
    unwrap(await api.DELETE("/api/v1/games/{game}", { params: { path: { game: slug } } }));
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
    actor?: string;
    stage?: string;
  }): Promise<unknown> {
    return unwrap(
      await api.POST("/api/v1/games/{game}/probe", {
        params: { path: { game: slug } },
        body: {
          message: input.message,
          ...(input.actor === undefined || input.actor.length === 0 ? {} : { actor: input.actor }),
          ...(input.stage === undefined || input.stage.length === 0 ? {} : { stage: input.stage }),
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
    pass,
    endGame,
    deleteGame,
    compact,
    probe,
    snapshot,
    story,
    refresh,
  };
}
