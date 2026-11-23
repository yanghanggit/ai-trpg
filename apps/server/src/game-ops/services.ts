/**
 * 驱动一局所需的 LLM 依赖。
 *
 * 与 `game/` 内部的 `*Options` 分开：这里是「一次操作要带哪些服务」，
 * 传输入口（CLI / HTTP）都注入同一组默认实现，测试可换成假服务。
 */

import type { ChatCompletionService } from "../llm/protocol";
import type { Logger } from "../logging";

/** 会跑推理阶段的动作需要两份：计划用 `service`，结算后的增量用 `inferenceService`。 */
export type TurnServices = {
  service: ChatCompletionService;
  inferenceService: ChatCompletionService;
  logger?: Logger;
};

/** 只跑一次推理的入口（探针、舞台 / 世界回合、压缩、死亡）。 */
export type LlmServices = {
  service: ChatCompletionService;
  logger?: Logger;
};
