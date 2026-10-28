import { and, eq } from "drizzle-orm";
import { nameKnowledge } from "../../db/schema";
import type { Executor } from "../apply/types";

/**
 * 名字信念的持久化原语。
 *
 * 表里存的是「某个观察者相信某个形象叫什么」，不是对象的真名：同一个 actor 可以有不
 * 同的称呼，假名与误认都是合法状态。写入只有两个入口——内容层的开局声明与角色自己的
 * 回合；引擎不做名字抽取。
 */

export type NameKnowledgeRow = typeof nameKnowledge.$inferSelect;

export async function listKnowledge(
  executor: Executor,
  gameId: string,
): Promise<NameKnowledgeRow[]> {
  return executor.select().from(nameKnowledge).where(eq(nameKnowledge.gameId, gameId));
}

export async function listKnowledgeForObserver(
  executor: Executor,
  gameId: string,
  observerActorId: string,
): Promise<NameKnowledgeRow[]> {
  return executor
    .select()
    .from(nameKnowledge)
    .where(
      and(eq(nameKnowledge.gameId, gameId), eq(nameKnowledge.observerActorId, observerActorId)),
    );
}

export type KnowledgeWrite = {
  gameId: string;
  observerActorId: string;
  presentationId: string;
  /** 观察者相信的称呼；可以是假名或误认。 */
  name: string;
  source: "content" | "self";
  learnedStageId: string | null;
};

/** 同一「观察者 × 形象」只有一条信念；再记一次就是改口。 */
export async function upsertKnowledge(
  executor: Executor,
  write: KnowledgeWrite,
  now: Date,
): Promise<void> {
  await executor
    .insert(nameKnowledge)
    .values({
      id: crypto.randomUUID(),
      gameId: write.gameId,
      observerActorId: write.observerActorId,
      presentationId: write.presentationId,
      name: write.name,
      source: write.source,
      learnedStageId: write.learnedStageId,
    })
    .onConflictDoUpdate({
      target: [nameKnowledge.observerActorId, nameKnowledge.presentationId],
      set: {
        name: write.name,
        source: write.source,
        learnedStageId: write.learnedStageId,
        updatedAt: now,
      },
    });
}
