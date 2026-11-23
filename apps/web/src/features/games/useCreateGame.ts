import { unwrap } from "@ai-trpg/api-client";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { GameView } from "./useGameView";

export type CreateGameInput = {
  seed: string;
  /** 留空时服务端按内容包自动生成。 */
  slug?: string;
};

/** 建一局；服务端返回这一局的观看者投影，由调用页决定跳去哪里。 */
export function useCreateGame() {
  return useMutation({
    mutationFn: async (input: CreateGameInput): Promise<GameView> =>
      unwrap(
        await api.POST("/api/v1/games", {
          body: {
            seed: input.seed,
            ...(input.slug === undefined || input.slug === "" ? {} : { slug: input.slug }),
          },
        }),
      ).view,
  });
}
