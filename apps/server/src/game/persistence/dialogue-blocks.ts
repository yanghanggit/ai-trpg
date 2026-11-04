import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool";
import { dialogueBlocks } from "../../db/schema";

/** 玩家对话审核覆盖四种说话动作；call 也按台词审核。 */
export type DialogueActionKind = "say" | "whisper" | "announce" | "call";

/** 审核拒绝的类别；允许时为空。 */
export type DialogueCategory = "immersion_break" | "out_of_world" | "prohibited" | "other";

/** 审核失败的技术原因；内容违规不属于 failure。 */
export type DialogueFailureKind =
  | "timeout"
  | "connection"
  | "api"
  | "invalid_verdict"
  | "judge_error";

export type DialogueBlockInput = {
  gameId: string;
  actorId: string;
  playerId: string;
  actionKind: DialogueActionKind;
  targetActorId?: string | null;
  content: string;
  contentHash: string;
  categories: DialogueCategory[];
  reason: string;
  failureKind?: string;
  model?: string;
  latencyMs: number;
};

/** 写一条被拒记录；返回值用于把 auditId 带回客户端。 */
export async function insertDialogueBlock(
  db: Pick<Database, "insert">,
  input: DialogueBlockInput,
): Promise<string> {
  const [row] = await db
    .insert(dialogueBlocks)
    .values({
      id: randomUUID(),
      gameId: input.gameId,
      actorId: input.actorId,
      playerId: input.playerId,
      actionKind: input.actionKind,
      targetActorId: input.targetActorId ?? null,
      content: input.content,
      contentHash: input.contentHash,
      categories: input.categories,
      reason: input.reason,
      failureKind: input.failureKind ?? null,
      model: input.model ?? null,
      latencyMs: input.latencyMs,
    })
    .returning({ id: dialogueBlocks.id });
  if (!row) {
    throw new Error("写入对话审核记录失败");
  }
  return row.id;
}
