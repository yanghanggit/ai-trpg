/**
 * 回合作业的读法：终态、失败码、结果形状。
 *
 * 这些只依赖契约里的 `TurnJob`，与谁在轮询无关，所以放在契约包里给两个客户端共用——
 * 玩家端与管理后台对「这一回合成功了没有」必须给出同一个答案。
 */

import type { components } from "./schema";

/** 一条回合作业；形状就是生成契约里的那一份，不另立页面类型。 */
export type TurnJob = components["schemas"]["TurnJob"];

/** 终态：有了就不会再变，轮询与订阅都可以停。 */
const TERMINAL_STATUSES: readonly TurnJob["status"][] = ["succeeded", "failed", "canceled"];

export function isTerminalJob(job: TurnJob): boolean {
  return TERMINAL_STATUSES.includes(job.status);
}

/** 作业失败时抛出来的东西：带业务错误码，调用方按码分支，不解析文本。 */
export class TurnJobFailure extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TurnJobFailure";
    this.code = code;
  }
}

export type TurnOutcome =
  | { ok: true; job: TurnJob }
  | { ok: false; job: TurnJob; code: string; message: string };

/**
 * 把终态收成一份调用方要的形状。
 *
 * 失败码取作业留下的那个，不在客户端重新解释：作业层不认识业务，它留下什么码就是什么。
 */
export function outcomeOf(job: TurnJob): TurnOutcome {
  if (job.status === "succeeded") {
    return { ok: true, job };
  }
  return {
    ok: false,
    job,
    code: job.errorCode ?? (job.status === "canceled" ? "job_canceled" : "job_failed"),
    message: job.error ?? (job.status === "canceled" ? "作业被取消" : "作业失败"),
  };
}
