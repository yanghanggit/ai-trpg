import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool";
import { dialogueBlocks } from "../../db/schema";
import type { DialogueActionKind, DialogueCategory } from "../types";

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
