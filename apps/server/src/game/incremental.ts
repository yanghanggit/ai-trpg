import { type TraceContext, traceEvent } from "../debug/trace";
import type { Logger } from "../logging";

/**
 * 计算端提交之后的增量阶段：推理/泛化端的所有追加都从这里进入。
 *
 * 用法：用 `run` 包住一段「可能失败、只应追加」的逻辑，返回判别结果。
 * 约束：失败不外抛、不回滚已提交的状态；本函数只负责 containment 与轨迹，
 * 预算、重试、事务等策略留在业务函数里。
 */
export type IncrementalPhaseOutcome =
  | { kind: "applied"; actorName?: string; detail?: Record<string, unknown> }
  | { kind: "noop"; reason: string; actorName?: string; detail?: Record<string, unknown> }
  | { kind: "failed"; reason: string; actorName?: string; detail?: Record<string, unknown> };

export type IncrementalPhaseOptions = {
  name: string;
  trace?: TraceContext;
  logger?: Logger;
};

export type IncrementalPhaseStatus = "ok" | "skipped" | "failed";

export async function runIncrementalPhase(
  options: IncrementalPhaseOptions,
  run: () => Promise<IncrementalPhaseOutcome>,
): Promise<IncrementalPhaseStatus> {
  let outcome: IncrementalPhaseOutcome;
  try {
    outcome = await run();
  } catch (error) {
    options.logger?.warn(`增量阶段失败，不影响已结算的结果: ${options.name}`, error);
    await traceEvent(options.trace, {
      event: "phase",
      name: options.name,
      status: "failed",
      detail: { reason: describeError(error) },
    });
    return "failed";
  }

  const status: IncrementalPhaseStatus =
    outcome.kind === "applied" ? "ok" : outcome.kind === "noop" ? "skipped" : "failed";
  const detail =
    outcome.kind === "applied"
      ? outcome.detail
      : { reason: outcome.reason, ...(outcome.detail ?? {}) };
  await traceEvent(options.trace, {
    event: "phase",
    name: options.name,
    status,
    ...(outcome.actorName === undefined ? {} : { actorName: outcome.actorName }),
    ...(detail === undefined ? {} : { detail }),
  });
  return status;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
