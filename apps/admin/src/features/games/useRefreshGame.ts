import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/** 重读这一局的读数：库里那份与磁盘上那份一起失效，页面只调一次。 */
export function useRefreshGame(slug: string) {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["games", slug] });
    await queryClient.invalidateQueries({ queryKey: ["traces"] });
  }, [queryClient, slug]);
}
