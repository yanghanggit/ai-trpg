import { type components, unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

/** 契约里的节点自述；它就是「看的是哪台机器」这一层的形状。 */
export type NodeStatus = components["schemas"]["NodeStatus"];

/** 进程、数据库与轨迹目录：变化跟着进程走，所以一次取到就够，不轮询。 */
export function useNodeStatus() {
  return useQuery({
    queryKey: ["node", "status"],
    queryFn: async () => unwrap(await api.GET("/api/v1/status")),
    staleTime: 30_000,
  });
}
