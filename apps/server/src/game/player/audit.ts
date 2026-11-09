import type { Database } from "../../db/pool";
import { type TraceContext, traceEvent } from "../../debug/trace";
import { auditPlayerDialogue, type DialogueContext, type DialogueJudge } from "../dialogue-audit";
import { DialogueBlockedError } from "../errors";

/**
 * 玩家台词的审核：通过就返回，不通过就把轨迹写完再抛。
 *
 * 审核结果决定这一轮是否执行，所以它是落账之前的一道闸，而不是事后检查。
 * 审核器不可用（503）与内容被拒（422）用不同状态码区分，调用方按 `failureKind` 判断。
 */
export async function auditDialogueOrThrow(input: {
  db: Database;
  trace: TraceContext | undefined;
  context: DialogueContext;
  judge?: DialogueJudge;
}): Promise<void> {
  const { db, trace, context, judge } = input;
  const audit = await auditPlayerDialogue(db, context, judge);
  await traceEvent(trace, {
    event: "dialogue_audit",
    allowed: audit.allowed,
    reason: audit.reason,
    categories: audit.categories,
    ...(audit.failureKind ? { failureKind: audit.failureKind } : {}),
    ...(audit.auditId ? { auditId: audit.auditId } : {}),
    latencyMs: audit.latencyMs,
    model: audit.model,
    contentHash: audit.contentHash,
  });
  if (audit.allowed) {
    return;
  }
  await traceEvent(trace, { event: "turn_end", ok: false, loopSuccess: true });
  throw new DialogueBlockedError({
    httpStatus: audit.failureKind ? 503 : 422,
    reason: audit.reason,
    categories: audit.categories,
    ...(audit.failureKind ? { failureKind: audit.failureKind } : {}),
    auditId: audit.auditId ?? "",
  });
}
