import { type paths, unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

/** 目录清单的响应形状直接取自契约，不在客户端另立一份。 */
export type TraceFilesResponse =
  paths["/api/v1/traces/files"]["get"]["responses"][200]["content"]["application/json"];

export type TraceGameEntry = TraceFilesResponse["games"][number];

/**
 * `logs/trace` 的目录清单。
 *
 * 只读元数据（文件名、大小、mtime），不读正文：阅览器先让人看到「有什么」，再按需读回合。
 */
export function useTraceFiles() {
  return useQuery({
    queryKey: ["traces", "files"],
    queryFn: async () => unwrap(await api.GET("/api/v1/traces/files")),
  });
}
