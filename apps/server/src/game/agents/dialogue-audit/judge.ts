import { DEEPSEEK_MODEL_FLASH, DEEPSEEK_SERVICE } from "../../../deepseek";
import { ChatCompletionRequest, type ChatCompletionService } from "../../../llm";
import type { DialogueFailureKind } from "../../persistence/dialogue-blocks";
import {
  buildAuditMessage,
  buildDialogueAuditSystemPrompt,
  VERDICT_TOOL,
  verdictSchema,
} from "./prompt";
import type { DialogueJudge } from "./types";

/**
 * 默认审核器：单次 completion + 单个提交工具，不保留任何 agent 记忆。
 *
 * 审核没有 agent loop：一次调用、一个判定。失败（超时、传输错误、判定不合法）
 * 一律抛 `DialogueJudgeError`，由调用方决定「拒绝本次行动」而不是放行。
 */

export const DIALOGUE_AUDIT_TIMEOUT_MS = 10_000;

export const DIALOGUE_AUDIT_UNAVAILABLE_REASON = "审核暂时不可用，本次行动未执行";

export class DialogueJudgeError extends Error {
  readonly failureKind: DialogueFailureKind;

  constructor(failureKind: DialogueFailureKind, message: string) {
    super(message);
    this.name = "DialogueJudgeError";
    this.failureKind = failureKind;
  }
}

/** 默认审核器：单次 completion + 单个提交工具，不保留任何 agent 记忆。 */
export function createDeepSeekDialogueJudge(
  service: ChatCompletionService = DEEPSEEK_SERVICE,
): DialogueJudge {
  return async (input) => {
    const request = new ChatCompletionRequest({
      label: "dialogue-audit",
      inputMessage: `dialogue-audit:${input.actionKind}`,
      messages: [
        { type: "system", content: buildDialogueAuditSystemPrompt(input.world) },
        { type: "human", content: buildAuditMessage(input) },
      ],
      model: DEEPSEEK_MODEL_FLASH,
      thinking: false,
      timeoutMs: DIALOGUE_AUDIT_TIMEOUT_MS,
      temperature: 0,
      maxTokens: 512,
      tools: [VERDICT_TOOL],
      toolChoice: "required",
    });

    let result: Awaited<ReturnType<ChatCompletionService["complete"]>>;
    try {
      result = await service.complete(request);
    } catch (error) {
      throw new DialogueJudgeError(
        "judge_error",
        error instanceof Error ? error.message : String(error),
      );
    }

    if (result.error) {
      throw new DialogueJudgeError(result.error.kind, result.error.message);
    }

    const call = result.toolCalls.find(
      (candidate) => candidate.function.name === VERDICT_TOOL.function.name,
    );
    if (!call) {
      throw new DialogueJudgeError("invalid_verdict", "审核器没有提交判定");
    }

    let raw: unknown;
    try {
      raw = JSON.parse(call.function.arguments);
    } catch {
      throw new DialogueJudgeError("invalid_verdict", "审核判定不是合法 JSON");
    }

    const parsed = verdictSchema.safeParse(raw);
    if (!parsed.success) {
      throw new DialogueJudgeError("invalid_verdict", "审核判定字段不完整");
    }

    const verdict = parsed.data;
    return {
      allowed: verdict.allowed,
      categories: verdict.allowed || verdict.categories.length > 0 ? verdict.categories : ["other"],
      reason: verdict.reason,
    };
  };
}

export const DEFAULT_DIALOGUE_JUDGE = createDeepSeekDialogueJudge(DEEPSEEK_SERVICE);
