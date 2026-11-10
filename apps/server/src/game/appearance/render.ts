import { randomUUID } from "node:crypto";
import { DEFAULT_ERROR_RETRIES, loopErrorReason } from "../../llm";
import { agentLoop } from "../../llm/agent-loop";
import { GameError } from "../errors";
import { buildSubmitAppearanceTool, parseAppearance } from "./prompt";
import type { AppearanceTarget } from "./target";
import type { AppearanceOptions } from "./types";

/** 一次推论的产出：文本，或没生成时的原因。 */
export type RenderedAppearance = {
  appearance: string | null;
  reason?: string;
};

/**
 * 生成：借当事人的记忆跑一次推理，返回提交的外观文本；没提交或 loop 失败时带上原因。
 *
 * `mutateMessages: false`：这一轮的推理轮次与工具调用都留在副本里，不进 memory。
 * 产出走本模块的 `parseAppearance`：输入由调用方给，守卫不跟着调用方走。
 */
export async function renderAppearance(
  target: AppearanceTarget,
  input: { inputMessage: string; maxRounds: number },
  options: AppearanceOptions,
): Promise<RenderedAppearance> {
  const tool = buildSubmitAppearanceTool();
  let submitted: string | null = null;

  const loop = await agentLoop({
    name: target.actor.name,
    inputMessage: input.inputMessage,
    messages: target.memory.messages,
    mutateMessages: false,
    tools: [tool],
    handlers: {
      [tool.function.name]: (args) => {
        if (submitted !== null) {
          throw new GameError("invalid_action", "外观已提交");
        }
        submitted = parseAppearance(args, target.actorNames);
        return "外观已提交";
      },
    },
    terminalTools: [tool],
    service: options.service,
    maxRounds: input.maxRounds,
    errorRetries: DEFAULT_ERROR_RETRIES,
    loopId: randomUUID(),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.trace ? { trace: options.trace } : {}),
  });

  if (!loop.success) {
    return { appearance: null, reason: loopErrorReason(loop) ?? "推理未完成" };
  }
  return submitted === null
    ? { appearance: null, reason: "模型未调用 submit_appearance 提交外观" }
    : { appearance: submitted };
}
