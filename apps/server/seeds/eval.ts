import type { RagEvalSet } from "../src/rag/types";
import { BELL_MONASTERY_EVAL } from "./dark-fantasy/bell-monastery.eval";
import type { CONTENT_PACKS } from "./index";

/**
 * 检索评测集的显式注册表，key 与 `CONTENT_PACKS` 共用同一套剧本名。
 *
 * 评测数据跟着剧本文件走（`<剧本>.eval.ts`），不是写死在脚本里：新增剧本时在这里加一条，
 * 或在剧本目录里补上自己的 eval 文件后注册，`pnpm rag:eval` 默认遍历全部条目。
 * `Partial` 允许剧本先不写评测，但 `--check` 会把“注册了剧本却没有评测集”判为失败。
 */
export const RAG_EVAL_SETS = {
  "dark-fantasy": BELL_MONASTERY_EVAL,
} as const satisfies Partial<Record<keyof typeof CONTENT_PACKS, RagEvalSet>>;
