import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { actorSignatures, appearances } from "../../db/schema";
import type { ChatMessage, ToolDefinition } from "../../llm/types";
import { GameError } from "../errors";
import type { Executor } from "./rows";

/**
 * 外观渲染的持久化原语。
 *
 * 外观是 append-only 的：每次成功生成插入一行，旧行只写 `superseded_at`。
 * `input` 保存生成那一刻的完整输入，`text` 是最终渲染值。
 */

/**
 * 生成外观那一刻的输入快照。
 *
 * 运行时分支保存发给模型的完整 prompt 与结构化上下文；seed 分支只记录内容来源。
 */
export type AppearanceInput =
  | {
      source: "seed";
      contentKey: string;
      contentVersion: string;
      actorKey: string;
      form: string;
      /** 种子没写 appearance 时为 true，text 回退为 form。 */
      fallback: boolean;
    }
  | {
      source: "runtime";
      /** provider 未暴露模型名时为 null。 */
      model: string | null;
      prompt: {
        messages: readonly ChatMessage[];
        inputMessage: string;
        tools: readonly ToolDefinition[];
        maxRounds: number;
      };
      context: AppearanceContext;
    };

/**
 * 运行时外观的生成上下文：任务标签 + 该任务自己的结构化细节，原样进审计快照。
 *
 * 存储只要求一个 `task` 标签，不枚举有哪些任务：任务形状归调用方的业务，
 * 增一个任务不改存储类型。
 */
export type AppearanceContext = {
  /** 任务标签，取值由调用方定义（`update` / `death` / …）。 */
  task: string;
  [field: string]: unknown;
};

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
