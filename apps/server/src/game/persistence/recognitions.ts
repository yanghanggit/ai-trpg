import { eq } from "drizzle-orm";
import { actorRecognitions } from "../../db/schema";
import type { Executor } from "../apply/types";

/**
 * 识别关系的持久化原语。
 *
 * 表里只存「某个观察者认不认识某个形象」，不存称呼：认得就等于知道对方的真名。
 * 写入只有两个入口——内容层的开局声明与角色自己的回合；引擎不做名字抽取。
 */

export type RecognitionRow = typeof actorRecognitions.$inferSelect;

export async function listRecognitions(
  executor: Executor,
  gameId: string,
): Promise<RecognitionRow[]> {
  return executor.select().from(actorRecognitions).where(eq(actorRecognitions.gameId, gameId));
}

export type RecognitionWrite = {
  gameId: string;
  observerActorId: string;
  presentationId: string;
  source: "content" | "self";
  learnedStageId: string | null;
};

/** 同一「观察者 × 形象」只有一条识别关系；重复写入只更新来源。 */
export async function upsertRecognition(
  executor: Executor,
  write: RecognitionWrite,
  now: Date,
): Promise<void> {
  await executor
    .insert(actorRecognitions)
    .values({
      id: crypto.randomUUID(),
      gameId: write.gameId,
      observerActorId: write.observerActorId,
      presentationId: write.presentationId,
      source: write.source,
      learnedStageId: write.learnedStageId,
    })
    .onConflictDoUpdate({
      target: [actorRecognitions.observerActorId, actorRecognitions.presentationId],
      set: {
        source: write.source,
        learnedStageId: write.learnedStageId,
        updatedAt: now,
      },
    });
}
