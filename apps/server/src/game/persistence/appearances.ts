import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { actorSignatures, appearances } from "../../db/schema";
import type { Executor } from "../apply/types";
import { GameError } from "../errors";
import type { AppearanceInput } from "../types";

/**
 * 外观渲染的持久化原语。
 *
 * 外观是 append-only 的：每次成功生成插入一行，旧行只写 `superseded_at`。
 * `input` 保存生成那一刻的完整输入，`text` 是最终渲染值。
 */

export type AppearanceWrite = {
  gameId: string;
  actorId: string;
  text: string;
  input: AppearanceInput;
  now: Date;
};

/** 写一条当前外观，并把同一签名的旧当前行标记为已取代。 */
export async function recordAppearance(
  executor: Executor,
  write: AppearanceWrite,
): Promise<string> {
  const [signature] = await executor
    .select({ id: actorSignatures.id })
    .from(actorSignatures)
    .where(and(eq(actorSignatures.actorId, write.actorId), isNull(actorSignatures.endedAt)))
    .limit(1);
  if (!signature) {
    throw new GameError("invalid_state", `actor 缺少当前签名: ${write.actorId}`);
  }

  await executor
    .update(appearances)
    .set({ supersededAt: write.now })
    .where(and(eq(appearances.signatureId, signature.id), isNull(appearances.supersededAt)));

  const id = randomUUID();
  await executor.insert(appearances).values({
    id,
    gameId: write.gameId,
    signatureId: signature.id,
    text: write.text,
    source: write.input.source,
    input: write.input,
    createdAt: write.now,
  });
  return id;
}
