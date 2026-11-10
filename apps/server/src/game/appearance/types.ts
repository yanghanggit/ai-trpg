import type { TraceContext } from "../../debug/trace";
import type { agentLoop } from "../../llm/agent-loop";
import type { ChatCompletionService } from "../../llm/protocol";
import type { AppearanceContext } from "../persistence/appearances";

/** 外观推论的依赖：服务、轮数预算、日志与所属回合的轨迹。 */
export type AppearanceOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
  /** 所属回合的轨迹；有值则把这次推理并入该回合。 */
  trace?: TraceContext;
};

/** 一次外观任务的成果：文本，或没生成时的原因。 */
export type AppearanceOutcome = {
  ok: boolean;
  appearance: string | null;
  /** 没生成时的原因：loop 失败，或模型没调用提交工具。 */
  reason?: string;
};

/**
 * 骨架的输入：生成什么、写进审计的上下文、要不要广播。
 *
 * 任务文本由业务给；`context.task` 同时是审计快照里的任务标签，所以不再另开一个字段。
 */
export type AppearanceTask = {
  inputMessage: string;
  context: AppearanceContext;
  /** 生成后是否把可见变化写成观察；广播策略归调用方。 */
  notify: boolean;
};
