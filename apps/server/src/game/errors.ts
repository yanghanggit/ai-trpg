export type GameErrorCode = "not_found" | "invalid_action" | "invalid_state" | "dialogue_blocked";

export class GameError extends Error {
  readonly code: GameErrorCode;

  constructor(code: GameErrorCode, message: string) {
    super(message);
    this.name = "GameError";
    this.code = code;
  }
}

/** 玩家对话被审核拒绝，或审核服务不可用；两种情况都不执行动作。 */
export class DialogueBlockedError extends GameError {
  /** 422 = 内容违规；503 = 审核不可用（fail closed）。 */
  readonly httpStatus: 422 | 503;
  readonly reason: string;
  readonly categories: readonly string[];
  readonly failureKind: string | undefined;
  readonly auditId: string;

  constructor(input: {
    httpStatus: 422 | 503;
    reason: string;
    categories: readonly string[];
    failureKind?: string;
    auditId: string;
  }) {
    super("dialogue_blocked", input.reason);
    this.name = "DialogueBlockedError";
    this.httpStatus = input.httpStatus;
    this.reason = input.reason;
    this.categories = input.categories;
    this.failureKind = input.failureKind;
    this.auditId = input.auditId;
  }
}
