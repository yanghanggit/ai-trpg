import { and, eq, inArray, isNull } from "drizzle-orm";
import { actorSignatures } from "../../db/schema";
import type { Executor } from "../apply/types";

/**
 * 签名的持久化原语。
 *
 * `actors` 只持有身份；「别人此刻看到的样子」属于签名。外观的读写都走这里：
 * 换装只改 `appearance`，伪装 / 变身会开一条新签名并把旧的封上（`endedAt`）。
 */

export type SignatureWrite = {
  id: string;
  seq: number;
  actorId: string;
  /** 稳定形态，`[种族]:描述`。 */
  form: string;
  appearance: string;
  /** 新签名先以「已退场」插入，再由 `switchCurrentSignature` 启用，避免撞唯一索引。 */
  endedAt?: Date | null;
};

export async function insertSignature(executor: Executor, write: SignatureWrite): Promise<void> {
  await executor.insert(actorSignatures).values({ ...write, endedAt: write.endedAt ?? null });
}

/**
 * 本局内给定 actor 的当前签名（每个 actor 至多一条）。
 *
 * 调用方先算出 actorIds，再一次性读回，避免按 actor 逐个查询。
 */
export async function listCurrentSignatures(
  executor: Executor,
  actorIds: readonly string[],
): Promise<(typeof actorSignatures.$inferSelect)[]> {
  if (actorIds.length === 0) {
    return [];
  }
  return executor
    .select()
    .from(actorSignatures)
    .where(and(inArray(actorSignatures.actorId, [...actorIds]), isNull(actorSignatures.endedAt)));
}

/**
 * 切换当前签名：把正在使用的那条封上，再把目标签名恢复为当前。
 *
 * 伪装 / 变身只切换、不销毁：切回旧签名时，旧的 `actor_recognitions` 行会立刻重新生效，
 * 老朋友不需要重新认识一遍。
 */
export async function switchCurrentSignature(
  executor: Executor,
  actorId: string,
  signatureId: string,
  now: Date,
): Promise<void> {
  await executor
    .update(actorSignatures)
    .set({ endedAt: now })
    .where(and(eq(actorSignatures.actorId, actorId), isNull(actorSignatures.endedAt)));
  await executor
    .update(actorSignatures)
    .set({ endedAt: null })
    .where(and(eq(actorSignatures.id, signatureId), eq(actorSignatures.actorId, actorId)));
}

/** 写当前签名的展示值；外观推理与死亡快照都落在这里。 */
export async function setSignatureAppearance(
  executor: Executor,
  actorId: string,
  appearance: string,
): Promise<void> {
  await executor
    .update(actorSignatures)
    .set({ appearance })
    .where(and(eq(actorSignatures.actorId, actorId), isNull(actorSignatures.endedAt)));
}
