import type { ChatCompletionService } from "../../../llm";
import type { MemoryOwnerQuery, MemoryOwnerType } from "../../memory";

/**
 * 探针目标：和记忆读取同一套门牌，所以 actor / stage / world 都能问。
 *
 * 三类目标的差别只在谁是它的 system prompt 与 memory——那是 memory 自己的事，
 * 这里不按类型分支。
 */
export type ProbeOptions = {
  service: ChatCompletionService;
  owner: MemoryOwnerQuery;
  message: string;
};

export type ProbeResult = {
  targetType: MemoryOwnerType;
  targetName: string;
  answer: string;
  finishReason: string;
};
