import type { ChatCompletionService } from "../../llm";
import type { MemoryOwnerType } from "../memory";

/**
 * 手动 compact 的输入与结果形状。
 *
 * `minRatio` 是「够不够大才值得压」的门槛：省略表示总是压缩，显式给值则低于阈值直接跳过
 * 并回报原因，调用方不必自己比对 `contextUsageRatio`。
 */

/** 手动 compact 的目标；actor/stage 用名称或 id，world 不需要名称。 */
export type CompactTarget =
  | { ownerType: "actor"; ref: string }
  | { ownerType: "stage"; ref: string }
  | { ownerType: "world" };

export type CompactMemoryOptions = {
  service: ChatCompletionService;
  /** 只有当前 contextUsageRatio 达到该值才压缩；省略时总是压缩。 */
  minRatio?: number;
};

export type CompactMemoryResult = {
  ownerType: MemoryOwnerType;
  ownerName: string;
  skipped: boolean;
  reason?: string;
  contextUsageRatio: number;
  beforeMessages: number;
  afterMessages: number;
  summary?: string;
};

export type ResolvedOwner = {
  ownerType: MemoryOwnerType;
  ownerId: string;
  ownerName: string;
};
