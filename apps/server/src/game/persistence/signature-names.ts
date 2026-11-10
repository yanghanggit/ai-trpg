import { and, eq } from "drizzle-orm";
import { actorSignatureNames } from "../../db/schema";
import type { Executor } from "./rows";

/**
 * 观察者对签名名字的持久化原语。
 *
 * 表里存「这个观察者当前怎么称呼这个签名」。名字不要求是真名，也不保留别名层级；
 * 同一个「观察者 × 签名」再次写入时直接覆盖当前名字。
 */

export type SignatureNameRow = typeof actorSignatureNames.$inferSelect;

export async function listSignatureNames(
  executor: Executor,
  gameId: string,
): Promise<SignatureNameRow[]> {
  return executor.select().from(actorSignatureNames).where(eq(actorSignatureNames.gameId, gameId));
}

/** 某个观察者在当前局里对各个签名的称呼。 */
export async function signatureNamesFor(
  executor: Executor,
  gameId: string,
  observerActorId: string,
): Promise<Map<string, string>> {
  const rows = await executor
    .select({
      signatureId: actorSignatureNames.signatureId,
      name: actorSignatureNames.name,
    })
    .from(actorSignatureNames)
    .where(
      and(
        eq(actorSignatureNames.gameId, gameId),
        eq(actorSignatureNames.observerActorId, observerActorId),
      ),
    );
  return new Map(rows.map((row) => [row.signatureId, row.name]));
}

export type SignatureNameWrite = {
  gameId: string;
  observerActorId: string;
  signatureId: string;
  name: string;
  source: "content" | "self";
  learnedStageId: string | null;
};

/** 同一「观察者 × 签名」只有一条当前名字；重复写入覆盖名字与来源。 */
export async function upsertSignatureName(
  executor: Executor,
  write: SignatureNameWrite,
  now: Date,
): Promise<void> {
  await executor
    .insert(actorSignatureNames)
    .values({
      id: crypto.randomUUID(),
      gameId: write.gameId,
      observerActorId: write.observerActorId,
      signatureId: write.signatureId,
      name: write.name,
      source: write.source,
      learnedStageId: write.learnedStageId,
    })
    .onConflictDoUpdate({
      target: [actorSignatureNames.observerActorId, actorSignatureNames.signatureId],
      set: {
        name: write.name,
        source: write.source,
        learnedStageId: write.learnedStageId,
        updatedAt: now,
      },
    });
}
