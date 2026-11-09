import { createHash } from "node:crypto";
import type { Database } from "../../db/pool";
import { DEEPSEEK_MODEL_FLASH } from "../../deepseek";
import { type DialogueFailureKind, insertDialogueBlock } from "../persistence/dialogue-blocks";
import { DEFAULT_DIALOGUE_JUDGE, DialogueJudgeError } from "./judge";
import type { DialogueAuditResult, DialogueContext, DialogueJudge, DialogueVerdict } from "./types";

/**
 * 审核一次玩家台词：跑裁判，被拒或不可用时先把记录写进黑名单，再返回结论。
 *
 * 允许的台词不落库；每次调用都是独立的 system + task 消息，不读 agent memory。
 * 「审核不可用」与「审核拒绝」对玩家的结果一样——这次行动不执行——但落库原因不同，
 * 复盘时能分辨是内容违规还是裁判坏了。
 */

export const DIALOGUE_AUDIT_UNAVAILABLE_REASON = "审核暂时不可用，本次行动未执行";

/**
 * 审核一句玩家台词；被拒或审核失败时先写黑名单记录，再返回结论。
 *
 * 允许的台词不落库；每次调用都是独立的 system + task 消息，不读取 agent memory。
 */
export async function auditPlayerDialogue(
  db: Database,
  context: DialogueContext,
  judge: DialogueJudge = DEFAULT_DIALOGUE_JUDGE,
): Promise<DialogueAuditResult> {
  const startedAt = performance.now();
  const contentHash = createHash("sha256").update(context.message).digest("hex");

  let verdict: DialogueVerdict;
  try {
    verdict = await judge({
      actionKind: context.actionKind,
      message: context.message,
      actorName: context.actorName,
      stageName: context.stageName,
      world: context.world,
    });
  } catch (error) {
    const failureKind: DialogueFailureKind =
      error instanceof DialogueJudgeError ? error.failureKind : "judge_error";
    const latencyMs = Math.round(performance.now() - startedAt);
    const auditId = await insertDialogueBlock(db, {
      gameId: context.gameId,
      actorId: context.actorId,
      playerId: context.playerId,
      actionKind: context.actionKind,
      targetActorId: context.targetActorId ?? null,
      content: context.message,
      contentHash,
      categories: [],
      reason: DIALOGUE_AUDIT_UNAVAILABLE_REASON,
      failureKind,
      model: DEEPSEEK_MODEL_FLASH,
      latencyMs,
    });

    return {
      allowed: false,
      reason: DIALOGUE_AUDIT_UNAVAILABLE_REASON,
      categories: [],
      failureKind,
      auditId,
      latencyMs,
      contentHash,
      model: DEEPSEEK_MODEL_FLASH,
    };
  }

  const latencyMs = Math.round(performance.now() - startedAt);
  if (verdict.allowed) {
    return {
      allowed: true,
      reason: verdict.reason,
      categories: [],
      latencyMs,
      contentHash,
      model: DEEPSEEK_MODEL_FLASH,
    };
  }

  const auditId = await insertDialogueBlock(db, {
    gameId: context.gameId,
    actorId: context.actorId,
    playerId: context.playerId,
    actionKind: context.actionKind,
    targetActorId: context.targetActorId ?? null,
    content: context.message,
    contentHash,
    categories: verdict.categories,
    reason: verdict.reason,
    model: DEEPSEEK_MODEL_FLASH,
    latencyMs,
  });

  return {
    allowed: false,
    reason: verdict.reason,
    categories: verdict.categories,
    auditId,
    latencyMs,
    contentHash,
    model: DEEPSEEK_MODEL_FLASH,
  };
}
